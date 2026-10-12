// Formats a GPS fix for display, e.g. "3.81760° N, 113.78100° E (±5 m)".
// Negative latitudes are south and negative longitudes are west.
export function formatCoordinates(latitude: number, longitude: number, accuracyM: number | null): string {
  const lat = `${Math.abs(latitude).toFixed(5)}° ${latitude < 0 ? 'S' : 'N'}`;
  const lng = `${Math.abs(longitude).toFixed(5)}° ${longitude < 0 ? 'W' : 'E'}`;
  const accuracy = accuracyM === null ? '' : ` (±${Math.round(accuracyM)} m)`;
  return `${lat}, ${lng}${accuracy}`;
}

// Describes how trustworthy a fix is, based only on the accuracy the device reported.
export function describeAccuracy(accuracyM: number | null): string {
  if (accuracyM === null) return 'Accuracy unknown';
  if (accuracyM <= 10) return 'Good fix';
  if (accuracyM <= 25) return 'Fair fix';
  return 'Weak fix';
}
