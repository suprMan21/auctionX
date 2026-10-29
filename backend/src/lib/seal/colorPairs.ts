/**
 * Seal colour pairs by key (same values as frontend/src/components/seal/sealSpec.ts).
 * One pair until S-SEAL2 (creator choice). Unknown keys fall back to it.
 */
export const SEAL_COLOR_PAIRS: Readonly<Record<string, readonly [string, string, string]>> = {
  'am-default': ['#a78bfa', '#7c3aed', '#3b82f6'],
};

export const sealColors = (key: string | undefined): readonly [string, string, string] =>
  (key && SEAL_COLOR_PAIRS[key]) || SEAL_COLOR_PAIRS['am-default'];
