// IUCN conservation status codes, as stored on species.conservation_status.
// Same labels and colours as the Species tab.
const STATUS_LABELS: Record<string, string> = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
  DD: 'Data Deficient',
  NA: 'Not assessed',
};

// A missing status is shown as "NA" (Not assessed), never guessed.
export function conservationStatusCode(status: string | null | undefined): string {
  return status?.trim() || 'NA';
}

export function conservationStatusLabel(code: string): string {
  return STATUS_LABELS[code] ?? code;
}

export function conservationStatusColors(code: string): { bg: string; text: string } {
  switch (code) {
    case 'CR':
    case 'EN':
      return { bg: '#FDE2E2', text: '#9B1C1C' };
    case 'VU':
    case 'NT':
      return { bg: '#FEF08A', text: '#854D0E' };
    case 'LC':
      return { bg: '#E4F2E7', text: '#215A36' };
    default:
      return { bg: '#EEF1EF', text: '#5B6B60' };
  }
}
