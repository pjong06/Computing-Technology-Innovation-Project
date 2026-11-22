// lib.mjs - the pure parts of check.mjs: accepting a GBIF name match, turning GBIF's IUCN Red
// List category into the value we store in species.conservation_status, the conflict rule,
// GBIF rank -> species.taxon_rank, the capitalisation check and the report. No network, no
// files, so backend/test/speciesStatus.test.js can test it.

// What species.conservation_status holds: the IUCN code, or null for "Not assessed". These
// are the codes the portal and the app know (frontend/js/shared.js STATUS_LABELS).
export const STORED_CODES = ['CR', 'EN', 'VU', 'NT', 'LC', 'DD'];

// Older rows may hold the words instead of the code ("Least Concern"): read as the code.
const WORDS_TO_CODE = {
  'critically endangered': 'CR',
  endangered: 'EN',
  vulnerable: 'VU',
  'near threatened': 'NT',
  'least concern': 'LC',
  'data deficient': 'DD',
  extinct: 'EX',
  'extinct in the wild': 'EW',
  'not evaluated': null,
  'not assessed': null,
};

// GBIF's category names (and the short codes it also sends) -> IUCN code.
const GBIF_CATEGORY_TO_CODE = {
  LEAST_CONCERN: 'LC',
  NEAR_THREATENED: 'NT',
  VULNERABLE: 'VU',
  ENDANGERED: 'EN',
  CRITICALLY_ENDANGERED: 'CR',
  DATA_DEFICIENT: 'DD',
  EXTINCT: 'EX',
  EXTINCT_IN_THE_WILD: 'EW',
  NOT_EVALUATED: 'NE',
  NOT_APPLICABLE: 'NA',
};

/** Our stored value read as an IUCN code (or null for "Not assessed"). */
export function storedCode(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper === 'NE' || upper === 'NA' ? null : upper;
  const fromWords = WORDS_TO_CODE[text.toLowerCase()];
  return fromWords === undefined ? text : fromWords;
}

/**
 * GBIF's answer for /species/{key}/iucnRedListCategory -> what we would store.
 *   { code: 'LC' }            a category we store;
 *   { code: null }            NE / NA / no result: stays "Not assessed";
 *   { code: null, note }      a real category the portal can't show yet (EX, EW, old LR/*).
 */
export function iucnToStored(answer) {
  if (!answer || typeof answer !== 'object') return { iucn: '', code: null };
  const raw = String(answer.code ?? '').trim().toUpperCase() ||
    GBIF_CATEGORY_TO_CODE[String(answer.category ?? '').trim().toUpperCase()] || '';
  const iucn = GBIF_CATEGORY_TO_CODE[raw] ?? raw;
  if (!iucn || iucn === 'NE' || iucn === 'NA') return { iucn: iucn || '', code: null };
  if (STORED_CODES.includes(iucn)) return { iucn, code: iucn };
  return { iucn, code: null, note: `IUCN says ${iucn}, which the portal can't show yet: not stored` };
}

// GBIF ranks at species level or below.
const SPECIES_OR_BELOW = new Set(['SPECIES', 'SUBSPECIES', 'VARIETY', 'SUBVARIETY', 'FORM', 'SUBFORM', 'INFRASPECIFIC_NAME', 'CULTIVAR']);

/** GBIF rank -> species.taxon_rank ('species' | 'genus' | 'family' | 'other'). */
export function rankFromGbif(rank) {
  const upper = String(rank ?? '').trim().toUpperCase();
  if (SPECIES_OR_BELOW.has(upper)) return 'species';
  if (upper === 'GENUS') return 'genus';
  if (upper === 'FAMILY') return 'family';
  return 'other';
}

export function isSpeciesLevel(rank) {
  return SPECIES_OR_BELOW.has(String(rank ?? '').trim().toUpperCase());
}

/**
 * Whether a GBIF /species/match answer is good enough: EXACT, or FUZZY with confidence 95 or
 * more. Returns { ok, reason }. Rank is checked separately (genus and higher are reported).
 */
export function acceptMatch(match) {
  if (!match || !match.usageKey) return { ok: false, reason: 'no match in GBIF' };
  const type = String(match.matchType ?? '').toUpperCase();
  if (type === 'EXACT') return { ok: true, reason: '' };
  if (type === 'FUZZY') {
    return Number(match.confidence) >= 95
      ? { ok: true, reason: '' }
      : { ok: false, reason: `fuzzy match below 95% confidence (${match.confidence ?? '?'})` };
  }
  if (type === 'HIGHERRANK') return { ok: false, reason: `only matched a higher rank (${match.rank ?? '?'})` };
  return { ok: false, reason: `match type ${type || 'unknown'}` };
}

/**
 * What to do with one species' conservation status:
 *   'set'        we have none and IUCN has one we store;
 *   'unchanged'  same as IUCN, or IUCN has none we store;
 *   'conflict'   we have one and IUCN says something else (never overwritten unless
 *                overwriteConflicts);
 * apply: whether --apply would write it.
 */
export function statusAction(current, iucnCode, { overwriteConflicts = false } = {}) {
  const ours = storedCode(current);
  if (!iucnCode) return { action: 'unchanged', apply: false };
  if (!ours) return { action: 'set', apply: true };
  if (ours === iucnCode) return { action: 'unchanged', apply: false };
  return { action: 'conflict', apply: overwriteConflicts };
}

/**
 * A scientific name written wrongly: the genus without its capital, or capitals in the
 * species part; or written differently from GBIF's name (letter case only). '' when fine.
 */
export function capitalisationProblem(name, gbifCanonicalName) {
  const text = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const [genus, ...rest] = text.split(' ');
  const problems = [];
  if (genus && genus[0] !== genus[0].toUpperCase()) problems.push('genus should start with a capital');
  if (genus && genus.slice(1) !== genus.slice(1).toLowerCase()) problems.push('genus should be lower case after its first letter');
  const epithets = rest.filter((word) => !/^(var\.|subsp\.|f\.|×|x)$/i.test(word));
  if (epithets.some((word) => word !== word.toLowerCase())) problems.push('species part should be lower case');
  const gbif = String(gbifCanonicalName ?? '').trim();
  if (gbif && gbif.toLowerCase() === text.toLowerCase() && gbif !== text) problems.push(`GBIF writes it "${gbif}"`);
  return problems.join('; ');
}

export function sourceUrl(usageKey) {
  return usageKey ? `https://www.gbif.org/species/${usageKey}` : '';
}

export const REPORT_COLUMNS = [
  'species_id',
  'species',
  'gbif_name',
  'gbif_rank',
  'match',
  'current_status',
  'iucn_status',
  'action',
  'will_write',
  'current_rank',
  'gbif_taxon_rank',
  'rank_action',
  'capitalisation',
  'note',
  'source_url',
];

/**
 * One species' report row. species: { id, scientific_name, conservation_status, taxon_rank };
 * match: GBIF /species/match answer (or null); iucn: GBIF iucnRedListCategory answer (or
 * null); options: { apply, overwriteConflicts, fixRank }.
 */
export function reportRow(species, match, iucn, options = {}) {
  const accepted = acceptMatch(match);
  const base = {
    species_id: species.id,
    species: species.scientific_name ?? '',
    gbif_name: match?.scientificName ?? '',
    gbif_rank: match?.rank ?? '',
    match: match ? `${match.matchType ?? ''}${match.confidence !== undefined ? ` ${match.confidence}%` : ''}`.trim() : '',
    current_status: species.conservation_status ?? '',
    iucn_status: '',
    action: '',
    will_write: 'no',
    current_rank: species.taxon_rank ?? '',
    gbif_taxon_rank: '',
    rank_action: '',
    capitalisation: capitalisationProblem(species.scientific_name, match?.canonicalName),
    note: '',
    source_url: sourceUrl(match?.usageKey),
  };
  if (!accepted.ok) {
    return { ...base, action: 'not matched', note: accepted.reason, rank_action: 'not matched' };
  }

  const gbifRank = rankFromGbif(match.rank);
  const rankDiffers = gbifRank !== String(species.taxon_rank ?? '');
  base.gbif_taxon_rank = gbifRank;
  base.rank_action = rankDiffers ? (options.fixRank ? 'fix' : 'differs') : 'unchanged';

  if (!isSpeciesLevel(match.rank)) {
    // Genus, family and higher are never given a status.
    return { ...base, action: 'not species level', note: `GBIF rank ${match.rank}` };
  }

  const mapped = iucnToStored(iucn);
  const decision = statusAction(species.conservation_status, mapped.code, options);
  return {
    ...base,
    iucn_status: mapped.iucn,
    action: decision.action,
    will_write: decision.apply ? 'yes' : 'no',
    note: [mapped.note, decision.action === 'conflict' && !decision.apply ? 'kept (use --overwrite-conflicts)' : '']
      .filter(Boolean).join('; '),
    // What --apply writes for this row (status only when allowed).
    _status: decision.apply ? mapped.code : undefined,
  };
}

/** Counts per action, for the summary line. */
export function totals(rows) {
  const counts = {};
  for (const row of rows) counts[row.action] = (counts[row.action] || 0) + 1;
  return counts;
}
