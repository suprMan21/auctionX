/**
 * Disclosure fields as the owner sees them: a label, and the provenance column
 * the public verify page shows when the field is on (and the creator released it).
 */

import type { DisclosureField, Provenance } from '../api/schemas';

interface FieldInfo {
  readonly label: string;
  readonly value: (p: Provenance) => string | null;
}

export const DISCLOSURE_INFO: Record<DisclosureField, FieldInfo> = {
  creator_name: { label: 'Creator name', value: (p) => p.creator_name },
  claim_date: {
    label: 'Claim date',
    value: (p) => (p.claim_date ? new Date(p.claim_date).toLocaleDateString() : null),
  },
  location: { label: 'Origin location', value: (p) => p.origin_location },
  origin_video: { label: 'Origin video', value: (p) => (p.origin_video_url ? 'Video link' : null) },
};
