# Session: HIGH Priority TODO Fixes

**READ THIS ENTIRE DOCUMENT BEFORE EXECUTING ANYTHING.**  
Run each step in order. Do not skip. Do not assume a fix is already done — verify first.

**Project root:** `unmentionables/Unmen/`  
**Docs folder:** `unmentionables/Unmen/docs/`  
**Session goal:** Fix all HIGH priority TODO items that require no external API keys or deployments.

---

## PHASE 0: Pre-Check

Confirm clean baseline before touching anything. If TypeScript fails — STOP and report errors before proceeding.

```bash
cd unmentionables/Unmen

echo "=== Git context ===" && git log --oneline -5

echo ""
echo "=== Frontend TypeScript ===" && cd frontend && npx tsc --noEmit && echo "✅ Frontend clean" || echo "❌ STOP — fix TS errors before continuing"

echo ""
echo "=== Backend TypeScript ===" && cd ../backend && npx tsc --noEmit && echo "✅ Backend clean" || echo "❌ STOP — fix TS errors before continuing"
```

```bash
# Quick discovery — understand what we're working with
cd unmentionables/Unmen

echo "=== Dispute-related files ===" && grep -rn "501\|Not Implemented\|dispute" backend/src/ --include="*.ts" -l

echo ""
echo "=== Search route file ===" && ls backend/src/routes/search.ts 2>/dev/null && echo "exists" || echo "NOT FOUND"

echo ""
echo "=== Verify routes ===" && grep -rn "verify" backend/src/routes/ --include="*.ts" -l 2>/dev/null

echo ""
echo "=== Edge function list ===" && ls supabase/functions/
```

---

## PHASE 1: Fix 1 — Stripe transactionId in PaymentIntent Metadata

**Why it matters:** The `payment-webhook` handler reads `paymentIntent.metadata.transactionId` to correlate Stripe events to internal records. Without this, every Stripe webhook lands with no transaction context and status updates silently fail.

### Step 1a — Inspect current state

```bash
cd unmentionables/Unmen

echo "=== Current PaymentIntent create call ===" && grep -n "paymentIntents.create\|metadata\|transactionId" supabase/functions/_shared/payment/processors/StripeProcessor.ts

echo ""
echo "=== What the webhook expects ===" && grep -n "metadata.transactionId\|transactionId" supabase/functions/payment-webhook/index.ts
```

### Step 1b — Apply the fix

Read the file first to find the exact `paymentIntents.create` block, then apply a targeted edit. The structure to find and update:

```bash
cd unmentionables/Unmen

# Show the full processPayment method to understand the shape
grep -n -A 30 "paymentIntents.create" supabase/functions/_shared/payment/processors/StripeProcessor.ts
```

Using the output above, open `supabase/functions/_shared/payment/processors/StripeProcessor.ts` and update the `paymentIntents.create()` call to include metadata. The metadata block should be:

```typescript
metadata: {
  transactionId: transactionId,
  auctionId: metadata?.auctionId || '',
  listingId: metadata?.listingId || '',
},
```

If `transactionId` is not already a parameter in scope, trace where it comes from in `processPayment(request: PaymentRequest)` — it will be in `request.transactionId` or similar based on the `PaymentRequest` interface in `supabase/functions/_shared/payment/types.ts`.

```bash
# Confirm the PaymentRequest interface shape
grep -n "transactionId\|interface PaymentRequest" supabase/functions/_shared/payment/types.ts
```

### Step 1c — Verify

```bash
cd unmentionables/Unmen

echo "=== transactionId now in StripeProcessor ===" && grep -n "transactionId" supabase/functions/_shared/payment/processors/StripeProcessor.ts

echo ""
echo "=== Webhook still reads it correctly ===" && grep -n "metadata.transactionId" supabase/functions/payment-webhook/index.ts
```

Expected: StripeProcessor now sets it, webhook reads it. If both lines appear — ✅ Fix 1 done.

---

## PHASE 2: Fix 2 — Rate Limit on GET /search

**Why it matters:** Public endpoint, no auth, no rate limit = free DDoS surface and database hammering. Security audit flagged this.

### Step 2a — Inspect current state

```bash
cd unmentionables/Unmen

echo "=== Current search route ===" && cat backend/src/routes/search.ts

echo ""
echo "=== express-rate-limit installed? ===" && grep "express-rate-limit" backend/package.json
```

### Step 2b — Apply the fix

Open `backend/src/routes/search.ts`. At the top of the file, after existing imports, add:

```typescript
import rateLimit from 'express-rate-limit';
```

Then, before the first `router.get(` or `router.use(` call, add:

```typescript
const searchRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many search requests. Please try again shortly.' },
});

router.use(searchRateLimit);
```

**Note:** `express-rate-limit` is already a dependency (used in bid rate limiting). Do NOT add it to package.json.

### Step 2c — Verify

```bash
cd unmentionables/Unmen

echo "=== Rate limit applied to search ===" && grep -n "rateLimit\|rate-limit\|searchRateLimit" backend/src/routes/search.ts

echo ""
echo "=== Backend still compiles ===" && cd backend && npx tsc --noEmit && echo "✅" || echo "❌"
```

---

## PHASE 3: Fix 3 — FRONTEND_URL in Edge Functions

**Why it matters:** Notification `action_url` values point to `localhost:5173` in production because the env var isn't being read. Users click notification links and hit nothing.

### Step 3a — Audit all four functions

```bash
cd unmentionables/Unmen

echo "=== FRONTEND_URL / localhost audit ===" && grep -rn "FRONTEND_URL\|localhost:5173\|action_url" \
  supabase/functions/settle-auction/ \
  supabase/functions/check-payment-window/ \
  supabase/functions/release-escrow/ \
  supabase/functions/payment-webhook/
```

### Step 3b — Fix each file that has localhost hardcoded or missing FRONTEND_URL

For each file that has hardcoded `localhost:5173` or constructs `action_url` without using `FRONTEND_URL`:

**Pattern to find and replace:**

```typescript
// BEFORE (bad)
action_url: `http://localhost:5173/settlements/${settlementId}`

// AFTER (good)
const FRONTEND_URL = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173';
// ...then use it:
action_url: `${FRONTEND_URL}/settlements/${settlementId}`
```

Rules:
- `const FRONTEND_URL = ...` goes near the top of each function handler, before the first `supabaseClient` call
- If `FRONTEND_URL` is already declared in the file, don't add a duplicate — just ensure all `action_url` uses use it
- Use the actual path suffix that matches the context (e.g., `/auctions/`, `/settlements/`, `/payouts/`)

Apply to each affected file found in Step 3a.

### Step 3c — Verify

```bash
cd unmentionables/Unmen

echo "=== No more raw localhost in action_urls ===" && grep -rn "localhost:5173" \
  supabase/functions/settle-auction/ \
  supabase/functions/check-payment-window/ \
  supabase/functions/release-escrow/ \
  supabase/functions/payment-webhook/
# Expected: zero results

echo ""
echo "=== FRONTEND_URL env reads confirmed ===" && grep -rn "FRONTEND_URL" \
  supabase/functions/settle-auction/ \
  supabase/functions/check-payment-window/ \
  supabase/functions/release-escrow/ \
  supabase/functions/payment-webhook/
```

---

## PHASE 4: Fix 4 — Content Flag Enum Expansion

**Why it matters:** The payment cascade logic references `SWIMWEAR`, `LINGERIE`, `PERSONAL_ITEM`, and `FETISH` content flags that don't exist in the DB enum. This causes silent routing failures for those item types.

### Step 4a — Get current timestamp for migration filename

```bash
date +"%Y%m%d%H%M%S"
```

### Step 4b — Create the migration file

Replace `YYYYMMDDHHMMSS` with the actual timestamp from Step 4a:

```bash
cat > unmentionables/Unmen/supabase/migrations/YYYYMMDDHHMMSS_content_flag_enum_expansion.sql << 'EOF'
-- Migration: Content Flag Enum Expansion
-- Adds missing content_flag values referenced in payment cascade logic.
-- Idempotent — safe to re-run.
-- NOTE: Do NOT add the new enum values and reference them in the same transaction.
-- (See LESSONS_LEARNED.md — Module 13 pattern: use TEXT for same-tx references.)

DO $$ BEGIN ALTER TYPE content_flag ADD VALUE IF NOT EXISTS 'SWIMWEAR'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE content_flag ADD VALUE IF NOT EXISTS 'LINGERIE'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE content_flag ADD VALUE IF NOT EXISTS 'PERSONAL_ITEM'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE content_flag ADD VALUE IF NOT EXISTS 'FETISH'; EXCEPTION WHEN others THEN NULL; END $$;

-- Add default_content_flag to categories
-- Using TEXT (not enum) to avoid same-transaction enum reference issue
ALTER TABLE categories ADD COLUMN IF NOT EXISTS default_content_flag TEXT;

COMMENT ON COLUMN categories.default_content_flag IS 'Default content flag for items in this category. TEXT type avoids same-transaction enum reference constraint.';
EOF
```

**Important:** Rename the file to use the real timestamp from Step 4a before saving.

### Step 4c — Verify

```bash
ls unmentionables/Unmen/supabase/migrations/*content_flag* && echo "✅ Migration file created"
cat unmentionables/Unmen/supabase/migrations/*content_flag*
```

**DO NOT run `supabase db push` or `supabase migration up`.** Migration will be applied in a future batch push session.

---

## PHASE 5: Fix 5 — Admin Dispute Resolution Endpoints

**Why it matters:** Disputed settlements are permanently stuck. `approve` and `reject` are 501 stubs. No way for admins to resolve disputes until this is implemented.

### Step 5a — Locate the stubs

```bash
cd unmentionables/Unmen

echo "=== Finding 501 stubs ===" && grep -rn "501\|Not Implemented" backend/src/controllers/ backend/src/routes/ --include="*.ts"

echo ""
echo "=== Dispute-related files ===" && grep -rln "dispute\|DISPUTED" backend/src/ --include="*.ts"

echo ""
echo "=== Settlement/payout controller ===" && ls backend/src/controllers/
```

### Step 5b — Understand the data model first

```bash
cd unmentionables/Unmen

# Check what columns exist on settlements and audit_logs
grep -n "settlements\|DISPUTED\|REFUNDED\|ESCROW_HOLD\|escrow_ends_at" backend/src/types/database.types.ts | head -60
```

### Step 5c — Implement dispute resolution

Find the file with the 501 stubs (identified in Step 5a). Implement both handlers using this logic:

**`approveDispute` — approve means buyer wins, issue refund:**

```typescript
export const approveDispute = async (req: Request, res: Response) => {
  const { id } = req.params; // dispute/settlement ID
  const adminId = req.user?.id;

  try {
    // 1. Fetch settlement, verify it exists and is DISPUTED
    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !settlement) {
      return res.status(404).json({ success: false, error: 'Settlement not found' });
    }

    if (settlement.status !== 'DISPUTED') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot approve dispute: settlement status is ${settlement.status}` 
      });
    }

    // 2. Update settlement status to REFUNDED
    const { error: updateError } = await supabase
      .from('settlements')
      .update({ 
        status: 'REFUNDED',
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // 3. Audit log
    await supabase.from('audit_logs').insert({
      action: 'DISPUTE_APPROVED',
      entity_type: 'settlement',
      entity_id: id,
      actor_id: adminId,
      details: { previous_status: 'DISPUTED', new_status: 'REFUNDED' },
      created_at: new Date().toISOString()
    });

    // TODO: Trigger actual Stripe refund via payment processor once API keys are live
    // The payment processor refund call goes here when keys are available

    return res.json({ success: true, message: 'Dispute approved — settlement marked for refund' });

  } catch (err) {
    console.error('approveDispute error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
```

**`rejectDispute` — reject means seller wins, resume escrow:**

```typescript
export const rejectDispute = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.user?.id;

  try {
    // 1. Fetch settlement, verify DISPUTED
    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !settlement) {
      return res.status(404).json({ success: false, error: 'Settlement not found' });
    }

    if (settlement.status !== 'DISPUTED') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot reject dispute: settlement status is ${settlement.status}` 
      });
    }

    // 2. Resume escrow — set new escrow_ends_at from now + standard hold period (72h)
    const escrowEndsAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from('settlements')
      .update({ 
        status: 'ESCROW_HOLD',
        escrow_ends_at: escrowEndsAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // 3. Audit log
    await supabase.from('audit_logs').insert({
      action: 'DISPUTE_REJECTED',
      entity_type: 'settlement',
      entity_id: id,
      actor_id: adminId,
      details: { 
        previous_status: 'DISPUTED', 
        new_status: 'ESCROW_HOLD',
        new_escrow_ends_at: escrowEndsAt
      },
      created_at: new Date().toISOString()
    });

    return res.json({ 
      success: true, 
      message: 'Dispute rejected — escrow hold resumed',
      escrow_ends_at: escrowEndsAt
    });

  } catch (err) {
    console.error('rejectDispute error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
```

**If the route registration is also a stub, wire it up:**

```typescript
// In the admin disputes router
router.post('/disputes/:id/approve', requireAuth, requireAdmin, approveDispute);
router.post('/disputes/:id/reject', requireAuth, requireAdmin, rejectDispute);
```

**Adapt column names to match what `database.types.ts` actually shows.** If `escrow_ends_at` is named differently, use the real name. If `audit_logs` has a different schema, match it.

### Step 5d — Verify

```bash
cd unmentionables/Unmen

echo "=== No more 501s for disputes ===" && grep -rn "501\|Not Implemented" backend/src/controllers/ backend/src/routes/ --include="*.ts" | grep -iv "nowpayments\|crypto"
# Expected: zero results (only NOWPayments 501s are acceptable and intentional)

echo ""
echo "=== Backend TypeScript check ===" && cd backend && npx tsc --noEmit && echo "✅" || echo "❌ Fix TS errors before continuing"
```

---

## PHASE 6: Fix 6 — Rate Limits on Public Verify Endpoints

**Why it matters:** NFC scan endpoints with no rate limiting = counter inflation attacks and load abuse. Public verification pages also need protection.

### Step 6a — Audit public routes

```bash
cd unmentionables/Unmen

echo "=== Public GET/POST routes (no requireAuth) ===" && grep -rn "router\.\(get\|post\)" backend/src/routes/ --include="*.ts" | grep -v "requireAuth\|admin" | grep -v "^Binary"
```

### Step 6b — Locate verify routes

```bash
cd unmentionables/Unmen

echo "=== Verify route file ===" && grep -rln "verify\|tokenName\|nfc\|scan" backend/src/routes/ --include="*.ts"
cat $(grep -rln "verify\|tokenName" backend/src/routes/ --include="*.ts" | head -1) 2>/dev/null || echo "Not found — check path"
```

### Step 6c — Add rate limits to verify routes

Find the verify routes file. Add these rate limiters:

```typescript
import rateLimit from 'express-rate-limit';

// Public verification page views — generous limit
const verifyPageLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many verification requests.' },
});

// NFC scan endpoint — strict limit to prevent counter inflation
const nfcScanLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many scan requests.' },
});
```

Apply `verifyPageLimit` to `GET /verify/:tokenName` and `nfcScanLimit` to `POST /verify/:tokenName/scan`.

**If the verify routes don't exist yet (Module 13 NFC not implemented):** Skip this step, add a TODO comment and note it in the session wrap-up. Do not create stub routes.

### Step 6d — Verify

```bash
cd unmentionables/Unmen

echo "=== Rate limits on verify routes ===" && grep -n "rateLimit\|verifyPageLimit\|nfcScanLimit" backend/src/routes/$(grep -rln "verify\|tokenName" backend/src/routes/ --include="*.ts" | head -1 | xargs basename) 2>/dev/null || echo "Verify routes not yet implemented — skip"
```

---

## PHASE 7: Post-Fix Verification

Run all checks. Every item must pass before committing.

```bash
cd unmentionables/Unmen

echo "========================================"
echo "POST-FIX VERIFICATION"
echo "========================================"

echo ""
echo "--- Frontend TypeScript ---"
cd frontend && npx tsc --noEmit && echo "✅ Frontend clean" || echo "❌ FAIL"

echo ""
echo "--- Backend TypeScript ---"
cd ../backend && npx tsc --noEmit && echo "✅ Backend clean" || echo "❌ FAIL"

echo ""
echo "--- Production build ---"
cd ../frontend && npm run build && echo "✅ Build passes" || echo "❌ FAIL"

echo ""
echo "--- Auction mechanics regression ---"
cd ../backend && npx vitest run src/lib/auction/__tests__/mechanics.test.ts 2>/dev/null && echo "✅ Mechanics tests pass" || echo "⚠️  No test file found or tests failed"

echo ""
echo "--- No unintended 501 stubs ---"
echo "501s remaining (only NOWPayments expected):"
grep -rn "501" backend/src/controllers/ backend/src/routes/ --include="*.ts" | grep -iv "nowpayments\|crypto"

echo ""
echo "--- Migration file exists ---"
ls supabase/migrations/*content_flag* && echo "✅ Migration ready" || echo "❌ MISSING"

echo ""
echo "--- Stripe metadata present ---"
grep -c "transactionId" supabase/functions/_shared/payment/processors/StripeProcessor.ts

echo ""
echo "--- Search rate limit present ---"
grep -c "searchRateLimit\|rateLimit" backend/src/routes/search.ts

echo ""
echo "--- No raw localhost in edge function action_urls ---"
grep -rn "localhost:5173" supabase/functions/settle-auction/ supabase/functions/check-payment-window/ supabase/functions/release-escrow/ supabase/functions/payment-webhook/ 2>/dev/null | grep "action_url" && echo "❌ Still hardcoded" || echo "✅ No hardcoded localhost in action_urls"

echo ""
echo "========================================"
echo "VERIFICATION COMPLETE"
echo "========================================"
```

---

## PHASE 8: Documentation Updates

### Step 8a — Update TODO.md

Open `docs/TODO.md`. Mark the following items as complete with today's date:

- `[ ] Stripe transactionId in PaymentIntent metadata` → `[x] DONE — StripeProcessor metadata fixed (YYYY-MM-DD)`
- `[ ] Rate limit GET /search` → `[x] DONE — 60 req/min rate limit applied (YYYY-MM-DD)`
- `[ ] FRONTEND_URL in edge functions` → `[x] DONE — all four edge functions use env var (YYYY-MM-DD)`
- `[ ] Admin dispute approve/reject endpoints` → `[x] DONE — status transitions + audit logging implemented (YYYY-MM-DD)`
- `[ ] Content flag enum expansion` → `[x] DONE — migration file created, not yet pushed (YYYY-MM-DD)`

If verify route rate limiting was skipped (Module 13 not yet implemented), add:
- `[ ] Rate limits on /verify endpoints — awaiting Module 13 NFC implementation (HIGH)`

### Step 8b — Update LESSONS_LEARNED.md

Append this entry to `docs/LESSONS_LEARNED.md`:

```markdown
## Session: HIGH Priority TODO Fixes — [DATE]

### Stripe Webhook Correlation
Stripe's `paymentIntents.create()` metadata block must include `transactionId` at creation time.
The webhook handler cannot retroactively match events without it. Pattern: always pass internal
IDs into payment processor metadata at the moment the payment intent is created.

### Rate Limiting Pattern
`express-rate-limit` is already installed. To add rate limiting to any Express route:
1. Import at top of route file
2. Create named limiter const with appropriate windowMs/max for the route's risk profile
3. Apply with `router.use(limiter)` before the first route handler
Public read endpoints: 60-120/min. Write/scan endpoints: 30/min. Auth endpoints: 10/min.

### Edge Function Environment Variables
Edge functions use `Deno.env.get('VAR_NAME')` — not `process.env`. Always include a localhost
fallback for local dev: `Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'`. Set the
production value in Supabase Dashboard → Edge Functions → Secrets, not in any committed file.

### Dispute Resolution Status Machine
Settlement status transitions for disputes:
- DISPUTED → REFUNDED (dispute approved, buyer wins)
- DISPUTED → ESCROW_HOLD (dispute rejected, seller wins, escrow timer resets to now + 72h)
Actual payment processor refund calls (Stripe `refunds.create()`) are separate from status
updates and should be triggered after the status transition is confirmed in DB.

### Content Flag Enum — Same-Transaction Pattern
When adding new enum values AND referencing them in the same migration, PostgreSQL will throw
an error. Use TEXT type for columns that need to reference newly-added enum values in the same
transaction. See Module 13 pattern in earlier LESSONS_LEARNED entries.
```

### Step 8c — Update ARCHITECTURE_REFERENCE.md (if it exists)

```bash
ls unmentionables/Unmen/docs/ARCHITECTURE_REFERENCE.md 2>/dev/null && echo "Exists — update with new dispute endpoints" || echo "Does not exist — skip"
```

If it exists, add the two new admin endpoints to the API reference section:
```
POST /api/v1/admin/disputes/:id/approve — Approve dispute (DISPUTED → REFUNDED)
POST /api/v1/admin/disputes/:id/reject  — Reject dispute (DISPUTED → ESCROW_HOLD, resets escrow timer)
```

---

## PHASE 9: Commit

```bash
cd unmentionables/Unmen

git add -A

git commit -m "fix: HIGH priority TODOs — Stripe metadata, search rate limit, FRONTEND_URL, content flags, dispute resolution

- StripeProcessor: add transactionId to PaymentIntent metadata for webhook correlation
- backend/routes/search: add 60 req/min rate limit (express-rate-limit)
- Edge functions: replace hardcoded localhost:5173 with FRONTEND_URL env var in action_urls
- supabase/migrations: add content_flag enum expansion (SWIMWEAR, LINGERIE, PERSONAL_ITEM, FETISH)
- Admin dispute endpoints: implement approve (DISPUTED→REFUNDED) and reject (DISPUTED→ESCROW_HOLD)
- docs: TODO.md updated, LESSONS_LEARNED.md updated

Note: Content flag migration file created but NOT pushed. Apply with next batch migration push.
Note: Verify endpoint rate limiting deferred pending Module 13 NFC implementation (if applicable)."
```

---

## PHASE 10: Session Report

After all phases complete, provide a report in this format:

```
SESSION COMPLETE — HIGH Priority TODO Fixes

FILES CHANGED: [count]
TS ERRORS: [frontend: 0, backend: 0]
BUILD: [pass/fail]
TESTS: [mechanics: pass/fail | n/a]

FIXES APPLIED:
✅ Fix 1 — Stripe transactionId metadata
✅ Fix 2 — Search rate limit (60/min)
✅ Fix 3 — FRONTEND_URL in edge functions ([N] files updated)
✅ Fix 4 — Content flag migration created (not pushed)
✅ Fix 5 — Dispute resolution endpoints (approve + reject)
[✅/⏭️] Fix 6 — Verify endpoint rate limits ([applied / deferred — Module 13 pending])

REMAINING 501s: [list any intentional ones, e.g., NOWPayments refund]

NEW ITEMS FOR TODO.md:
[list anything discovered during this session that needs follow-up]

MIGRATION PENDING (do not forget):
supabase/migrations/[timestamp]_content_flag_enum_expansion.sql
```

---

*End of session document.*
