// Accepts "NIAH-PLT-00001", " niah-plt-00001 ", or "https://x.com/p/NIAH-PLT-00001"
// Returns "NIAH-PLT-00001" or null
export function parseTagCode(raw: string): string | null {
  // TODO 1: trim spaces and convert to upper case
  let value = raw.trim().toUpperCase();
  // TODO 2: if it's a URL, keep only the part after the last "/"
  if (value.includes('/')){
    value = value.split('/').pop() ?? '';
  }
  // TODO 3: check it matches: NIAH-PLT- followed by exactly 5 digits
  const isValid = /^NIAH-PLT-\d{5}$/.test(value);
  // TODO 4: return the clean code, or null
  return isValid ? value : null;

}