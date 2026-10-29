import { describe, expect, it } from 'vitest';
import { SEAL_GEOMETRY } from '@/components/seal/geometry';

/** Same pinned value as backend/src/lib/seal/geometry.test.ts. Change both together. */
const SEAL_GEOMETRY_SHA256 = 'f7796b2b6a16b6cfd41279a1e4e24ac64d074dceef3524b70a1470e53ab57434';

const sha256Hex = async (text: string) => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

describe('seal geometry', () => {
  it('matches the pinned hash shared with the server copy', async () => {
    expect(await sha256Hex(JSON.stringify(SEAL_GEOMETRY))).toBe(SEAL_GEOMETRY_SHA256);
  });
});
