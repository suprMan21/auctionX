/**
 * What an owner calls a seal: its item title, else its seal code (S-SEAL1), else
 * the chip name, else the end of the chip serial. The tag id is the last resort (a
 * chip enrolled before names and serials were recorded). The seal code comes before
 * the chip name so collectors see "Seal 7K3Q-9XWD", never an internal chip name, once
 * the backend sends codes.
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
  token.chipName ??
  (token.serialSuffix ? `Token …${token.serialSuffix}` : `Token ${token.tagId.slice(0, 8).toUpperCase()}`);
