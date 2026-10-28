import { SignupProblem, type EarlyAccessSubmit } from './EarlyAccessForm';

/**
 * The ONE network call the public site makes (Decisions DB, Locked 2026-10-28:
 * "Landing-only site exception" + "Early-access signup: one backend route").
 * `src/pages/publicSite.test.ts` fails if any other file reachable from the public
 * entry makes a request, or if this URL changes without the test changing too.
 *
 * Staging backend until S-REL1 moves signups to production.
 */
export const EARLY_ACCESS_URL = 'https://vw7zy9mkyg.us-east-2.awsapprunner.com/api/v1/early-access';

/** Keep in step with backend/src/lib/earlyAccess/constants.ts. */
const POW_PREFIX = 'am-early-access:v1';
const POW_BITS = 16;


// ---------- SHA-256 (sync, small inputs): WebCrypto's per-call cost is too slow for ~65k tries ----------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** First 32 bits of SHA-256(bytes). Enough to count leading zero bits up to 32. */
export const sha256Head = (bytes: Uint8Array): number => {
  const len = bytes.length;
  const blocks = Math.ceil((len + 9) / 64);
  const m = new Uint8Array(blocks * 64);
  m.set(bytes);
  m[len] = 0x80;
  const bitLen = len * 8;
  m[m.length - 4] = bitLen >>> 24;
  m[m.length - 3] = bitLen >>> 16;
  m[m.length - 2] = bitLen >>> 8;
  m[m.length - 1] = bitLen;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) {
      const o = b * 64 + i * 4;
      w[i] = (m[o] << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return h0 >>> 0;
};

const encoder = new TextEncoder();

/** Find a nonce whose hash starts with `bits` zero bits. Yields to the page between chunks. */
export const solvePow = async (email: string, ts: number, bits = POW_BITS): Promise<{ ts: number; nonce: string }> => {
  const limit = 2 ** (32 - bits);
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    if (sha256Head(encoder.encode(`${POW_PREFIX}:${email}:${ts}:${nonce}`)) < limit) return { ts, nonce };
    if (i % 4000 === 3999) await new Promise((r) => setTimeout(r, 0));
  }
};

export const submitEarlyAccess: EarlyAccessSubmit = async ({ email, consentText, website, fillMs }) => {
  const normalised = email.trim().toLowerCase();
  const pow = await solvePow(normalised, Date.now());
  let res: Response;
  try {
    res = await fetch(EARLY_ACCESS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ email: normalised, consentText, website, fillMs, pow }),
    });
  } catch {
    throw new SignupProblem('No connection. Check your internet and try again.');
  }
  if (res.ok) return;
  const message = await res
    .json()
    .then((b: { error?: { message?: unknown } }) => (typeof b?.error?.message === 'string' ? b.error.message : null))
    .catch(() => null);
  throw new SignupProblem(message ?? 'Something went wrong on our side. Try again in a minute.');
};
