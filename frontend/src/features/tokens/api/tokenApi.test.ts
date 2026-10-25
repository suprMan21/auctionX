import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getSession = vi.hoisted(() =>
  vi.fn(async (): Promise<{ data: { session: { access_token: string } | null } }> => ({ data: { session: null } })),
);
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession } },
}));

import { tokenApi, TokenApiError, __resetInFlightTaps } from './tokenApi';

const SUN = 'https://am.example/verify/chip_001?picc_data=EF963FF7828658A599F3041510671E88&cmac=94EED9EE65337086';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('tokenApi', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetInFlightTaps();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a tap once even when asked twice at the same time (StrictMode)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { valid: false, reason: 'replay_detected' }, error: null }));

    const [a, b] = await Promise.all([tokenApi.tap(SUN), tokenApi.tap(SUN)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ sunMessage: SUN });
    // Anonymous: no Authorization header.
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('keeps the closed-set reason from an error envelope', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        success: false,
        data: null,
        error: 'Your tap has expired or was already used. Please tap the tag again',
        code: 'invalid_argument',
        reason: 'tap_session_invalid',
      }),
    );

    await expect(tokenApi.lookupOwnership('0x' + 'a'.repeat(64))).rejects.toMatchObject({
      status: 400,
      code: 'invalid_argument',
      reason: 'tap_session_invalid',
    });
  });

  it('treats an unexpected response shape as an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { surprise: true }, error: null }));

    await expect(tokenApi.lookupOwnership('0x' + 'a'.repeat(64))).rejects.toBeInstanceOf(TokenApiError);
  });

  it('refuses a signed-in call without a session before touching the network', async () => {
    await expect(tokenApi.myTokens()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a network failure without leaking internals', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(tokenApi.lookupOwnership('0x' + 'a'.repeat(64))).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('sends release with both confirmations', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt' } } });
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, data: { tagId: 't', lifecycleStatus: 'RELEASED', irreversible: true }, error: null }),
    );

    await tokenApi.release('t');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/nfc\/release$/);
    expect(JSON.parse(String(init.body))).toEqual({ tagId: 't', confirm: true, confirmPhrase: 'RELEASE' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('never sends feePayer on initiate (the API default, BUYER, is the only honest one today)', async () => {
    getSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt' } } });
    fetchMock.mockResolvedValue(
      jsonResponse(201, { success: true, data: { transferId: 'tr', status: 'PENDING', listAmountUsdCents: 250 }, error: null }),
    );

    await tokenApi.initiateTransfer({ tagId: 't', transferType: 'sale', toEmail: 'a@b.co' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ tagId: 't', transferType: 'sale', toEmail: 'a@b.co' });
  });

  // ── S-ADMIN1 Ph3b: prices, vouchers, free transfers ──────────────────────

  const signedIn = () => getSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt' } } });
  const completeBase = { transferId: 'tr', listAmountUsdCents: 300, chargedAmount: 300, chargedCurrency: 'usd', fxRate: 1 };

  it('reads the prices in effect', async () => {
    signedIn();
    fetchMock.mockResolvedValue(jsonResponse(200, {
      success: true, data: { currency: 'usd', transferUsdCents: 300, reissueUsdCents: 1000, tokenUsdCents: 2500 }, error: null,
    }));

    await expect(tokenApi.getPrices()).resolves.toEqual({ currency: 'usd', transferUsdCents: 300, reissueUsdCents: 1000, tokenUsdCents: 2500 });
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/\/nfc\/prices$/);
  });

  it('reads the caller’s free transfers', async () => {
    signedIn();
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { freeTransfers: 2 }, error: null }));

    await expect(tokenApi.getMyVouchers()).resolves.toEqual({ freeTransfers: 2 });
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/\/nfc\/vouchers\/mine$/);
  });

  it('reads a paid accept as paid, including from a backend that does not send voucherApplied', async () => {
    signedIn();
    fetchMock.mockResolvedValue(jsonResponse(200, {
      success: true, data: { ...completeBase, status: 'PENDING', clientSecret: 'pi_1_secret_2' }, error: null,
    }));

    const result = await tokenApi.completeTransfer('tr', 'S'.repeat(43));
    expect(result.voucherApplied).toBe(false);
    expect(result.clientSecret).toBe('pi_1_secret_2');
  });

  it('reads a free transfer as completed with no client secret', async () => {
    signedIn();
    fetchMock.mockResolvedValue(jsonResponse(200, {
      success: true,
      data: { ...completeBase, chargedAmount: 0, voucherApplied: true, status: 'COMPLETED', clientSecret: null },
      error: null,
    }));

    const result = await tokenApi.completeTransfer('tr', 'S'.repeat(43));
    expect(result).toMatchObject({ voucherApplied: true, status: 'COMPLETED', clientSecret: null });
  });

  it('rejects a paid accept with no client secret rather than handing Stripe a null', async () => {
    signedIn();
    fetchMock.mockResolvedValue(jsonResponse(200, {
      success: true, data: { ...completeBase, voucherApplied: false, status: 'PENDING', clientSecret: null }, error: null,
    }));

    await expect(tokenApi.completeTransfer('tr', 'S'.repeat(43))).rejects.toMatchObject({ code: 'bad_response' });
  });
});
