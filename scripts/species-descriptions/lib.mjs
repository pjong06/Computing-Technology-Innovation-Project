// lib.mjs - the pure parts of fill.mjs (no network): which EMPTY species fields get a draft,
// which stay empty, and the CSV report. Tested by backend/test/speciesDescriptionDrafts.test.js.

export const TEXT_FIELDS = ['description', 'habitat', 'common_name'];
export const ALL_FIELDS = [...TEXT_FIELDS, 'family'];
export const REPORT_COLUMNS = ['species', 'field', 'old_value', 'new_value', 'action', 'species_id'];

// A field counts as empty when it is null, missing, or only spaces.
export function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

// The draft for a scientific name: exact match first, then ignoring case and extra spaces.
export function findDraft(drafts, scientificName) {
  if (typeof scientificName !== 'string') return null;
  if (Object.hasOwn(drafts, scientificName)) return drafts[scientificName];
  const wanted = scientificName.trim().replace(/\s+/g, ' ').toLowerCase();
  const key = Object.keys(drafts).find((name) => name.toLowerCase() === wanted);
  return key ? drafts[key] : null;
}

// The genus a record names, or null for family-level, tribe-level and broad records.
const ABOVE_GENUS = /(aceae|oideae|eae|inae)$/;
const BROAD_GROUPS = new Set(['Plantae', 'Tracheophyta', 'Angiospermae', 'Magnoliopsida', 'Bryophyta',
  'Marchantiophyta', 'Polypodiopsida', 'Polypodiineae']);
export function genusOf(scientificName) {
  const first = String(scientificName ?? '').trim().split(/\s+/)[0] ?? '';
  if (!/^[A-Z][a-z-]+$/.test(first) || BROAD_GROUPS.has(first) || ABOVE_GENUS.test(first)) return null;
  return first;
}

// For each approved species: a "fill" for every EMPTY field that has a draft, and a
// "left empty" line for every empty field without one. Filled-in fields are never touched.
//   species: { id, scientific_name, description, habitat, common_name, taxonomy: { family, ... } | null }
export function planFills(species, drafts) {
  const fills = [];
  const gaps = [];
  for (const row of species) {
    const draft = findDraft(drafts, row.scientific_name);
    const current = {
      description: row.description,
      habitat: row.habitat,
      common_name: row.common_name,
      family: row.taxonomy?.family ?? null,
    };
    for (const field of ALL_FIELDS) {
      if (!isEmpty(current[field])) continue;
      const base = { species_id: row.id, species: row.scientific_name ?? '', field, old_value: current[field] ?? '' };
      const proposed = draft?.[field];
      if (typeof proposed === 'string' && proposed.trim()) {
        fills.push({ ...base, new_value: proposed.trim(), action: 'fill' });
      } else {
        gaps.push({
          ...base,
          new_value: '',
          action: draft ? 'left empty: no confident draft (please fill in)' : 'left empty: no draft for this name',
        });
      }
    }
  }
  return { fills, gaps };
}

// The taxonomy row a species should point to once its family is filled: its current
// classification with the family added (and the genus from the name when it has none).
export function targetTaxonomy(current, family, scientificName) {
  return {
    kingdom: current?.kingdom ?? 'Plantae',
    division: current?.division ?? null,
    class_name: current?.class_name ?? null,
    order_name: current?.order_name ?? null,
    family,
    genus: current?.genus ?? genusOf(scientificName),
  };
}
