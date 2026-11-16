import type { SpeciesMedia } from '../api/species';

export function orderSpeciesMedia(photos: readonly SpeciesMedia[] | undefined): SpeciesMedia[] {
  return [...(photos ?? [])].sort((a, b) =>
    Number(b.source === 'sfc') - Number(a.source === 'sfc')
  );
}

export function preferredSpeciesPhoto(
  photos: readonly SpeciesMedia[] | undefined
): SpeciesMedia | undefined {
  const ordered = orderSpeciesMedia(photos);
  return (
    ordered.find((photo) => photo.source === 'sfc' && photo.is_primary) ??
    ordered.find((photo) => photo.source === 'sfc') ??
    ordered.find((photo) => photo.is_primary) ??
    ordered[0]
  );
}
