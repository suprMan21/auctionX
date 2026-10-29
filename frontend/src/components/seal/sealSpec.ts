/**
 * S-SEAL1 Ph2a: the public part of a seal spec, as the backend sends it (lib/seal/ensureSealSpec.ts).
 * The pattern is decoration seeded from the public seal code; only a tap proves a seal.
 */
export type SealSpecView = {
  readonly v: 1;
  readonly colors: string;
  readonly pattern: {
    readonly kind: 'hypotrochoid';
    readonly version: 1;
    /** [outer ring, inner ring] in the 120×120 badge box. */
    readonly paths: readonly string[];
  };
};

/** Colour pairs by key. One pair until S-SEAL2 (creator choice). Unknown keys fall back to it. */
export const SEAL_COLOR_PAIRS: Readonly<Record<string, readonly [string, string, string]>> = {
  'am-default': ['#a78bfa', '#7c3aed', '#3b82f6'],
};

export const sealColors = (key: string | undefined): readonly [string, string, string] =>
  (key && SEAL_COLOR_PAIRS[key]) || SEAL_COLOR_PAIRS['am-default'];

/** Only M / l / Z path commands are ever drawn (same rule as the server). */
export const SEAL_PATH = /^M[-\d. l]+Z$/;
