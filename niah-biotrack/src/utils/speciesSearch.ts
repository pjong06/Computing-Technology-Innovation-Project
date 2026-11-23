// Register plant: a plant belongs to a species in the catalogue (cached on the phone, so it
// works offline), or waits for a species request the botanist sent for it.
// Pure (no React Native): tested by src/utils/speciesSearch.test.mjs.

export interface CatalogueSpeciesLike {
  id: string;
  scientific_name: string;
  common_name?: string | null;
  local_name?: string | null;
  taxonomy?: { family?: string | null } | null;
}

const normalise = (text: string | null | undefined) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Catalogue species matching what was typed: scientific, common or local name, any letter
 * case. Names that start with the text come first, then the others, A–Z.
 */
export function searchSpecies<T extends CatalogueSpeciesLike>(species: T[], query: string, max = 6): T[] {
  const q = normalise(query);
  if (!q) return [];
  const names = (item: T) => [item.scientific_name, item.common_name, item.local_name].map(normalise);
  const found = species.filter((item) => names(item).some((name) => name.includes(q)));
  const startsWith = (item: T) => names(item).some((name) => name.startsWith(q));
  return found
    .sort((a, b) => Number(startsWith(b)) - Number(startsWith(a)) || a.scientific_name.localeCompare(b.scientific_name))
    .slice(0, max);
}

/** The catalogue species with exactly this scientific name (any letter case), if any. */
export function catalogueMatch<T extends CatalogueSpeciesLike>(species: T[], scientificName: string | null | undefined): T | null {
  const wanted = normalise(scientificName);
  if (!wanted) return null;
  return species.find((item) => normalise(item.scientific_name) === wanted) ?? null;
}

/**
 * Whether a plant's species is settled enough to upload it: a catalogue species, or a
 * species request it waits for (the officer adds the species, then the plant gets it).
 */
export function speciesReady(record: {
  identificationStatus?: string | null;
  speciesId?: string | null;
  speciesRequestId?: string | null;
}): boolean {
  return (record.identificationStatus === 'identified' && Boolean(record.speciesId)) || Boolean(record.speciesRequestId);
}

/**
 * The line shown for a plant waiting for a species request: the request's name, and the
 * officer's reason when it was not added (the plant keeps waiting until it is sent again).
 */
export function speciesRequestText(
  requestName: string | null | undefined,
  request: { review?: string | null; reviewComment?: string | null } | null | undefined
): { title: string; reason: string | null } {
  const name = (requestName ?? '').trim() || 'a new species';
  if (request?.review === 'rejected') {
    return {
      title: `Species request not added: ${name}`,
      reason: request.reviewComment?.trim() || 'The officer did not give a reason.',
    };
  }
  return { title: `Waiting for species request: ${name}`, reason: null };
}
