// units.ts - plant height and diameter units.
//
// Botanists TYPE height in metres and diameter in centimetres. The database stores both in
// centimetres (observations.height_cm, observations.diameter_cm). Height is converted here
// before saving and back to metres for display; diameter is stored as typed (in cm).
//
// Plain TypeScript with no imports, so `node --test` can run src/utils/units.test.mjs
// directly (Node 22.18+ runs .ts files without a build step). See package.json "test".

export const HEIGHT_MIN_M = 0.01;
export const HEIGHT_MAX_M = 100;
export const DIAMETER_MIN_CM = 0.1;
export const DIAMETER_MAX_CM = 500;

export type MeasurementCheck =
  | { ok: true; value: number }
  | { ok: false; message: string };

// Metres to whole centimetres (2.345 m -> 235 cm). Height is stored to the nearest cm.
export function metresToCm(metres: number): number {
  return Math.round(metres * 100);
}

// Centimetres to metres with at most 2 decimals (235 cm -> 2.35 m, 200 cm -> 2 m).
export function cmToMetres(centimetres: number): number {
  return Math.round(centimetres) / 100;
}

// Diameter keeps its decimals; only floating-point noise is removed (12.345 -> 12.35).
export function roundDiameterCm(centimetres: number): number {
  return Math.round(centimetres * 100) / 100;
}

// Reads a typed number: digits with an optional decimal point (a comma also counts as the
// decimal point). Returns null for empty or anything else ("abc", "1.2.3", "-1", "1e3").
export function parseMeasurement(text: string | null | undefined): number | null {
  const cleaned = String(text ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Checks a typed height in metres. ok -> value is the height in metres.
export function checkHeightMetres(text: string | null | undefined): MeasurementCheck {
  if (String(text ?? '').trim() === '') {
    return { ok: false, message: 'Enter the height in metres.' };
  }
  const metres = parseMeasurement(text);
  if (metres === null) {
    return { ok: false, message: 'Height must be a number in metres, for example 2.5.' };
  }
  if (metres < HEIGHT_MIN_M || metres > HEIGHT_MAX_M) {
    return { ok: false, message: `Height must be between ${HEIGHT_MIN_M} and ${HEIGHT_MAX_M} metres.` };
  }
  return { ok: true, value: metres };
}

// Checks a typed diameter in centimetres. ok -> value is the diameter in cm (decimals kept).
export function checkDiameterCm(text: string | null | undefined): MeasurementCheck {
  if (String(text ?? '').trim() === '') {
    return { ok: false, message: 'Enter the diameter in centimetres.' };
  }
  const centimetres = parseMeasurement(text);
  if (centimetres === null) {
    return { ok: false, message: 'Diameter must be a number in centimetres, for example 12.5.' };
  }
  if (centimetres < DIAMETER_MIN_CM || centimetres > DIAMETER_MAX_CM) {
    return { ok: false, message: `Diameter must be between ${DIAMETER_MIN_CM} and ${DIAMETER_MAX_CM} centimetres.` };
  }
  return { ok: true, value: roundDiameterCm(centimetres) };
}

// "2.35 m" from a height stored in cm, or null when there is none.
export function formatHeightFromCm(centimetres: number | null | undefined): string | null {
  if (centimetres === null || centimetres === undefined || !Number.isFinite(centimetres)) return null;
  return `${cmToMetres(centimetres)} m`;
}

// "12.5 cm" from a diameter stored in cm, or null when there is none.
export function formatDiameterCm(centimetres: number | null | undefined): string | null {
  if (centimetres === null || centimetres === undefined || !Number.isFinite(centimetres)) return null;
  return `${roundDiameterCm(centimetres)} cm`;
}
