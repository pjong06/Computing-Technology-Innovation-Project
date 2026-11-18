// Accepts "NIAH-PLT-00001", " niah-plt-00001 ", or "https://x.com/p/NIAH-PLT-00001"
// Returns "NIAH-PLT-00001" or null
export function parseTagCode(raw: string): string | null {
  // Trim spaces and use upper case.
  let value = raw.trim().toUpperCase();
  // A URL: keep only the part after the last "/".
  if (value.includes('/')){
    value = value.split('/').pop() ?? '';
  }
  // NIAH-PLT- followed by exactly 5 digits.
  const isValid = /^NIAH-PLT-\d{5}$/.test(value);
  return isValid ? value : null;

}