# Phase 7C — Escrow Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `reconcile-escrow` daily cron edge function that detects stuck/orphaned escrows and re-drives them to completion; add admin API endpoints for manual escrow management; build the Admin Escrow Dashboard UI.

**Architecture:** A new `reconcile-escrow` Supabase Edge Function runs daily via `pg_cron` — it audits all settlements in ESCROW_HOLD that have exceeded their `escrow_ends_at` window (stuck because `release-escrow` may have failed), re-triggers release for valid stuck escrows, flags orphaned escrows (ESCROW_HOLD with no successful transaction), and inserts a daily summary row into a new `escrow_reconciliation_logs` table. The existing `release-escrow` function handles the actual release logic; `reconcile-escrow` is the audit/watchdog layer. New admin API routes (`/api/v1/admin/escrow`) expose manual release, listing, and financial summary. A new React admin page renders the dashboard.

**Tech Stack:** Supabase Edge Functions (Deno), pg_cron, Express 5 backend, React 19 + Tailwind

---

## Context

- **Project root:** `projectClaude/unmentionables/Unmen/` — run all commands from here
- **Branch:** Create `feature/phase-7c-escrow-reconciliation` off `dev`
- **Settlement status values (text, not enum):** `PENDING_PAYMENT`, `ESCROW_HOLD`, `RELEASED`, `DISPUTED`, `REFUNDED`, `CANCELLED`
- **Existing edge functions:** `settle-auction`, `process-payment`, `payment-webhook`, `check-payment-window`, `release-escrow` — all in `supabase/functions/`
- **Existing admin routes:** mounted at `/api/v1/admin/` — see `backend/src/routes/admin/`
- **Existing settlements schema:** `frontend/src/types/database.types.ts` lines 1672–1777 — `settlements` table has `id`, `status`, `seller_id`, `buyer_id`, `gross_amount_cents`, `net_amount_cents`, `escrow_ends_at`, `escrow_released_at`, `dispute_opened_at`, `transaction_id`
- **Admin auth middleware:** use `adminAuth` middleware (already exists in `backend/src/middleware/`) for all admin routes. Require `manage_escrow` permission (add this enum value in the migration).
- **RLS:** all admin queries must use the service role client (`serviceClient` or `supabaseAdmin`), not the user-scoped client.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/reconcile-escrow/index.ts` | Create | Daily cron watchdog function |
| `supabase/migrations/YYYYMMDDXXXXXX_escrow_reconciliation.sql` | Create | pg_cron schedule + reconciliation_logs table + manage_escrow permission |
| `backend/src/controllers/admin/escrowController.ts` | Create | Admin escrow API handlers |
| `backend/src/routes/admin/escrow.ts` | Create | Admin escrow route definitions |
| `backend/src/routes/admin/index.ts` | Modify | Mount escrow routes |
| `frontend/src/features/admin/pages/EscrowDashboardPage.tsx` | Create | Admin escrow UI |
| `frontend/src/App.tsx` | Modify | Add /admin/escrow route |

---

## Task 1: Branch Setup + Migration

**Files:**
- Create: `supabase/migrations/<timestamp>_escrow_reconciliation.sql`

- [ ] **Step 1: Create feature branch**

```bash
cd /Volumes/myDev_Drive/Dev/dev/projectClaude/unmentionables/Unmen
git checkout dev && git pull origin dev
git checkout -b feature/phase-7c-escrow-reconciliation
```

- [ ] **Step 2: Generate migration filename**

```bash
date +%Y%m%d%H%M%S
```

Use the output as the timestamp prefix (e.g., `20260509120000`).

- [ ] **Step 3: Create migration file**

Create `supabase/migrations/20260509120000_escrow_reconciliation.sql` (use actual timestamp from step 2):

```sql
-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Add manage_escrow to admin_permission enum (idempotency-safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'manage_escrow'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'admin_permission')
  ) THEN
    ALTER TYPE admin_permission ADD VALUE 'manage_escrow';
  END IF;
END$$;

-- Reconciliation logs table
CREATE TABLE IF NOT EXISTS escrow_reconciliation_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at                timestamptz NOT NULL DEFAULT now(),
  total_checked         int NOT NULL DEFAULT 0,
  stuck_released        int NOT NULL DEFAULT 0,  -- ESCROW_HOLD past escrow_ends_at, re-triggered
  orphaned_flagged      int NOT NULL DEFAULT 0,  -- ESCROW_HOLD with no successful transaction
  disputed_aged         int NOT NULL DEFAULT 0,  -- DISPUTED > 7 days with no resolution
  errors                jsonb DEFAULT '[]',
  summary               text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- RLS: only admins can read reconciliation logs
ALTER TABLE escrow_reconciliation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_reconciliation_logs"
  ON escrow_reconciliation_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE user_id = auth.uid()
        AND 'manage_escrow'::text = ANY(permissions::text[])
    )
  );

-- Schedule reconcile-escrow daily at 2 AM UTC
SELECT cron.schedule(
  'reconcile-escrow-daily',
  '0 2 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/reconcile-escrow',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
```

- [ ] **Step 4: Push migration to Supabase**

```bash
SUPABASE_DB_PASSWORD=<password> npx supabase db push --linked
```

If this fails due to missing password, ask Boss for the Supabase DB password (Supabase Dashboard → Settings → Database → Connection info → reveal password).

- [ ] **Step 5: Regenerate types**

```bash
npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
```

- [ ] **Step 6: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
cd ../backend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd ..
git add supabase/migrations/ frontend/src/types/database.types.ts backend/src/types/database.types.ts
git commit -m "feat(7c): add escrow_reconciliation_logs table, manage_escrow permission, pg_cron schedule"
```

---

## Task 2: Build reconcile-escrow Edge Function

**Files:**
- Create: `supabase/functions/reconcile-escrow/index.ts`

- [ ] **Step 1: Read release-escrow/index.ts to understand patterns**

Read `supabase/functions/release-escrow/index.ts` to understand: how serviceClient is constructed, how settlements are queried, how notifications are inserted. Mirror those patterns in the new function.

- [ ] **Step 2: Create the edge function**

Create `supabase/functions/reconcile-escrow/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STUCK_ESCROW_GRACE_MINUTES = 30; // release-escrow runs every 5min; 30min grace before we intervene
const DISPUTED_SLA_DAYS = 7;

serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const serviceClient = createClient(supabaseUrl, serviceKey);

  const runAt = new Date().toISOString();
  const errors: string[] = [];
  let totalChecked = 0;
  let stuckReleased = 0;
  let orphanedFlagged = 0;
  let disputedAged = 0;

  try {
    // --- 1. Find stuck escrows: ESCROW_HOLD but escrow_ends_at has passed + grace period ---
    const stuckCutoff = new Date(Date.now() - STUCK_ESCROW_GRACE_MINUTES * 60 * 1000).toISOString();

    const { data: stuckSettlements, error: stuckErr } = await serviceClient
      .from('settlements')
      .select('id, seller_id, buyer_id, escrow_ends_at, transaction_id')
      .eq('status', 'ESCROW_HOLD')
      .lt('escrow_ends_at', stuckCutoff)
      .is('escrow_released_at', null);

    if (stuckErr) throw new Error(`Stuck query failed: ${stuckErr.message}`);

    totalChecked += stuckSettlements?.length ?? 0;

    for (const s of stuckSettlements ?? []) {
      try {
        // Verify there's a successful transaction (not orphaned)
        const { data: txn } = await serviceClient
          .from('transactions')
          .select('id, status')
          .eq('id', s.transaction_id)
          .eq('status', 'SUCCEEDED')
          .single();

        if (!txn) {
          // Orphaned: ESCROW_HOLD with no successful transaction — flag it
          orphanedFlagged++;
          await serviceClient
            .from('notifications')
            .insert({
              user_id: s.seller_id,
              type: 'ADMIN_ALERT',
              title: 'Escrow anomaly detected',
              body: `Settlement ${s.id} is in ESCROW_HOLD but has no successful transaction. Admin review required.`,
              metadata: { settlement_id: s.id, anomaly: 'orphaned_escrow' },
            });
          continue;
        }

        // Stuck with valid transaction — manually release by updating to RELEASED and creating payout
        const { error: releaseErr } = await serviceClient
          .from('settlements')
          .update({
            status: 'RELEASED',
            escrow_released_at: new Date().toISOString(),
          })
          .eq('id', s.id)
          .eq('status', 'ESCROW_HOLD'); // atomic guard

        if (releaseErr) {
          errors.push(`Release failed for ${s.id}: ${releaseErr.message}`);
          continue;
        }

        // Create payout record
        const { data: settlement } = await serviceClient
          .from('settlements')
          .select('net_amount_cents, seller_id')
          .eq('id', s.id)
          .single();

        if (settlement) {
          await serviceClient.from('payouts').insert({
            settlement_id: s.id,
            seller_id: settlement.seller_id,
            amount_cents: settlement.net_amount_cents,
            status: 'PENDING',
          });
        }

        stuckReleased++;
      } catch (err) {
        errors.push(`Processing ${s.id}: ${String(err)}`);
      }
    }

    // --- 2. Find aged disputes: DISPUTED > SLA_DAYS ---
    const disputedCutoff = new Date(Date.now() - DISPUTED_SLA_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: agedDisputes } = await serviceClient
      .from('settlements')
      .select('id, dispute_opened_at')
      .eq('status', 'DISPUTED')
      .lt('dispute_opened_at', disputedCutoff);

    disputedAged = agedDisputes?.length ?? 0;

    // --- 3. Write reconciliation log ---
    const summary = [
      `Reconciliation run: ${runAt}`,
      `Checked: ${totalChecked} stuck escrows`,
      `Released: ${stuckReleased}`,
      `Orphaned: ${orphanedFlagged}`,
      `Aged disputes: ${disputedAged}`,
      errors.length > 0 ? `Errors: ${errors.join('; ')}` : 'No errors',
    ].join('\n');

    await serviceClient.from('escrow_reconciliation_logs').insert({
      run_at: runAt,
      total_checked: totalChecked,
      stuck_released: stuckReleased,
      orphaned_flagged: orphanedFlagged,
      disputed_aged: disputedAged,
      errors: errors,
      summary,
    });

    console.log(summary);

    return new Response(
      JSON.stringify({ ok: true, stuckReleased, orphanedFlagged, disputedAged }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[reconcile-escrow] Fatal error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 3: Verify with local serve**

```bash
supabase functions serve reconcile-escrow --env-file supabase/.env.local --no-verify-jwt
```

In another terminal:
```bash
curl -X POST http://localhost:54321/functions/v1/reconcile-escrow \
  -H "Content-Type: application/json" -d '{}'
```

Expected: `{"ok":true,"stuckReleased":0,"orphanedFlagged":0,"disputedAged":0}` (no live stuck escrows in staging).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/reconcile-escrow/
git commit -m "feat(7c): add reconcile-escrow cron edge function"
```

---

## Task 3: Admin Escrow Controller (Backend API)

**Files:**
- Create: `backend/src/controllers/admin/escrowController.ts`

- [ ] **Step 1: Read an existing admin controller for patterns**

Read `backend/src/controllers/admin/disputesController.ts` (or similar) to understand: how serviceClient is obtained, how AppError is used, response shape `{ success, data, error }`.

- [ ] **Step 2: Create escrowController.ts**

```typescript
import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AppError } from '../../lib/errors.js';
import type { Database } from '../../types/database.js';

const serviceClient = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/v1/admin/escrow?status=ESCROW_HOLD&page=1&limit=20
export const listSettlements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, page = '1', limit = '20' } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, parseInt(limit));
    const offset = (pageNum - 1) * limitNum;

    let query = serviceClient
      .from('settlements')
      .select(`
        id, status, gross_amount_cents, net_amount_cents, platform_fee_cents,
        escrow_ends_at, escrow_released_at, dispute_opened_at, created_at,
        seller_id, buyer_id, transaction_id
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, count, error } = await query;
    if (error) throw new AppError(error.message, 500);

    res.json({ success: true, data: { settlements: data, total: count, page: pageNum, limit: limitNum } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/admin/escrow/:id/release
export const manualRelease = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const { data: settlement, error: fetchErr } = await serviceClient
      .from('settlements')
      .select('id, status, net_amount_cents, seller_id')
      .eq('id', id)
      .single();

    if (fetchErr || !settlement) throw new AppError('Settlement not found', 404);
    if (!['ESCROW_HOLD', 'DISPUTED'].includes(settlement.status)) {
      throw new AppError(`Cannot release settlement in status: ${settlement.status}`, 400);
    }

    const { error: updateErr } = await serviceClient
      .from('settlements')
      .update({ status: 'RELEASED', escrow_released_at: new Date().toISOString() })
      .eq('id', id);

    if (updateErr) throw new AppError(updateErr.message, 500);

    await serviceClient.from('payouts').insert({
      settlement_id: id,
      seller_id: settlement.seller_id,
      amount_cents: settlement.net_amount_cents,
      status: 'PENDING',
    });

    res.json({ success: true, data: { id, status: 'RELEASED' } });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/admin/escrow/summary
export const financialSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [escrowHold, disputed, released30d, logs] = await Promise.all([
      serviceClient
        .from('settlements')
        .select('id, gross_amount_cents, net_amount_cents', { count: 'exact' })
        .eq('status', 'ESCROW_HOLD'),
      serviceClient
        .from('settlements')
        .select('id, gross_amount_cents', { count: 'exact' })
        .eq('status', 'DISPUTED'),
      serviceClient
        .from('settlements')
        .select('net_amount_cents')
        .eq('status', 'RELEASED')
        .gte('escrow_released_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      serviceClient
        .from('escrow_reconciliation_logs')
        .select('run_at, stuck_released, orphaned_flagged, disputed_aged')
        .order('run_at', { ascending: false })
        .limit(10),
    ]);

    const totalEscrowCents = (escrowHold.data ?? []).reduce((sum, s) => sum + (s.gross_amount_cents ?? 0), 0);
    const released30dCents = (released30d.data ?? []).reduce((sum, s) => sum + (s.net_amount_cents ?? 0), 0);

    res.json({
      success: true,
      data: {
        escrowHold: { count: escrowHold.count ?? 0, totalCents: totalEscrowCents },
        disputed: { count: disputed.count ?? 0 },
        released30d: { totalCents: released30dCents },
        recentReconciliationLogs: logs.data ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/admin/escrow/reconciliation-logs
export const reconciliationLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await serviceClient
      .from('escrow_reconciliation_logs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(50);

    if (error) throw new AppError(error.message, 500);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 3: TypeScript check**

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/escrowController.ts
git commit -m "feat(7c): add admin escrow controller (list, release, summary, logs)"
```

---

## Task 4: Admin Escrow Routes (Backend)

**Files:**
- Create: `backend/src/routes/admin/escrow.ts`
- Modify: `backend/src/routes/admin/index.ts`

- [ ] **Step 1: Read backend/src/routes/admin/index.ts**

Find how other admin route files are mounted (e.g., `router.use('/disputes', disputeRoutes)`).

- [ ] **Step 2: Create escrow.ts**

```typescript
import { Router } from 'express';
import { adminAuth } from '../../middleware/adminAuth.js';
import {
  listSettlements,
  manualRelease,
  financialSummary,
  reconciliationLogs,
} from '../../controllers/admin/escrowController.js';

const router = Router();

router.get('/summary', adminAuth('manage_escrow'), financialSummary);
router.get('/reconciliation-logs', adminAuth('manage_escrow'), reconciliationLogs);
router.get('/', adminAuth('manage_escrow'), listSettlements);
router.post('/:id/release', adminAuth('manage_escrow'), manualRelease);

export default router;
```

Note: static routes (`/summary`, `/reconciliation-logs`) must come before parameterized routes (`/:id/release`). This is correct in the order above.

- [ ] **Step 3: Mount in admin/index.ts**

Add to `backend/src/routes/admin/index.ts`:

```typescript
import escrowRoutes from './escrow.js';
// ... existing imports ...

router.use('/escrow', escrowRoutes);
```

- [ ] **Step 4: TypeScript check**

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin/escrow.ts backend/src/routes/admin/index.ts
git commit -m "feat(7c): mount admin escrow routes at /api/v1/admin/escrow"
```

---

## Task 5: Test Admin Escrow API

- [ ] **Step 1: Start backend**

```bash
cd backend && npm run dev
```

- [ ] **Step 2: Get admin JWT**

Log in as `chris.lafleche@cravingcorp.com` (super_admin) via the staging frontend and copy the JWT from localStorage or DevTools Network tab.

- [ ] **Step 3: Test summary endpoint**

```bash
curl -s http://localhost:3001/api/v1/admin/escrow/summary \
  -H "Authorization: Bearer <JWT>" | jq .
```

Expected: `{"success":true,"data":{"escrowHold":{"count":N,...},...}}`

- [ ] **Step 4: Test list endpoint**

```bash
curl -s "http://localhost:3001/api/v1/admin/escrow?status=ESCROW_HOLD&limit=5" \
  -H "Authorization: Bearer <JWT>" | jq .
```

Expected: paginated settlements list.

- [ ] **Step 5: Test reconciliation logs endpoint**

```bash
curl -s http://localhost:3001/api/v1/admin/escrow/reconciliation-logs \
  -H "Authorization: Bearer <JWT>" | jq .
```

Expected: empty array (no runs yet).

- [ ] **Step 6: Commit verification**

```bash
git commit --allow-empty -m "test(7c): admin escrow API endpoints verified manually"
```

---

## Task 6: Admin Escrow Dashboard (Frontend)

**Files:**
- Create: `frontend/src/features/admin/pages/EscrowDashboardPage.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Read an existing admin page for layout patterns**

Read `frontend/src/features/admin/pages/` — pick one page (e.g., ModerationsPage or UsersPage) to understand: how the page is laid out, what card/table components are used, auth guard setup.

- [ ] **Step 2: Create EscrowDashboardPage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { apiClient } from '../../../lib/api';

interface Settlement {
  id: string;
  status: string;
  gross_amount_cents: number;
  net_amount_cents: number;
  escrow_ends_at: string | null;
  dispute_opened_at: string | null;
  created_at: string;
}

interface EscrowSummary {
  escrowHold: { count: number; totalCents: number };
  disputed: { count: number };
  released30d: { totalCents: number };
  recentReconciliationLogs: Array<{
    run_at: string;
    stuck_released: number;
    orphaned_flagged: number;
    disputed_aged: number;
  }>;
}

export const EscrowDashboardPage = () => {
  const [summary, setSummary] = useState<EscrowSummary | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [statusFilter, setStatusFilter] = useState('ESCROW_HOLD');
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, listRes] = await Promise.all([
        apiClient.get('/admin/escrow/summary'),
        apiClient.get(`/admin/escrow?status=${statusFilter}&limit=50`),
      ]);
      setSummary(summaryRes.data.data);
      setSettlements(listRes.data.data.settlements ?? []);
    } catch (err) {
      setError('Failed to load escrow data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [statusFilter]);

  const handleRelease = async (id: string) => {
    if (!confirm(`Manually release escrow ${id}? This will create a payout for the seller.`)) return;
    setReleasing(id);
    try {
      await apiClient.post(`/admin/escrow/${id}/release`);
      await fetchData();
    } catch (err) {
      setError('Release failed');
    } finally {
      setReleasing(null);
    }
  };

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  if (loading) return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center">
      <div className="text-gray-400">Loading escrow data...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-dark-800 p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Escrow Reconciliation</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="glass rounded-2xl p-4">
            <div className="text-gray-400 text-sm mb-1">In Escrow</div>
            <div className="text-2xl font-bold text-white">{summary.escrowHold.count}</div>
            <div className="text-purple-400 text-sm">{fmt(summary.escrowHold.totalCents)} held</div>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="text-gray-400 text-sm mb-1">Disputed</div>
            <div className="text-2xl font-bold text-yellow-400">{summary.disputed.count}</div>
            <div className="text-gray-400 text-sm">pending resolution</div>
          </div>
          <div className="glass rounded-2xl p-4">
            <div className="text-gray-400 text-sm mb-1">Released (30d)</div>
            <div className="text-2xl font-bold text-green-400">{fmt(summary.released30d.totalCents)}</div>
            <div className="text-gray-400 text-sm">settled to sellers</div>
          </div>
        </div>
      )}

      {/* Recent Reconciliation Runs */}
      {summary && summary.recentReconciliationLogs.length > 0 && (
        <div className="glass rounded-2xl p-4 mb-6">
          <h2 className="text-white font-semibold mb-3">Recent Reconciliation Runs</h2>
          <div className="space-y-2">
            {summary.recentReconciliationLogs.map((log) => (
              <div key={log.run_at} className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{new Date(log.run_at).toLocaleString()}</span>
                <div className="flex gap-4">
                  <span className="text-blue-400">Released: {log.stuck_released}</span>
                  <span className="text-yellow-400">Orphaned: {log.orphaned_flagged}</span>
                  <span className="text-orange-400">Aged disputes: {log.disputed_aged}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settlement List */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Settlements</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-dark-700 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white"
          >
            <option value="ESCROW_HOLD">Escrow Hold</option>
            <option value="DISPUTED">Disputed</option>
            <option value="RELEASED">Released</option>
            <option value="REFUNDED">Refunded</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        {settlements.length === 0 ? (
          <div className="text-gray-400 text-sm py-4">No settlements found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-white/10">
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Gross</th>
                  <th className="pb-2 pr-4">Net</th>
                  <th className="pb-2 pr-4">Escrow Ends</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-4 text-gray-300 font-mono text-xs">{s.id.slice(0, 8)}…</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.status === 'ESCROW_HOLD' ? 'bg-blue-500/20 text-blue-300' :
                        s.status === 'DISPUTED' ? 'bg-yellow-500/20 text-yellow-300' :
                        s.status === 'RELEASED' ? 'bg-green-500/20 text-green-300' :
                        'bg-gray-500/20 text-gray-300'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-white">{fmt(s.gross_amount_cents)}</td>
                    <td className="py-2 pr-4 text-green-400">{fmt(s.net_amount_cents)}</td>
                    <td className="py-2 pr-4 text-gray-400">
                      {s.escrow_ends_at ? new Date(s.escrow_ends_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2">
                      {['ESCROW_HOLD', 'DISPUTED'].includes(s.status) && (
                        <button
                          onClick={() => handleRelease(s.id)}
                          disabled={releasing === s.id}
                          className="px-3 py-1 rounded-xl text-xs font-medium bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 transition-colors disabled:opacity-50"
                        >
                          {releasing === s.id ? 'Releasing…' : 'Manual Release'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Add apiClient methods**

Read `frontend/src/lib/api.ts`. If it doesn't already have admin escrow methods, they're not needed here since we call `apiClient.get/post` directly.

- [ ] **Step 4: Add route to App.tsx**

Read `frontend/src/App.tsx`. Find where admin routes are declared (should be inside a `<ProtectedRoute>` or similar admin guard). Add:

```tsx
import { EscrowDashboardPage } from './features/admin/pages/EscrowDashboardPage';

// Inside admin routes:
<Route path="/admin/escrow" element={<EscrowDashboardPage />} />
```

- [ ] **Step 5: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/pages/EscrowDashboardPage.tsx frontend/src/App.tsx
git commit -m "feat(7c): add EscrowDashboardPage with summary, settlement list, manual release"
```

---

## Task 7: Deploy Edge Function

**Files:**
- Deploy: `supabase/functions/reconcile-escrow/`

- [ ] **Step 1: Deploy reconcile-escrow**

```bash
supabase functions deploy reconcile-escrow
```

- [ ] **Step 2: Set secrets (if not already set from 7E)**

```bash
supabase secrets set POSTMARK_SERVER_TOKEN=<token>
supabase secrets set POSTMARK_FROM_EMAIL=noreply@authentic-materials.com
```

- [ ] **Step 3: Test the deployed function**

```bash
curl -X POST https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/reconcile-escrow \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" -d '{}'
```

Expected: `{"ok":true,"stuckReleased":0,"orphaned_flagged":0,"disputedAged":0}`

- [ ] **Step 4: Commit deployment note**

```bash
git commit --allow-empty -m "deploy(7c): reconcile-escrow deployed to Supabase"
```

---

## Task 8: End-to-End Verification + Session Close-Out

- [ ] **Step 1: TypeScript check (both)**

```bash
cd frontend && npx tsc --noEmit
cd ../backend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Backend tests**

```bash
cd backend && npx vitest run
```

Expected: all pass.

- [ ] **Step 3: Manual verification**

1. Hit `GET /api/v1/admin/escrow/summary` — verify response shape
2. Hit `GET /api/v1/admin/escrow?status=ESCROW_HOLD` — verify paginated list
3. Visit `<staging-url>/admin/escrow` — verify dashboard renders
4. Hit reconcile-escrow deployed function — verify log row created in `escrow_reconciliation_logs`

- [ ] **Step 4: Create verification doc**

Create `docs/PHASE_7C_VERIFICATION.md` with:
- Reconcile-escrow deployed: yes/no
- pg_cron schedule: 2 AM UTC daily
- Admin routes: list all endpoints
- Admin UI: route added
- TypeScript: 0 errors
- Tests: pass/fail

- [ ] **Step 5: Merge to dev**

```bash
cd /Volumes/myDev_Drive/Dev/dev/projectClaude/unmentionables/Unmen
git checkout dev && git pull origin dev
git merge feature/phase-7c-escrow-reconciliation
git push origin dev
```

- [ ] **Step 6: Add Lessons Learned to Notion**

Add any gotchas to `collection://dae3b391-3163-4fd0-9eee-586d923415d1`.

---

## Verification

End-to-end tests:
1. `GET /api/v1/admin/escrow/summary` returns escrowHold count + totalCents
2. `GET /api/v1/admin/escrow?status=DISPUTED` returns disputed settlements
3. `/admin/escrow` page renders in browser without errors
4. `POST /api/v1/admin/escrow/<id>/release` on an ESCROW_HOLD settlement → status becomes RELEASED, payout row created
5. Reconcile-escrow deployed function responds `{"ok":true,...}`
6. Reconciliation log row inserted in `escrow_reconciliation_logs` table
7. `npx tsc --noEmit` — 0 errors in both frontend and backend

---

## What's NOT in This Phase (Deferred)

- **Actual Stripe Connect Transfer API call** — `release-escrow` has a TODO for the real Stripe payout. This belongs in Phase 7D (Automated Payouts) once Stripe Connect credentials are configured.
- **Delivery-triggered escrow release** — depends on Phase 7B (Shipping) for delivery confirmation.
- **Partial refunds / crypto settlements** — deferred until payment processors are live with real API keys.
