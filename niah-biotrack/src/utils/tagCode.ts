// Accepts "NIAH-PLT-00001", " niah-plt-00001 ", "niahplt00001", "NIAH PLT 00001" or
// "https://x.com/p/NIAH-PLT-00001". Returns "NIAH-PLT-00001", or null.
// Letter case and separators don't matter (the same rule as normalizePlantTag in
// backend/src/services/qrService.js), so a tag typed without dashes still finds the plant.
export function parseTagCode(raw: string): string | null {
  let value = String(raw ?? '').trim();
  // A URL: keep only the part after the last "/".
  if (value.includes('/')) {
    value = value.split('/').pop() ?? '';
  }
  // Letters and digits only, in upper case: NIAH PLT then exactly 5 digits.
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = /^NIAHPLT(\d{5})$/.exec(compact);
  return match ? `NIAH-PLT-${match[1]}` : null;
}
