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

const RESTRICTED_VISITOR_CODES = new Set(['CR', 'EN', 'VU', 'EW', 'EX']);
const RESTRICTED_VISITOR_TERMS = [
  'critically endangered',
  'endangered',
  'vulnerable',
  'extinct',
  'high risk',
  'high-risk',
  'totally protected',
  'sensitive',
  'restricted',
];

export function isRestrictedForVisitors(
  status: string | null | undefined,
  extra?: {
    is_high_risk?: boolean;
    isHighRisk?: boolean;
    is_sensitive?: boolean;
    isSensitive?: boolean;
  } | null
): boolean {
  if (
    extra?.is_high_risk === true ||
    extra?.isHighRisk === true ||
    extra?.is_sensitive === true ||
    extra?.isSensitive === true
  ) {
    return true;
  }

  const raw = (status ?? '').trim();
  if (!raw) return false;
  if (RESTRICTED_VISITOR_CODES.has(raw.toUpperCase())) return true;

  const lower = raw.toLowerCase();
  return RESTRICTED_VISITOR_TERMS.some((term) => lower.includes(term));
}

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

// Plain-language status for visitors: a short badge label and a one-line meaning.
// A missing status is "Not assessed", never guessed.
const PLAIN_STATUS: Record<string, { label: string; meaning: string }> = {
  LC: { label: 'Not at risk', meaning: 'This plant is common enough that it is not considered at risk.' },
  NT: { label: 'Near threatened', meaning: 'This plant could become threatened in the near future.' },
  VU: { label: 'Vulnerable', meaning: 'This plant is at high risk of disappearing from the wild.' },
  EN: { label: 'Endangered', meaning: 'This plant is at very high risk of disappearing from the wild.' },
  CR: { label: 'Critically endangered', meaning: 'This plant is at extremely high risk of disappearing from the wild.' },
  DD: { label: 'Not enough data', meaning: 'There is not enough information yet to judge how at risk it is.' },
  NA: { label: 'Not assessed', meaning: 'Its risk has not been assessed yet.' },
};

export function plainConservationStatus(status: string | null | undefined): {
  code: string;
  label: string;
  meaning: string;
} {
  const code = conservationStatusCode(status);
  const plain = PLAIN_STATUS[code] ?? PLAIN_STATUS.NA;
  return { code, ...plain };
}