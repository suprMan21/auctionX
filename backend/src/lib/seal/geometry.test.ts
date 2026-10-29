import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEAL_GEOMETRY } from './geometry';

/** Same pinned value as frontend/src/components/seal/geometry.test.ts. Change both together. */
export const SEAL_GEOMETRY_SHA256 = 'f7796b2b6a16b6cfd41279a1e4e24ac64d074dceef3524b70a1470e53ab57434';

describe('seal geometry', () => {
  it('matches the pinned hash shared with the website copy', () => {
    expect(createHash('sha256').update(JSON.stringify(SEAL_GEOMETRY)).digest('hex')).toBe(SEAL_GEOMETRY_SHA256);
  });
});
