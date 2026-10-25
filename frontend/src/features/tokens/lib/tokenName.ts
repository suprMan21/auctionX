/**
 * What an owner calls a token: its item title, else the chip name, else the end
 * of the chip serial. The tag id is the last resort (a chip enrolled before
 * names and serials were recorded).
 */
export const tokenDisplayName = (token: {
  title: string | null;
  tagId: string;
  chipName?: string | null;
  serialSuffix?: string | null;
}): string =>
  token.title ??
  token.chipName ??
  (token.serialSuffix ? `Token …${token.serialSuffix}` : `Token ${token.tagId.slice(0, 8).toUpperCase()}`);
