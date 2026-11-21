// lib.mjs - the pure parts of attach-photos.mjs: matching imported plants to their
// iNaturalist sightings, choosing the sighting's photo and checking its licence, and the
// report. No network, no files, so backend/test/inatPlantPhotos.test.js can test it.

// A photo may be used only under one of these licences (the photo's OWN licence, never the
// observation's: they can differ).
export const ALLOWED_LICENCES = new Set(['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc']);
export const IMAGE_HOSTS = new Set(['inaturalist-open-data.s3.amazonaws.com', 'static.inaturalist.org']);
export const MAX_MATCH_METRES = 2;

export const REPORT_COLUMNS = [
  'plant_id',
  'tag',
  'species',
  'matched_sighting',
  'match_method',
  'photo_id',
  'licence',
  'action',
  'reason',
];

// "https://www.inaturalist.org/observations/9919151", "inaturalist.org/observations/9919151?x"
// or "9919151" -> "9919151". Anything else -> null.
export function observationIdFrom(value) {
  const text = String(value ?? '').trim();
  if (/^[1-9]\d{0,14}$/.test(text)) return text;
  const match = /^(?:https?:\/\/)?(?:www\.)?inaturalist\.org\/observations\/([1-9]\d{0,14})(?:[/?#].*)?$/i.exec(text);
  return match ? match[1] : null;
}

// The photo id inside an iNaturalist image URL (".../photos/13606591/medium.jpeg"), or null.
export function photoIdFromImageUrl(value) {
  const match = /\/photos\/(\d+)\//.exec(String(value ?? ''));
  return match ? match[1] : null;
}

export function sameScientificName(a, b) {
  const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return clean(a) !== '' && clean(a) === clean(b);
}

function coordinate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Distance in metres between two points (haversine), or null when either is missing.
export function distanceMetres(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(coordinate);
  if (values.some((value) => value === null)) return null;
  const [a1, o1, a2, o2] = values;
  const radians = Math.PI / 180;
  const dLat = (a2 - a1) * radians;
  const dLon = (o2 - o1) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * radians) * Math.cos(a2 * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// One row of NiahNationalParkPlants.csv (an iNaturalist observation export) -> a sighting.
export function sightingFromCsv(row) {
  return {
    id: observationIdFrom(row.id) ?? observationIdFrom(row.url),
    url: String(row.url ?? '').trim(),
    imageUrl: String(row.image_url ?? '').trim(),
    scientificName: String(row.scientific_name ?? '').trim(),
    latitude: coordinate(row.latitude),
    longitude: coordinate(row.longitude),
    privateLatitude: coordinate(row.private_latitude),
    privateLongitude: coordinate(row.private_longitude),
    observer: String(row.user_name ?? '').trim() || String(row.user_login ?? '').trim(),
  };
}

function nearestDistance(plant, sighting) {
  const distances = [
    distanceMetres(plant.latitude, plant.longitude, sighting.latitude, sighting.longitude),
    distanceMetres(plant.latitude, plant.longitude, sighting.privateLatitude, sighting.privateLongitude),
  ].filter((value) => value !== null);
  return distances.length ? Math.min(...distances) : null;
}

// Matches each plant to one sighting.
//   1. plants.source_url (the observation URL or id). An id that isn't in the CSV still
//      counts: the photo is then read from the iNaturalist API by that id.
//   2. Otherwise the same species (scientific name, ignoring case) within 2 m. Two or more
//      sightings equally near is ambiguous and skipped.
// A sighting is used for one plant only (source_url matches claim theirs first).
// Returns one entry per plant: { plant, sighting, method, reason } (sighting null = skipped).
export function matchPlants(plants, sightings) {
  const byId = new Map();
  for (const sighting of sightings) {
    if (sighting.id && !byId.has(sighting.id)) byId.set(sighting.id, sighting);
  }
  const claimedBy = new Map(); // sighting id -> plant tag/id
  const results = new Map();

  const label = (plant) => plant.tag || plant.id;

  for (const plant of plants) {
    const id = observationIdFrom(plant.sourceUrl);
    if (!id) continue;
    if (claimedBy.has(id)) {
      results.set(plant.id, { plant, sighting: null, method: 'source_url',
        reason: `sighting ${id} is already matched to plant ${claimedBy.get(id)}` });
      continue;
    }
    claimedBy.set(id, label(plant));
    results.set(plant.id, {
      plant,
      sighting: byId.get(id) ?? { id, url: `https://www.inaturalist.org/observations/${id}`, imageUrl: '' },
      method: byId.has(id) ? 'source_url' : 'source_url (not in CSV)',
      reason: '',
    });
  }

  for (const plant of plants) {
    if (results.has(plant.id)) continue;
    if (!String(plant.scientificName ?? '').trim()) {
      results.set(plant.id, { plant, sighting: null, method: '', reason: 'no source_url and no species to match on' });
      continue;
    }
    const near = sightings
      .filter((sighting) => sighting.id && sameScientificName(sighting.scientificName, plant.scientificName))
      .map((sighting) => ({ sighting, metres: nearestDistance(plant, sighting) }))
      .filter((candidate) => candidate.metres !== null && candidate.metres <= MAX_MATCH_METRES)
      .sort((a, b) => a.metres - b.metres);
    if (coordinate(plant.latitude) === null || coordinate(plant.longitude) === null) {
      results.set(plant.id, { plant, sighting: null, method: '', reason: 'no source_url and the plant has no coordinates' });
      continue;
    }
    if (near.length === 0) {
      results.set(plant.id, { plant, sighting: null, method: '', reason: `no sighting of this species within ${MAX_MATCH_METRES} m` });
      continue;
    }
    if (near.length > 1 && near[1].metres - near[0].metres < 0.01) {
      results.set(plant.id, { plant, sighting: null, method: 'species + location',
        reason: `ambiguous: ${near.filter((c) => c.metres - near[0].metres < 0.01).length} sightings equally near (${near.map((c) => c.sighting.id).join(';')})` });
      continue;
    }
    const chosen = near[0].sighting;
    if (claimedBy.has(chosen.id)) {
      results.set(plant.id, { plant, sighting: null, method: 'species + location',
        reason: `sighting ${chosen.id} is already matched to plant ${claimedBy.get(chosen.id)}` });
      continue;
    }
    claimedBy.set(chosen.id, label(plant));
    results.set(plant.id, { plant, sighting: chosen, method: 'species + location', reason: '' });
  }

  return plants.map((plant) => results.get(plant.id));
}

// The sighting's photo from the iNaturalist API answer for its observation: the photo shown
// in the CSV (by id) when it's there, otherwise the observation's first photo.
// Returns { photo } or { reason } (why it can't be used).
export function choosePhoto(observation, csvImageUrl) {
  if (!observation) return { reason: 'observation not found on iNaturalist' };
  const ordered = Array.isArray(observation.observation_photos) && observation.observation_photos.length
    ? [...observation.observation_photos]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((entry) => entry.photo)
      .filter(Boolean)
    : (Array.isArray(observation.photos) ? observation.photos : []);
  if (ordered.length === 0) return { reason: 'observation has no photos' };
  const wanted = photoIdFromImageUrl(csvImageUrl);
  const photo = (wanted && ordered.find((item) => String(item.id) === wanted)) || ordered[0];
  if (photo.hidden || (Array.isArray(photo.flags) && photo.flags.some((flag) => !flag.resolved))) {
    return { reason: 'photo is hidden or flagged on iNaturalist' };
  }
  return { photo };
}

// The photo's own licence, lower case ('' when it has none).
export function photoLicence(photo) {
  return String(photo?.license_code ?? '').trim().toLowerCase();
}

export function licenceAllowed(code) {
  return ALLOWED_LICENCES.has(code);
}

// The URLs to try for the photo, biggest first: "large" (1024 px), then the original size
// variant. Only HTTPS on the two iNaturalist image hosts; anything else -> [].
export function imageUrlsFor(photo) {
  let url;
  try {
    url = new URL(String(photo?.url ?? ''));
  } catch {
    return [];
  }
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    return [];
  }
  const sized = /\/(square|thumb|small|medium|large|original)(\.(?:jpe?g|png|webp))$/i;
  if (!sized.test(url.pathname)) return [url.toString()];
  const variant = (size) => {
    const copy = new URL(url);
    copy.pathname = copy.pathname.replace(sized, `/${size}$2`);
    return copy.toString();
  };
  return [...new Set([variant('large'), variant('medium')])];
}

// The fields stored on the plant_media row for an attached photo.
export function sourceFields(photo, observation) {
  const user = observation?.user ?? {};
  return {
    source: 'inaturalist',
    source_photo_id: Number(photo.id),
    source_url: `https://www.inaturalist.org/photos/${photo.id}`,
    licence_code: photoLicence(photo),
    attribution: String(photo.attribution ?? '').trim(),
    photographer: String(user.name ?? '').trim() || String(user.login ?? '').trim() || null,
  };
}

// Totals by action, plus every skipped licence (for the console and the end of the report).
export function totals(rows) {
  const byAction = {};
  const skippedLicences = [];
  for (const row of rows) {
    byAction[row.action] = (byAction[row.action] ?? 0) + 1;
    if (row.action === 'skipped' && row.reason.startsWith('licence ')) skippedLicences.push(row);
  }
  return { byAction, skippedLicences };
}

// Report rows followed by one TOTAL row per action.
export function reportRecords(rows) {
  const { byAction } = totals(rows);
  return [
    ...rows,
    ...Object.entries(byAction)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([action, count]) => ({ plant_id: 'TOTAL', action, reason: String(count) })),
    { plant_id: 'TOTAL', action: 'plants', reason: String(rows.length) },
  ];
}
