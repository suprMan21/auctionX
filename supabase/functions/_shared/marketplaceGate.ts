/**
 * S-ISO1 — parked marketplace gate for Edge Functions.
 *
 * The auction marketplace and the Unmentionables stream are PARKED per the
 * 2026-09-18 token-first pivot (Decisions DB, Locked). Marketplace functions
 * stay DEPLOYED but must not run: they answer 410 Gone unless the secret
 * MARKETPLACE_ENABLED is the literal string 'true'.
 *
 * Nothing is deleted. Reversal: `supabase secrets set MARKETPLACE_ENABLED=true`
 * (see docs/PARKED_MARKETPLACE.md).
 *
 * Functions that are NOT gated: waitlist-welcome (live) and upload-url (a
 * generic S3 presigner the token origin-video flow needs).
 */

export const isMarketplaceEnabled = (): boolean => {
  const raw = Deno.env.get('MARKETPLACE_ENABLED');
  return raw === 'true' || raw === '1';
};

/**
 * Returns a 410 Response when the marketplace is parked, or null to continue.
 * Call this as the FIRST thing in the handler, after the CORS preflight branch.
 */
export const marketplaceGate = (corsHeaders: Record<string, string>): Response | null => {
  if (isMarketplaceEnabled()) return null;
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: 'MARKETPLACE_PARKED',
        message:
          'The auction marketplace is parked. This endpoint is intentionally disabled.',
      },
    }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
};
