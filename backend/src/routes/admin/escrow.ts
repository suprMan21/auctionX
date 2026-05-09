import { Router, Request, Response, RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requirePermission } from '../../middleware/adminAuth';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

const fmtCents = (cents: number | null | undefined) =>
  cents == null ? 0 : cents;

/**
 * GET /api/v1/admin/escrow/summary
 * Returns dashboard summary: counts + dollar totals for ESCROW_HOLD, DISPUTED,
 * 30-day RELEASED, plus the last 10 reconciliation log rows.
 */
router.get(
  '/summary',
  requirePermission('manage_escrow') as unknown as RequestHandler,
  async (_req: Request, res: Response) => {
    try {
      const supabase = getServiceClient();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [escrowHold, disputed, released30d, logs] = await Promise.all([
        supabase
          .from('settlements')
          .select('id, gross_amount_cents, net_amount_cents', { count: 'exact' })
          .eq('status', 'ESCROW_HOLD'),
        supabase
          .from('settlements')
          .select('id, gross_amount_cents', { count: 'exact' })
          .eq('status', 'DISPUTED'),
        supabase
          .from('settlements')
          .select('net_amount_cents')
          .eq('status', 'RELEASED')
          .gte('escrow_released_at', thirtyDaysAgo),
        supabase
          .from('escrow_reconciliation_logs')
          .select('run_at, total_checked, stuck_released, orphaned_flagged, disputed_aged, summary')
          .order('run_at', { ascending: false })
          .limit(10),
      ]);

      const escrowHoldRows = (escrowHold.data ?? []) as Array<{ gross_amount_cents: number | null }>;
      const released30dRows = (released30d.data ?? []) as Array<{ net_amount_cents: number | null }>;

      const escrowTotalCents = escrowHoldRows.reduce(
        (sum, s) => sum + fmtCents(s.gross_amount_cents),
        0,
      );
      const released30dCents = released30dRows.reduce(
        (sum, s) => sum + fmtCents(s.net_amount_cents),
        0,
      );

      res.json({
        success: true,
        data: {
          escrowHold: {
            count: escrowHold.count ?? 0,
            totalCents: escrowTotalCents,
          },
          disputed: { count: disputed.count ?? 0 },
          released30d: { totalCents: released30dCents },
          recentReconciliationLogs: logs.data ?? [],
        },
      });
    } catch (err) {
      console.error('admin_escrow_summary_failed', err);
      res.status(500).json({ success: false, error: 'Failed to load escrow summary' });
    }
  },
);

/**
 * GET /api/v1/admin/escrow/reconciliation-logs?limit=50
 * Returns recent reconciliation log rows.
 */
router.get(
  '/reconciliation-logs',
  requirePermission('manage_escrow') as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200);
      const supabase = getServiceClient();

      const { data, error } = await supabase
        .from('escrow_reconciliation_logs')
        .select('*')
        .order('run_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('admin_escrow_logs_query_failed', error);
        res.status(500).json({ success: false, error: 'Failed to load reconciliation logs' });
        return;
      }

      res.json({ success: true, data });
    } catch (err) {
      console.error('admin_escrow_logs_failed', err);
      res.status(500).json({ success: false, error: 'Failed to load reconciliation logs' });
    }
  },
);

/**
 * GET /api/v1/admin/escrow?status=ESCROW_HOLD&page=1&limit=20
 * Returns paginated settlements with the given status. Status defaults to all.
 */
router.get(
  '/',
  requirePermission('manage_escrow') as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
      const limit = Math.min(100, parseInt((req.query.limit as string) ?? '20', 10) || 20);
      const offset = (page - 1) * limit;

      const supabase = getServiceClient();
      let query = supabase
        .from('settlements')
        .select(
          `
          id, status, gross_amount_cents, net_amount_cents, platform_fee_cents,
          escrow_ends_at, escrow_released_at, dispute_opened_at, dispute_reason,
          created_at, seller_id, buyer_id, transaction_id, auction_id
        `,
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, count, error } = await query;
      if (error) {
        console.error('admin_escrow_list_query_failed', error);
        res.status(500).json({ success: false, error: 'Failed to list settlements' });
        return;
      }

      res.json({
        success: true,
        data: {
          settlements: data ?? [],
          total: count ?? 0,
          page,
          limit,
        },
      });
    } catch (err) {
      console.error('admin_escrow_list_failed', err);
      res.status(500).json({ success: false, error: 'Failed to list settlements' });
    }
  },
);

/**
 * POST /api/v1/admin/escrow/:settlementId/release
 * Manually release a settlement that's stuck in ESCROW_HOLD or DISPUTED.
 * Updates settlement → RELEASED and creates a payout row mirroring the
 * release-escrow edge function.
 */
router.post(
  '/:settlementId/release',
  requirePermission('manage_escrow') as unknown as RequestHandler,
  auditLog('manual_escrow_release', 'settlements') as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { settlementId } = req.params;
      const supabase = getServiceClient();

      const { data: settlement, error: fetchErr } = await supabase
        .from('settlements')
        .select('id, status, gross_amount_cents, net_amount_cents, platform_fee_cents, processor_fee_cents, seller_id, escrow_ends_at')
        .eq('id', settlementId)
        .single();

      if (fetchErr || !settlement) {
        res.status(404).json({ success: false, error: 'Settlement not found' });
        return;
      }

      if (!['ESCROW_HOLD', 'DISPUTED'].includes(settlement.status as string)) {
        res.status(409).json({
          success: false,
          error: `Cannot release settlement in status '${settlement.status}'`,
        });
        return;
      }

      const now = new Date().toISOString();

      // Atomic guard: only flip if still in the expected state
      const { data: updated, error: updateErr } = await supabase
        .from('settlements')
        .update({
          status: 'RELEASED',
          escrow_released_at: now,
          updated_at: now,
        })
        .eq('id', settlementId)
        .in('status', ['ESCROW_HOLD', 'DISPUTED'])
        .select('id')
        .maybeSingle();

      if (updateErr || !updated) {
        res.status(500).json({ success: false, error: 'Failed to update settlement' });
        return;
      }

      // Create payout row mirroring release-escrow shape
      const grossCents = fmtCents(settlement.gross_amount_cents);
      const platformFeeCents = fmtCents(settlement.platform_fee_cents);
      const processorFeeCents = fmtCents(settlement.processor_fee_cents);
      const netPayoutCents = grossCents - platformFeeCents - processorFeeCents;

      const { error: payoutErr } = await supabase.from('payouts').insert({
        settlement_id: settlementId,
        seller_id: settlement.seller_id,
        gross_amount_cents: grossCents,
        platform_fee_cents: platformFeeCents,
        processor_fee_cents: processorFeeCents,
        net_payout_cents: netPayoutCents,
        payout_method: 'STRIPE_CONNECT',
        status: 'PENDING',
        eligible_at: settlement.escrow_ends_at ?? now,
        currency: 'CAD',
      });

      if (payoutErr) {
        // Settlement is RELEASED but payout insert failed — log and surface,
        // but don't roll back the release.
        console.error('admin_escrow_payout_insert_failed', { settlementId, error: payoutErr });
      }

      res.json({
        success: true,
        settlementId,
        status: 'RELEASED',
        payoutCreated: !payoutErr,
      });
    } catch (err) {
      console.error('admin_escrow_manual_release_failed', err);
      res.status(500).json({ success: false, error: 'Failed to release settlement' });
    }
  },
);

export default router;
