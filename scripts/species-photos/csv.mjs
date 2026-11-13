// csv.mjs - small CSV reader/writer shared by the species-photo scripts (no packages).

// Parses CSV text (RFC 4180: quoted fields, "" inside quotes, CRLF or LF) into rows of strings.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(value => value.trim() !== ''));
}

// Parses CSV text into objects keyed by the (trimmed, lower-case) header names.
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  const header = (rows.shift() || []).map(name => name.trim().toLowerCase());
  return rows.map(values => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])));
}

function csvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Writes objects as CSV with these columns. The byte-order mark lets Excel show names
// like "Tomáš" correctly.
export function toCsv(header, records) {
  const lines = [header.map(csvValue).join(',')];
  for (const record of records) lines.push(header.map(column => csvValue(record[column])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
