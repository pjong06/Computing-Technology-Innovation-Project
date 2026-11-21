// photoCredit.ts - the plain-text credit under an iNaturalist reference photo:
//   "Photo: <name>, <licence> via iNaturalist"
// The web portal has the same logic in frontend/js/shared.js (between the "photo credit"
// markers); backend/test/photoCredit.test.js checks that both give the same result.
// Plain TypeScript with no imports, so Node can load it in that test.

const LICENCE_LABELS: Record<string, string> = {
  cc0: 'CC0',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
};

export interface PhotoCreditFields {
  photographer?: string | null;
  attribution?: string | null;
  licence_code?: string | null;
  source?: string | null;
}

// A credit is needed only for iNaturalist photos under CC BY / CC BY-SA (and any licence we
// can't confirm). CC0 photos and SFC's own photos never show one. Same rule as
// needsPhotoCredit in frontend/js/shared.js.
export function needsPhotoCredit(photo: PhotoCreditFields | null | undefined): boolean {
  return !!photo && photo.source === 'inaturalist' && photo.licence_code !== 'cc0';
}

// The photographer's name from iNaturalist's credit sentence, or '' when it has none.
//   "(c) Samuel Frankel, some rights reserved (CC BY), uploaded by Samuel Frankel" -> "Samuel Frankel"
//   "no rights reserved, uploaded by Meng-Ying Tsai" (CC0) -> "Meng-Ying Tsai"
//   "Jane Doe" -> "Jane Doe";  "no rights reserved" -> ""
export function nameFromAttribution(text: string | null | undefined): string {
  const value = String(text ?? '').trim();
  if (!value) return '';

  const copyright = /^(?:\(c\)|©)\s*/i.exec(value);
  if (copyright) return value.slice(copyright[0].length).split(',')[0].trim();

  const uploadedAt = value.toLowerCase().indexOf('uploaded by ');
  if (uploadedAt !== -1) return value.slice(uploadedAt + 'uploaded by '.length).split(',')[0].trim();

  const first = value.split(',')[0].trim();
  return first.toLowerCase().includes('rights reserved') ? '' : first;
}

// The name to show: the photographer field, otherwise the name inside the attribution.
// A photographer field that holds a whole credit sentence is cleaned the same way.
export function photoCreditName(photo: PhotoCreditFields): string {
  const photographer = String(photo.photographer ?? '').trim();
  const fromPhotographer = /^(?:\(c\)|©)/i.test(photographer)
    ? nameFromAttribution(photographer)
    : photographer;
  return fromPhotographer || nameFromAttribution(photo.attribution) || 'Unknown photographer';
}

export function photoLicenceLabel(code: string | null | undefined): string {
  return (code && LICENCE_LABELS[code]) || 'Unknown licence';
}

export function photoCreditText(photo: PhotoCreditFields): string {
  return `Photo: ${photoCreditName(photo)}, ${photoLicenceLabel(photo.licence_code)} via iNaturalist`;
}

export interface PhotoCreditRow {
  key: string;
  species: string;
  commonName: string;
  photographer: string;
  licence: string;
}

// Every credited photo for the Photo credits screen: species, photographer and licence,
// sorted by species then photographer. CC0 and SFC's own photos are left out.
export function photoCreditRows(
  speciesList: {
    id: string;
    scientific_name: string;
    common_name?: string | null;
    species_media?: (PhotoCreditFields & { id?: string })[] | null;
  }[]
): PhotoCreditRow[] {
  const rows: PhotoCreditRow[] = [];
  for (const species of speciesList) {
    (species.species_media ?? []).forEach((photo, index) => {
      if (!needsPhotoCredit(photo)) return;
      rows.push({
        key: `${species.id}:${photo.id ?? index}`,
        species: species.scientific_name || 'Unnamed species',
        commonName: species.common_name ?? '',
        photographer: photoCreditName(photo),
        licence: photoLicenceLabel(photo.licence_code),
      });
    });
  }
  return rows.sort(
    (a, b) => a.species.localeCompare(b.species) || a.photographer.localeCompare(b.photographer)
  );
}
