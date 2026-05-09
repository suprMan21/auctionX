/**
 * reconcile-escrow Edge Function
 *
 * Daily watchdog that audits ESCROW_HOLD settlements which the per-5-minute
 * `release-escrow` job failed to drive to RELEASED. Categorizes each stuck
 * settlement, re-drives the recoverable ones, flags anomalies for admin
 * attention, and writes a one-row summary into escrow_reconciliation_logs.
 *
 * Detection rules:
 *  - **Stuck escrow** (recoverable): ESCROW_HOLD where escrow_ends_at is older
 *    than (now - GRACE_MINUTES) AND a SUCCEEDED transaction exists. Treated as
 *    a missed release-escrow run; we update settlement → RELEASED and create
 *    a payout row with the same numbers release-escrow would have.
 *  - **Orphaned escrow** (anomaly): ESCROW_HOLD past the grace period with NO
 *    successful transaction. Inserted as an in-app ADMIN_ALERT for super-admin
 *    review. We never auto-release these — there's no money on hand.
 *  - **Aged dispute** (monitoring): DISPUTED for more than DISPUTED_SLA_DAYS.
 *    Counted but no automated action — surfaced via the admin dashboard.
 *
 * Trigger: pg_cron daily at 02:00 UTC via vault-credentialed http_post.
 * Auth: service role bearer (set by pg_cron).
 *
 * @module reconcile-escrow
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { calculatePayout } from '../_shared/payment/payoutCalculation.ts';
import { logger } from '../_shared/utils/logger.ts';

const STUCK_ESCROW_GRACE_MINUTES = 30;
const DISPUTED_SLA_DAYS = 7;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reconcile-secret',
};

interface ReconciliationStats {
  totalChecked: number;
  stuckReleased: number;
  orphanedFlagged: number;
  disputedAged: number;
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Shared-secret authentication. Edge Functions deploys with --no-verify-jwt
  // because Supabase's new sb_secret_ keys aren't JWTs and legacy service_role
  // JWTs now 401 at the gateway. We enforce auth in-function instead, matching
  // the convention release-escrow and settle-auction already use.
  const reconcileSecret = Deno.env.get('RECONCILE_ESCROW_SECRET');
  if (!reconcileSecret) {
    logger.error('reconcile-escrow: RECONCILE_ESCROW_SECRET not configured');
    return new Response(
      JSON.stringify({ error: 'Server misconfiguration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const providedSecret = req.headers.get('x-reconcile-secret');
  if (providedSecret !== reconcileSecret) {
    logger.warn('reconcile-escrow: invalid or missing x-reconcile-secret');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const runAt = new Date().toISOString();
  const stats: ReconciliationStats = {
    totalChecked: 0,
    stuckReleased: 0,
    orphanedFlagged: 0,
    disputedAged: 0,
    errors: [],
  };

  try {
    // ─── 1. Find stuck escrows (past escrow_ends_at + grace) ────────────────
    const stuckCutoff = new Date(
      Date.now() - STUCK_ESCROW_GRACE_MINUTES * 60 * 1000,
    ).toISOString();

    const { data: stuckSettlements, error: stuckErr } = await supabase
      .from('settlements')
      .select(`
        id,
        seller_id,
        buyer_id,
        gross_amount_cents,
        platform_fee_cents,
        escrow_ends_at,
        transaction_id,
        auction_id,
        transactions (id, status, successful_processor)
      `)
      .eq('status', 'ESCROW_HOLD')
      .lt('escrow_ends_at', stuckCutoff)
      .is('escrow_released_at', null);

    if (stuckErr) {
      throw new Error(`Stuck escrow query failed: ${stuckErr.message}`);
    }

    stats.totalChecked = stuckSettlements?.length ?? 0;

    for (const s of stuckSettlements ?? []) {
      try {
        const txn = s.transactions as
          | { id: string; status: string; successful_processor: string | null }
          | null;
        const txnSucceeded = txn?.status === 'SUCCEEDED';

        if (!txnSucceeded) {
          // ── Orphaned: ESCROW_HOLD without a successful transaction ─────────
          stats.orphanedFlagged++;

          const { data: superAdmins } = await supabase
            .from('admin_users')
            .select('user_id')
            .contains('permissions', ['manage_escrow']);

          const adminIds = (superAdmins ?? []).map((a: { user_id: string }) => a.user_id);

          if (adminIds.length > 0) {
            const rows = adminIds.map((uid) => ({
              user_id: uid,
              type: 'ADMIN_ALERT',
              title: 'Escrow anomaly: orphaned settlement',
              body: `Settlement ${s.id} is ESCROW_HOLD past its window but has no SUCCEEDED transaction. Manual review required.`,
              action_url: `/admin/escrow?status=ESCROW_HOLD`,
              metadata: {
                settlement_id: s.id,
                anomaly: 'orphaned_escrow',
                escrow_ends_at: s.escrow_ends_at,
              },
            }));
            await supabase.from('notifications').insert(rows);
          }

          logger.warn('reconcile-escrow: orphaned escrow flagged', {
            settlementId: s.id,
            escrowEndsAt: s.escrow_ends_at,
            adminAlertCount: adminIds.length,
          });
          continue;
        }

        // ── Stuck with valid transaction — re-drive to RELEASED ────────────
        const processor = txn?.successful_processor ?? 'STRIPE';
        const payout = calculatePayout(
          s.gross_amount_cents,
          s.platform_fee_cents,
          processor,
        );

        // Atomic guard: only update if still ESCROW_HOLD (prevents race with
        // a concurrent release-escrow run).
        const { error: updateErr, data: updated } = await supabase
          .from('settlements')
          .update({
            status: 'RELEASED',
            escrow_released_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', s.id)
          .eq('status', 'ESCROW_HOLD')
          .select('id')
          .maybeSingle();

        if (updateErr) {
          stats.errors.push(`update settlement ${s.id}: ${updateErr.message}`);
          continue;
        }

        if (!updated) {
          // Lost the race — release-escrow got it first. Not an error.
          logger.info('reconcile-escrow: settlement already released by another run', {
            settlementId: s.id,
          });
          continue;
        }

        // Create payout row (mirror release-escrow shape)
        const { error: payoutErr } = await supabase.from('payouts').insert({
          settlement_id: s.id,
          seller_id: s.seller_id,
          gross_amount_cents: payout.grossAmountCents,
          platform_fee_cents: payout.platformFeeCents,
          processor_fee_cents: payout.processorFeeCents,
          net_payout_cents: payout.netPayoutCents,
          payout_method: 'STRIPE_CONNECT',
          status: 'PENDING',
          eligible_at: s.escrow_ends_at,
          currency: 'CAD',
        });

        if (payoutErr) {
          stats.errors.push(`payout insert for ${s.id}: ${payoutErr.message}`);
          // Settlement already RELEASED; payout missing is recoverable manually.
        }

        stats.stuckReleased++;
        logger.info('reconcile-escrow: stuck escrow re-driven to RELEASED', {
          settlementId: s.id,
          netPayoutCents: payout.netPayoutCents,
        });
      } catch (err) {
        stats.errors.push(
          `process ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ─── 2. Aged disputes (monitoring only) ────────────────────────────────
    const disputedCutoff = new Date(
      Date.now() - DISPUTED_SLA_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { count: agedCount, error: disputedErr } = await supabase
      .from('settlements')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'DISPUTED')
      .lt('dispute_opened_at', disputedCutoff);

    if (disputedErr) {
      stats.errors.push(`aged dispute query: ${disputedErr.message}`);
    } else {
      stats.disputedAged = agedCount ?? 0;
    }

    // ─── 3. Persist run summary ────────────────────────────────────────────
    const summary = [
      `Reconciliation run @ ${runAt}`,
      `Stuck escrows checked: ${stats.totalChecked}`,
      `Stuck released:        ${stats.stuckReleased}`,
      `Orphaned flagged:      ${stats.orphanedFlagged}`,
      `Aged disputes:         ${stats.disputedAged}`,
      stats.errors.length === 0 ? 'No errors.' : `Errors: ${stats.errors.length}`,
    ].join('\n');

    const { error: logErr } = await supabase.from('escrow_reconciliation_logs').insert({
      run_at: runAt,
      total_checked: stats.totalChecked,
      stuck_released: stats.stuckReleased,
      orphaned_flagged: stats.orphanedFlagged,
      disputed_aged: stats.disputedAged,
      errors: stats.errors,
      summary,
    });

    if (logErr) {
      logger.error('reconcile-escrow: failed to persist log row', { error: logErr });
    }

    logger.info('reconcile-escrow: run complete', { runAt, ...stats, errorCount: stats.errors.length });

    return new Response(
      JSON.stringify({
        ok: true,
        runAt,
        totalChecked: stats.totalChecked,
        stuckReleased: stats.stuckReleased,
        orphanedFlagged: stats.orphanedFlagged,
        disputedAged: stats.disputedAged,
        errors: stats.errors.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    logger.error('reconcile-escrow: fatal error', {
      error: err instanceof Error ? err.message : String(err),
    });

    // Persist a failed-run log row so the dashboard surface notices the gap.
    try {
      await supabase.from('escrow_reconciliation_logs').insert({
        run_at: runAt,
        total_checked: stats.totalChecked,
        stuck_released: stats.stuckReleased,
        orphaned_flagged: stats.orphanedFlagged,
        disputed_aged: stats.disputedAged,
        errors: [...stats.errors, err instanceof Error ? err.message : String(err)],
        summary: 'Fatal error during reconciliation run',
      });
    } catch (_logErr) {
      // best effort
    }

    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
