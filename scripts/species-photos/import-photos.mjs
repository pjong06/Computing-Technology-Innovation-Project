#!/usr/bin/env node
// Imports officer-approved iNaturalist photos into the private species-media bucket.
// Dry-run is the default. Remote writes and the local result CSV require --apply.

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsvObjects, toCsv } from './csv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = join(HERE, 'species-photo-review-by-species-REVIEWED.csv');
const DEFAULT_REPORT = join(HERE, 'species-photo-import-results.csv');
const BUCKET = 'species-media';
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 25_000_000;
const MIN_DOWNLOAD_GAP_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const ALLOWED_IMAGE_HOSTS = new Set([
  'inaturalist-open-data.s3.amazonaws.com',
  'static.inaturalist.org',
]);
const ALLOWED_PAGE_HOSTS = new Set(['inaturalist.org', 'www.inaturalist.org']);
const ALLOWED_LICENCES = new Set(['cc0', 'cc-by', 'cc-by-sa']);
const REPORT_COLUMNS = [
  'species_id',
  'scientific_name',
  'source_photo_id',
  'main_photo_id',
  'officer_name',
  'result',
  'reason',
  'file_path',
  'media_id',
  'primary_error',
];

const backendRequire = createRequire(join(HERE, '../../backend/package.json'));
let sharp;
let serviceRoleKey = '';
let lastDownloadStartedAt = 0;

function parseArguments(argv) {
  const options = {
    apply: false,
    input: DEFAULT_INPUT,
    report: DEFAULT_REPORT,
    limit: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--limit') {
      const value = argv[index + 1];
      if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error('--limit requires a positive integer');
      }
      options.limit = Number(value);
      index += 1;
    } else if (arg === '--input' || arg === '--report') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a file path`);
      }
      options[arg === '--input' ? 'input' : 'report'] = resolve(value);
      index += 1;
    } else if (arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/species-photos/import-photos.mjs [--limit N] [--input FILE] [--report FILE]
  node scripts/species-photos/import-photos.mjs --apply [--limit N] [--input FILE] [--report FILE]

Without --apply, validates the reviewed choices and prints a plan without network
access or file/database/storage writes. --apply requires SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY in the process environment. --limit caps the number of
photos considered and prioritizes each chosen species' main photo.`);
}

function requireColumns(rows, required) {
  if (rows.length === 0) throw new Error('The reviewed CSV has no data rows.');
  const columns = new Set(Object.keys(rows[0]));
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length) {
    throw new Error(`The reviewed CSV is missing required columns: ${missing.join(', ')}`);
  }
}

function validHttpsUrl(value, allowedHosts, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (
    url.protocol !== 'https:' ||
    !allowedHosts.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error(`${label} must use HTTPS on an approved iNaturalist host`);
  }
  return url;
}

function preferLargeImageUrl(value) {
  const url = validHttpsUrl(value, ALLOWED_IMAGE_HOSTS, 'Image URL');
  const sizedPath = url.pathname.match(/\/(square|small|medium|large)(\.(?:jpe?g|png|webp))$/i);
  if (sizedPath) {
    url.pathname = url.pathname.replace(
      /\/(square|small|medium|large)(\.(?:jpe?g|png|webp))$/i,
      '/large$2'
    );
  } else if (['square', 'small', 'medium', 'large'].includes(url.searchParams.get('size')?.toLowerCase())) {
    url.searchParams.set('size', 'large');
  }
  return url.toString();
}

function candidateFor(row, photoId) {
  const matches = Object.keys(row).filter(
    (key) => /^cand\d+_id$/.test(key) && row[key].trim() === photoId
  );
  if (matches.length !== 1) {
    throw new Error(matches.length ? 'Photo ID appears in multiple candidate columns' : 'Chosen photo ID has no candidate');
  }

  const index = matches[0].match(/^cand(\d+)_id$/)[1];
  const field = (name) => row[`cand${index}_${name}`]?.trim() ?? '';
  const licence = field('licence').toLowerCase();
  if (!ALLOWED_LICENCES.has(licence)) {
    throw new Error(`Licence ${licence || '(blank)'} is not approved for import`);
  }

  const attribution = field('attribution');
  if (!attribution) throw new Error('Candidate attribution is empty');

  const sourceUrl = field('page_url');
  validHttpsUrl(sourceUrl, ALLOWED_PAGE_HOSTS, 'Photo page URL');

  const officerName = row.officer_name?.trim() ?? '';
  if (!officerName) throw new Error('Officer name is empty');

  if (!/^[1-9]\d*$/.test(photoId)) throw new Error('Photo ID must be a positive integer');

  const originalImageUrl = validHttpsUrl(field('url'), ALLOWED_IMAGE_HOSTS, 'Image URL').toString();
  return {
    sourcePhotoId: photoId,
    imageUrl: preferLargeImageUrl(originalImageUrl),
    fallbackImageUrl: originalImageUrl,
    sourceUrl,
    licence,
    attribution,
    photographer: field('photographer'),
    officerName,
  };
}

function buildPlan(rows) {
  const tasks = [];
  let noSelectionSpecies = 0;

  for (const row of rows) {
    const selected = (row.chosen_photo_ids ?? '')
      .split(';')
      .map((id) => id.trim())
      .filter(Boolean);

    if (selected.length === 0) {
      noSelectionSpecies += 1;
      continue;
    }

    const mainPhotoId = row.main_photo_id?.trim() ?? '';
    const uniqueIds = [...new Set(selected)];
    const rowProblem = selected.length !== uniqueIds.length
      ? 'Chosen photo IDs contain duplicates'
      : !mainPhotoId || !selected.includes(mainPhotoId)
        ? 'The main photo must be one of the chosen photos'
        : row.officer_choice?.trim().toLowerCase() === 'none'
          ? 'officer_choice is none but chosen photos are present'
          : null;

    const orderedIds = [
      ...(mainPhotoId && uniqueIds.includes(mainPhotoId) ? [mainPhotoId] : []),
      ...uniqueIds.filter((id) => id !== mainPhotoId),
    ];

    for (const photoId of orderedIds) {
      const task = {
        speciesId: row.species_id?.trim() ?? '',
        scientificName: row.scientific_name?.trim() ?? '',
        sourcePhotoId: photoId,
        mainPhotoId,
        isMain: photoId === mainPhotoId,
        officerName: row.officer_name?.trim() ?? '',
        candidate: null,
        error: rowProblem,
        result: null,
      };

      if (!task.error) {
        try {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(task.speciesId)) {
            throw new Error('Species ID is not a UUID');
          }
          if (!task.scientificName) throw new Error('Scientific name is empty');
          task.candidate = candidateFor(row, photoId);
        } catch (error) {
          task.error = error.message;
        }
      }
      tasks.push(task);
    }
  }

  return { tasks, noSelectionSpecies };
}

function printDryRun(tasks, noSelectionSpecies) {
  console.log('DRY RUN — no network requests or writes will be made.');
  for (const task of tasks) {
    if (task.error) {
      console.log(`FAILED  ${task.scientificName || task.speciesId} photo ${task.sourcePhotoId}: ${task.error}`);
      task.result = { status: 'failed', reason: task.error };
      continue;
    }
    console.log(
      `WOULD IMPORT  ${task.scientificName} photo ${task.sourcePhotoId}` +
      ` (${task.candidate.licence}${task.isMain ? ', main' : ''})` +
      ` from ${task.candidate.imageUrl}`
    );
    task.result = { status: 'planned', reason: 'Validated; no writes performed' };
  }

  const failed = tasks.filter((task) => task.result?.status === 'failed').length;
  const planned = tasks.length - failed;
  console.log(
    `Summary: imported=0 skipped=0 failed=${failed} would_import=${planned}` +
    ` no_selection_species=${noSelectionSpecies}`
  );
  if (failed) process.exitCode = 1;
}

function getSharp() {
  if (!sharp) sharp = backendRequire('sharp');
  return sharp;
}

function createSupabaseClient() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!rawUrl || !serviceRoleKey) {
    throw new Error('Apply mode requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  let baseUrl;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }
  if (
    baseUrl.protocol !== 'https:' ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL without credentials or query parameters.');
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, contentType, prefer } = {}) {
    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined && contentType) headers['Content-Type'] = contentType;
    else if (body !== undefined && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetch(new URL(path, `${baseUrl.toString().replace(/\/+$/, '')}/`), {
          method,
          headers,
          body: body === undefined ? undefined : Buffer.isBuffer(body) || typeof body === 'string'
            ? body
            : JSON.stringify(body),
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (error) {
        throw new Error(`Supabase request failed: ${error.message}`);
      }

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!response.ok) {
        const error = new Error(
          typeof data?.message === 'string'
            ? data.message
            : typeof data?.error === 'string'
              ? data.error
              : `HTTP ${response.status}`
        );
        error.status = response.status;
        error.code = data?.code;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: (path) => request(path),
    insert: (table, record) => request(
      `rest/v1/${table}`,
      { method: 'POST', body: record, prefer: 'return=representation' }
    ),
    patch: (path, record) => request(
      path,
      { method: 'PATCH', body: record, prefer: 'return=minimal' }
    ),
    upload: (filePath, bytes) => request(
      `storage/v1/object/${BUCKET}/${filePath.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'POST', body: bytes, contentType: 'image/jpeg' }
    ),
    remove: (filePath) => request(
      `storage/v1/object/${BUCKET}`,
      { method: 'DELETE', body: { prefixes: [filePath] } }
    ),
  };
}

function safeErrorMessage(error) {
  let message = error instanceof Error ? error.message : String(error);
  if (serviceRoleKey) message = message.split(serviceRoleKey).join('[REDACTED]');
  return message.slice(0, 500);
}

function queryPath(table, filters, columns) {
  const params = new URLSearchParams({ select: columns, ...filters });
  return `rest/v1/${table}?${params.toString()}`;
}

async function getSpeciesState(client, speciesId) {
  const species = await client.get(queryPath(
    'species',
    { id: `eq.${speciesId}` },
    'id,verification_status'
  ));
  if (!Array.isArray(species) || species.length !== 1) {
    throw new Error('Species was not found');
  }
  if (species[0].verification_status !== 'approved') {
    throw new Error('Species is not approved');
  }

  const media = await client.get(queryPath(
    'species_media',
    { species_id: `eq.${speciesId}` },
    'id,species_id,source,source_photo_id,file_path,is_primary'
  ));
  return Array.isArray(media) ? media : [];
}

async function waitForDownloadSlot() {
  const wait = lastDownloadStartedAt + MIN_DOWNLOAD_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolveWait) => setTimeout(resolveWait, wait));
  lastDownloadStartedAt = Date.now();
}

function validateRedirectUrl(value) {
  return validHttpsUrl(value, ALLOWED_IMAGE_HOSTS, 'Redirect URL');
}

async function downloadImage(initialUrl) {
  let url = validateRedirectUrl(initialUrl);

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    await waitForDownloadSlot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetch(url, {
          headers: {
            Accept: 'image/jpeg,image/png,image/webp',
            'User-Agent': 'NiahBioTrack-species-photo-import/1.0',
          },
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        throw new Error(`Image download failed: ${error.message}`);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) throw new Error(`Image redirect ${response.status} has no Location header`);
        if (redirectCount === 5) throw new Error('Image exceeded the redirect limit');
        url = validateRedirectUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) {
        const error = new Error(`Image server returned HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
        await response.body?.cancel().catch(() => {});
        const error = new Error('Image is larger than 5 MB');
        error.code = 'IMAGE_TOO_LARGE';
        throw error;
      }
      if (!response.body) throw new Error('Image response has no body');

      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_DOWNLOAD_BYTES) {
            await reader.cancel();
            const error = new Error('Image is larger than 5 MB');
            error.code = 'IMAGE_TOO_LARGE';
            throw error;
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }

      const bytes = Buffer.concat(chunks, total);
      const format = detectImageFormat(bytes);
      if (!format) throw new Error('Downloaded file is not a JPEG, PNG, or WebP image');

      const declaredType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== format.mime) {
        throw new Error(`Image content type ${declaredType} does not match its file contents`);
      }
      return bytes;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Image exceeded the redirect limit');
}

function detectImageFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: 'jpeg', mime: 'image/jpeg' };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { format: 'png', mime: 'image/png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { format: 'webp', mime: 'image/webp' };
  }
  return null;
}

async function normalizeToJpeg(bytes) {
  const image = getSharp();
  const metadata = await image(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new Error('Image decoder did not identify a JPEG, PNG, or WebP image');
  }
  const jpeg = await image(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  if (jpeg.length > MAX_DOWNLOAD_BYTES) {
    throw new Error('Processed JPEG is larger than 5 MB');
  }
  return jpeg;
}

async function setPrimary(client, speciesId, primaryRows, mainMedia, sfcPrimary) {
  const currentPrimary = primaryRows.find((row) => row.is_primary);
  if (sfcPrimary) {
    for (const row of primaryRows) {
      if (row.source === 'inaturalist') {
        try {
          await client.patch(
            `rest/v1/species_media?id=eq.${encodeURIComponent(row.id)}&species_id=eq.${speciesId}`,
            { is_primary: false }
          );
          row.is_primary = false;
        } catch (error) {
          return `Could not preserve the SFC primary photo: ${safeErrorMessage(error)}`;
        }
      }
    }
    return null;
  }
  if (!mainMedia || currentPrimary?.id === mainMedia.id) return null;

  let previousPrimary = currentPrimary;
  if (previousPrimary) {
    try {
      await client.patch(
        `rest/v1/species_media?id=eq.${encodeURIComponent(previousPrimary.id)}&species_id=eq.${speciesId}`,
        { is_primary: false }
      );
      previousPrimary.is_primary = false;
    } catch (error) {
      return `Could not clear the previous primary photo: ${safeErrorMessage(error)}`;
    }
  }

  try {
    await client.patch(
      `rest/v1/species_media?id=eq.${encodeURIComponent(mainMedia.id)}&species_id=eq.${speciesId}`,
      { is_primary: true }
    );
    mainMedia.is_primary = true;
    return null;
  } catch (error) {
    if (previousPrimary) {
      try {
        await client.patch(
          `rest/v1/species_media?id=eq.${encodeURIComponent(previousPrimary.id)}&species_id=eq.${speciesId}`,
          { is_primary: true }
        );
        previousPrimary.is_primary = true;
      } catch (restoreError) {
        return `Could not set the main photo (${safeErrorMessage(error)}); could not restore the previous primary (${safeErrorMessage(restoreError)})`;
      }
    }
    return `Could not set the main photo: ${safeErrorMessage(error)}`;
  }
}

function failedResult(task, reason) {
  task.result = { status: 'failed', reason };
  console.error(`FAILED  ${task.scientificName || task.speciesId} photo ${task.sourcePhotoId}: ${reason}`);
}

async function importOne(client, task, existingMedia, primaryRows, sfcPrimary) {
  if (task.error) {
    failedResult(task, task.error);
    return;
  }
  const existing = existingMedia.get(task.sourcePhotoId);
  if (existing) {
    task.media = existing;
    task.result = { status: 'skipped', reason: 'Already imported' };
    console.log(`SKIPPED  ${task.scientificName} photo ${task.sourcePhotoId}: already imported`);
    return;
  }

  let filePath;
  let uploaded = false;
  try {
    let downloaded;
    try {
      downloaded = await downloadImage(task.candidate.imageUrl);
    } catch (error) {
      if (
        task.candidate.fallbackImageUrl === task.candidate.imageUrl ||
        (error.status !== 404 && error.code !== 'IMAGE_TOO_LARGE')
      ) {
        throw error;
      }
      downloaded = await downloadImage(task.candidate.fallbackImageUrl);
    }
    const jpeg = await normalizeToJpeg(downloaded);
    filePath = `${task.speciesId}/${randomUUID()}.jpg`;

    uploaded = true;
    await client.upload(filePath, jpeg);

    let inserted;
    try {
      inserted = await client.insert('species_media', {
        species_id: task.speciesId,
        file_path: filePath,
        media_type: 'image/jpeg',
        is_primary: Boolean(task.isMain && !sfcPrimary && !primaryRows.some((row) => row.is_primary)),
        source: 'inaturalist',
        source_photo_id: task.sourcePhotoId,
        source_url: task.candidate.sourceUrl,
        licence_code: task.candidate.licence,
        attribution: task.candidate.attribution,
        photographer: task.candidate.photographer || null,
        reviewed_by: task.candidate.officerName,
        imported_at: new Date().toISOString(),
      });
    } catch (error) {
      let latest = [];
      try {
        latest = await client.get(queryPath(
          'species_media',
          {
            species_id: `eq.${task.speciesId}`,
            source: 'eq.inaturalist',
            source_photo_id: `eq.${task.sourcePhotoId}`,
          },
          'id,species_id,source,source_photo_id,file_path,is_primary'
        ));
      } catch (lookupError) {
        error.message += `; could not verify an uncertain insert: ${safeErrorMessage(lookupError)}`;
      }
      if (Array.isArray(latest) && latest.length) {
        task.media = latest[0];
        existingMedia.set(task.sourcePhotoId, latest[0]);
        task.result = {
          status: latest[0].file_path === filePath ? 'imported' : 'skipped',
          reason: latest[0].file_path === filePath
            ? 'Uploaded and recorded'
            : 'Already imported by a concurrent run',
          filePath: latest[0].file_path,
          mediaId: latest[0].id,
        };
        if (latest[0].is_primary) primaryRows.push(latest[0]);
        if (uploaded && latest[0].file_path !== filePath) {
          try {
            await client.remove(filePath);
            uploaded = false;
          } catch (cleanupError) {
            error.message += `; storage cleanup failed: ${safeErrorMessage(cleanupError)}`;
          }
        } else {
          uploaded = false;
        }
        console.log(
          `${task.result.status === 'imported' ? 'IMPORTED' : 'SKIPPED'}  ` +
          `${task.scientificName} photo ${task.sourcePhotoId}`
        );
        return;
      }
      throw error;
    }

    let media = Array.isArray(inserted) ? inserted[0] : null;
    if (!media?.id) {
      const latest = await client.get(queryPath(
        'species_media',
        {
          species_id: `eq.${task.speciesId}`,
          source: 'eq.inaturalist',
          source_photo_id: `eq.${task.sourcePhotoId}`,
        },
        'id,species_id,source,source_photo_id,file_path,is_primary'
      ));
      if (!Array.isArray(latest) || latest.length === 0) {
        throw new Error('Photo row was inserted but could not be confirmed');
      }
      media = latest[0];
      if (media.file_path !== filePath) {
        await client.remove(filePath);
        uploaded = false;
        task.media = media;
        existingMedia.set(task.sourcePhotoId, media);
        task.result = { status: 'skipped', reason: 'Already imported by a concurrent run' };
        console.log(`SKIPPED  ${task.scientificName} photo ${task.sourcePhotoId}: already imported`);
        return;
      }
    }
    uploaded = false;
    task.media = media;
    existingMedia.set(task.sourcePhotoId, media);
    if (media.is_primary) primaryRows.push(media);
    task.result = { status: 'imported', reason: 'Uploaded and recorded', filePath, mediaId: media.id };
    console.log(`IMPORTED  ${task.scientificName} photo ${task.sourcePhotoId}`);
  } catch (error) {
    let message = safeErrorMessage(error);
    if (uploaded && filePath) {
      try {
        await client.remove(filePath);
      } catch (cleanupError) {
        message += `; storage cleanup failed: ${safeErrorMessage(cleanupError)}`;
      }
    }
    failedResult(task, message);
  }
}

async function applyPlan(tasks, noSelectionSpecies) {
  const client = createSupabaseClient();
  const grouped = new Map();
  for (const task of tasks) {
    const group = grouped.get(task.speciesId) ?? [];
    group.push(task);
    grouped.set(task.speciesId, group);
  }

  const primaryFailures = [];
  for (const [speciesId, speciesTasks] of grouped) {
    let mediaRows;
    try {
      mediaRows = await getSpeciesState(client, speciesId);
    } catch (error) {
      for (const task of speciesTasks) failedResult(task, safeErrorMessage(error));
      continue;
    }

    const existingMedia = new Map(
      mediaRows
        .filter((row) => row.source === 'inaturalist' && row.source_photo_id !== null)
        .map((row) => [String(row.source_photo_id), row])
    );
    const primaryRows = mediaRows.filter((row) => row.is_primary);
    const sfcPrimary = primaryRows.some((row) => row.source !== 'inaturalist');

    for (const task of speciesTasks) {
      await importOne(client, task, existingMedia, primaryRows, sfcPrimary);
    }

    if (sfcPrimary) {
      const demotionError = await setPrimary(client, speciesId, primaryRows, null, true);
      if (demotionError) primaryFailures.push({ task: speciesTasks[0], reason: demotionError });
      continue;
    }

    const mainTask = speciesTasks.find((task) => task.isMain);
    if (!mainTask || mainTask.error || !['imported', 'skipped'].includes(mainTask.result?.status)) {
      continue;
    }
    const mainMedia = mainTask?.media ?? existingMedia.get(mainTask?.sourcePhotoId);
    if (!mainMedia) continue;

    const primaryError = await setPrimary(client, speciesId, primaryRows, mainMedia, false);
    if (primaryError) {
      mainTask.result.primaryError = primaryError;
      primaryFailures.push({ task: mainTask, reason: primaryError });
    }
  }

  for (const { task, reason } of primaryFailures) {
    console.error(`PRIMARY FAILED  ${task.scientificName} photo ${task.sourcePhotoId}: ${reason}`);
  }

  const results = tasks.map((task) => ({
    species_id: task.speciesId,
    scientific_name: task.scientificName,
    source_photo_id: task.sourcePhotoId,
    main_photo_id: task.mainPhotoId,
    officer_name: task.officerName,
    result: task.result?.status ?? 'failed',
    reason: task.result?.reason ?? task.error ?? 'No result',
    file_path: task.result?.filePath ?? task.media?.file_path ?? '',
    media_id: task.result?.mediaId ?? task.media?.id ?? '',
    primary_error: task.result?.primaryError ?? '',
  }));

  const imported = tasks.filter((task) => task.result?.status === 'imported').length;
  const skipped = tasks.filter((task) => task.result?.status === 'skipped').length;
  const failed = tasks.filter((task) => task.result?.status === 'failed').length + primaryFailures.length;
  console.log(
    `Summary: imported=${imported} skipped=${skipped} failed=${failed}` +
    ` no_selection_species=${noSelectionSpecies}`
  );

  await mkdir(dirname(options.report), { recursive: true });
  await writeFile(options.report, toCsv(REPORT_COLUMNS, results), 'utf8');
  console.log(`Result CSV: ${options.report}`);
  if (failed) process.exitCode = 1;
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    const input = await readFile(options.input, 'utf8');
    const rows = parseCsvObjects(input);
    requireColumns(rows, [
      'species_id',
      'scientific_name',
      'chosen_photo_ids',
      'main_photo_id',
      'officer_name',
    ]);
    const { tasks, noSelectionSpecies } = buildPlan(rows);
    const limitedTasks = options.limit === undefined || tasks.length <= options.limit
      ? tasks
      : [
          ...tasks.filter((task) => task.isMain),
          ...tasks.filter((task) => !task.isMain),
        ].slice(0, options.limit);
    if (options.apply) {
      await applyPlan(limitedTasks, noSelectionSpecies);
    } else {
      printDryRun(limitedTasks, noSelectionSpecies);
    }
  }
} catch (error) {
  console.error(`Import stopped: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
}
