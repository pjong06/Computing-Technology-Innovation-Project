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

export function photoCreditText(photo: PhotoCreditFields): string {
  const licence = (photo.licence_code && LICENCE_LABELS[photo.licence_code]) || 'Unknown licence';
  return `Photo: ${photoCreditName(photo)}, ${licence} via iNaturalist`;
}
