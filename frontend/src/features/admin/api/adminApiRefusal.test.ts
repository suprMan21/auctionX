import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S-ADMIN2: a refused admin request (401/403) tells the route guard to
 * re-check access at once; other failures and GET /admin/me itself do not.
 */

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
}));

import { adminApi, onAdminRequestRefused } from './adminApi';

const answer = (status: number) =>
  vi.fn(async () => new Response(JSON.stringify({ success: false, data: null, error: 'x', code: 'FORBIDDEN' }), { status }));

describe('refused admin requests', () => {
  let heard: number;
  beforeEach(() => { heard = 0; });

  it.each([401, 403])('%s on a console request → listeners hear it', async (status) => {
    vi.stubGlobal('fetch', answer(status));
    const off = onAdminRequestRefused(() => { heard += 1; });
    await expect(adminApi.getAccountSettings()).rejects.toMatchObject({ status });
    off();
    expect(heard).toBe(1);
  });

  it('500 → not a refusal', async () => {
    vi.stubGlobal('fetch', answer(500));
    const off = onAdminRequestRefused(() => { heard += 1; });
    await expect(adminApi.getAccountSettings()).rejects.toMatchObject({ status: 500 });
    off();
    expect(heard).toBe(0);
  });

  it('GET /admin/me refused → not re-announced (the guard asked)', async () => {
    vi.stubGlobal('fetch', answer(403));
    const off = onAdminRequestRefused(() => { heard += 1; });
    await expect(adminApi.getMe()).rejects.toMatchObject({ status: 403 });
    off();
    expect(heard).toBe(0);
  });
});
