/**
 * What an owner calls a seal: its item title, else "Seal <seal code>" (S-SEAL1),
 * else the end of the chip serial, else the tag id. Never the internal chip name:
 * customers only ever see "seal" (Decision Locked 2026-10-28). chipName is still
 * accepted so callers don't change, but it is not shown.
 */
export const tokenDisplayName = (token: {
  title: string | null;
  tagId: string;
  sealCode?: string | null;
  chipName?: string | null;
  serialSuffix?: string | null;
}): string =>
  token.title ??
  (token.sealCode ? `Seal ${token.sealCode}` : null) ??
  (token.serialSuffix ? `Seal …${token.serialSuffix}` : `Seal ${token.tagId.slice(0, 8).toUpperCase()}`);
