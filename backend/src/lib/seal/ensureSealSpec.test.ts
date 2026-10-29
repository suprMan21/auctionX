import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureSealSpec, publicSealSpec, readStoredSealSpec } from './ensureSealSpec';
import { buildSealSpec } from './sealSpec';

const CODE = 'WAV4F6TT';
const LOG = { requestId: 'r1', route: '/test' };

/** Records the one guarded update ensureSealSpec makes. */
const fakeClient = (result: { error: { message: string } | null } = { error: null }) => {
  const calls: Array<{ values: unknown; eq: [string, unknown]; is: [string, unknown] }> = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe('nfc_tags');
      return {
        update: (values: unknown) => ({
          eq: (c1: string, v1: unknown) => ({
            is: async (c2: string, v2: unknown) => {
              calls.push({ values, eq: [c1, v1], is: [c2, v2] });
              return result;
            },
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
};

describe('ensureSealSpec', () => {
  it('stores a missing spec, guarded by seal_spec IS NULL, and returns it', async () => {
    const { client, calls } = fakeClient();
    const spec = await ensureSealSpec(client, { id: 't1', seal_code: CODE, seal_spec: null }, LOG);
    expect(spec).toEqual(buildSealSpec(CODE));
    expect(calls).toEqual([{ values: { seal_spec: buildSealSpec(CODE) }, eq: ['id', 't1'], is: ['seal_spec', null] }]);
  });

  it('uses a stored spec as is and writes nothing', async () => {
    const { client, calls } = fakeClient();
    const stored = buildSealSpec(CODE);
    expect(await ensureSealSpec(client, { id: 't1', seal_code: CODE, seal_spec: stored }, LOG)).toEqual(stored);
    expect(calls).toHaveLength(0);
  });

  it('never overwrites a stored value it cannot read (write-once)', async () => {
    const { client, calls } = fakeClient();
    const spec = await ensureSealSpec(client, { id: 't1', seal_code: CODE, seal_spec: { v: 99, code: CODE } }, LOG);
    expect(spec).toEqual(buildSealSpec(CODE));
    expect(calls).toHaveLength(0);
  });

  it('returns null without a well-formed seal code', async () => {
    const { client, calls } = fakeClient();
    expect(await ensureSealSpec(client, { id: 't1', seal_code: null, seal_spec: null }, LOG)).toBeNull();
    expect(await ensureSealSpec(client, { id: 't1', seal_code: 'bad', seal_spec: null }, LOG)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a failed store never throws: the built spec is still returned', async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    const quietErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient({ error: { message: 'boom' } });
    expect(await ensureSealSpec(client, { id: 't1', seal_code: CODE, seal_spec: null }, LOG)).toEqual(buildSealSpec(CODE));
    quiet.mockRestore();
    quietErr.mockRestore();
  });
});

describe('readStoredSealSpec', () => {
  it('refuses a spec for another code', () => {
    expect(readStoredSealSpec(buildSealSpec('JCF3MGCK'), CODE)).toBeNull();
  });

  it('refuses paths with anything but M / l / Z commands', () => {
    const spec = buildSealSpec(CODE);
    const bad = { ...spec, pattern: { ...spec.pattern, paths: ['M0 0"/><script>Z'] } };
    expect(readStoredSealSpec(bad, CODE)).toBeNull();
  });

  it('accepts every built spec', () => {
    for (const c of [CODE, 'JCF3MGCK', '5RQPP74E', 'GPKD67QP', '00000000', 'ZZZZZZZZ']) {
      expect(readStoredSealSpec(buildSealSpec(c), c)).not.toBeNull();
    }
  });
});

describe('publicSealSpec', () => {
  it('sends only v, colors and pattern (the code goes out as sealCode)', () => {
    expect(Object.keys(publicSealSpec(buildSealSpec(CODE)) ?? {}).sort()).toEqual(['colors', 'pattern', 'v']);
    expect(publicSealSpec(null)).toBeNull();
  });
});
