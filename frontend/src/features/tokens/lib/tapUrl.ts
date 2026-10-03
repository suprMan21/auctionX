/**
 * The URL a chip tap opens: `/verify/<tokenName>?picc_data=<32 hex>&cmac=<16 hex>`
 * (short form `e` / `c` is accepted too; see backend ntag424Codec.ts).
 */

const LONG = { picc: 'picc_data', cmac: 'cmac' } as const;
const SHORT = { picc: 'e', cmac: 'c' } as const;

const HEX = /^[0-9a-fA-F]+$/;

export const hasSunParams = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return [LONG, SHORT].some((keys) => {
    const picc = params.get(keys.picc);
    const cmac = params.get(keys.cmac);
    return Boolean(picc && cmac && HEX.test(picc) && HEX.test(cmac));
  });
};

/** The query string with every SUN parameter removed (other params survive). */
export const withoutSunParams = (search: string): string => {
  const params = new URLSearchParams(search);
  for (const key of [LONG.picc, LONG.cmac, SHORT.picc, SHORT.cmac]) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
};
