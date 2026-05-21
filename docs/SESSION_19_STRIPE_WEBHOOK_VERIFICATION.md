# Session 19 — Stripe `payment-webhook` Registration & Verification

**Owner:** Boss (Stripe Dashboard task) → Claude (post-registration verification)
**Estimated time:** ~10 min (5 min in Stripe Dashboard, 2 min for secrets push, 3 min for verification)
**Status:** ⏳ Pending — last open item in session 19 close-out
**Created:** 2026-05-21

---

## Why this matters

Session 18 verified the full Stripe payment cascade end-to-end on staging — real PaymentIntent → real Connect Transfer → real Postmark email. The one step that's still manual: when `process-payment` succeeds, the matching `settlements` row should auto-flip from `PENDING_PAYMENT` to `ESCROW_HOLD` via the `payment_intent.succeeded` webhook. Today that transition is done by a synthetic SQL `UPDATE`. Registering the webhook closes that loop. After this lands, the buyer flow runs end-to-end through Stripe + the Edge Functions without any DB manipulation.

The Edge Function is already deployed:
- `payment-webhook` v18 ACTIVE on `pmlofthmobglcfkqjtru`
- `verify_jwt: false` (so Stripe can hit it directly)
- Uses `constructEventAsync` (lesson #2 from Critical Lessons — verified at `supabase/functions/_shared/payment/processors/StripeProcessor.ts:156`)

The only thing missing is the Stripe Dashboard endpoint + a signing secret in env.

---

## Step 1 — Register the endpoint in Stripe Dashboard

1. Open Stripe Dashboard → **Developers → Webhooks** (account-level — NOT the Connect endpoint that's already registered for Phase 7D account.updated events).
2. Click **Add endpoint**.
3. Configure:
   - **Endpoint URL:** `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook`
   - **Description:** "Settlement state transitions on payment intent success/failure (session 19 close-out)"
   - **Events to send** (select these two exactly):
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
   - **Listen to:** Events on your account (not Connected accounts — that's the other endpoint).
   - **API version:** match your account default (currently `2025-09-30.acacia` or similar — Stripe will pick the right one).
4. Click **Add endpoint**.
5. Click **Reveal** next to the new endpoint's signing secret. Copy the value (starts with `whsec_...`).

---

## Step 2 — Update 1Password

Update the existing vault entry (do NOT create a new one):

```bash
op item edit "Stripe" --vault AM_Development \
  --account kyniteinc.1password.ca \
  "webhook-secret[password]=whsec_PASTED_FROM_STRIPE_DASHBOARD"
```

Verify:

```bash
op read "op://AM_Development/Stripe/webhook-secret" --account kyniteinc.1password.ca
```

Should print the same `whsec_...` you pasted.

---

## Step 3 — Push the secret to Supabase Edge Functions

```bash
supabase secrets set \
  STRIPE_WEBHOOK_SECRET="$(op read 'op://AM_Development/Stripe/webhook-secret' --account kyniteinc.1password.ca)" \
  --project-ref pmlofthmobglcfkqjtru
```

Verify it landed:

```bash
supabase secrets list --project-ref pmlofthmobglcfkqjtru | grep -i STRIPE_WEBHOOK_SECRET
```

You should see `STRIPE_WEBHOOK_SECRET` listed with a non-empty hash. Supabase doesn't show the value — only that it's set.

**Note:** This sets a *project-level* secret. The Edge Function picks it up on the next invocation; no redeploy needed.

---

## Step 4 — Send a Stripe test event

In Stripe Dashboard, on the new endpoint's detail page:

1. Click **Send test webhook**.
2. Pick event type: `payment_intent.succeeded`.
3. Use the sample payload (Stripe pre-fills a realistic one).
4. Click **Send test webhook**.
5. Watch the **Events** section on the endpoint — the new event should appear with **200 OK** within a couple of seconds.

If you see **400** or **401**:
- `400` with `Webhook signature verification failed` → the signing secret in Supabase doesn't match the Stripe endpoint. Re-run Step 3.
- `401 Missing JWT` → the function was redeployed with `verify_jwt: true` somehow. Check `supabase/functions/payment-webhook/config.toml` should have `verify_jwt = false`. If it doesn't, redeploy with `--no-verify-jwt`.

---

## Step 5 — End-to-end verification with a real fixture

The real test is: can a payment intent's success flip a settlement to ESCROW_HOLD without manual SQL?

**Pre-req:** A settlement in `PENDING_PAYMENT` status on prod (Stripe test mode). The session 18 fixtures (`[E2E-TEST-2026-05-11]`) are likely in `RELEASED` state already — you'll need a fresh one OR rerun session 18's "Real-Data E2E" curl sequence.

### Quickest path: rerun the session 18 curl pattern

From `docs/MODULE_7D_VERIFICATION.md` "Real-Data E2E COMPLETE 2026-05-12":

```bash
# 1. Pick a fresh listing + auction (or create one via the UI as Chris admin)
LISTING_ID="..."
AUCTION_ID="..."

# 2. Force-end the auction (still SQL — auction-end UI is a separate TODO)
psql "$SUPABASE_DB_URL" -c "UPDATE auctions SET status='ENDED', end_time=NOW() - INTERVAL '1 second' WHERE id='$AUCTION_ID';"

# 3. Curl settle-auction (creates settlement in PENDING_PAYMENT)
curl -sX POST "https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/settle-auction" \
  -H "x-settle-secret: $(op read 'op://AM_Development/Supabase/settle-secret')" \
  -H "Content-Type: application/json" \
  -d "{\"auctionId\":\"$AUCTION_ID\"}" | jq .

# 4. Curl process-payment with pm_card_visa (creates the PaymentIntent → fires the webhook)
SETTLEMENT_ID="..."  # from step 3 response
curl -sX POST "https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/process-payment" \
  -H "Authorization: Bearer $(op read 'op://AM_Development/Supabase/service-role-key')" \
  -H "Content-Type: application/json" \
  -d "{\"settlementId\":\"$SETTLEMENT_ID\",\"paymentMethodId\":\"pm_card_visa\",\"riskTier\":\"LOW\"}" | jq .
```

### What to look for

**Before the webhook fix (today's behavior):**
```sql
SELECT id, status, escrow_ends_at FROM settlements WHERE id = '<SETTLEMENT_ID>';
-- status = 'PENDING_PAYMENT'  ← stuck here without manual UPDATE
```

**After the webhook fix:**
```sql
SELECT id, status, escrow_ends_at FROM settlements WHERE id = '<SETTLEMENT_ID>';
-- status = 'ESCROW_HOLD'  ← flipped automatically by payment-webhook within 5-10s
-- escrow_ends_at = NOW() + INTERVAL '14 days' (or whatever the escrow window is)
```

The session-18 manual SQL workaround:
```sql
-- DEPRECATED after webhook registration — no longer needed
-- UPDATE settlements SET status='ESCROW_HOLD' WHERE id='<SETTLEMENT_ID>';
```

If `settlements.status` does NOT flip automatically within ~30s of the `process-payment` 200 response:
- Check Stripe Dashboard → Webhooks → your endpoint → **Recent attempts**. Look for 4xx/5xx on the most recent `payment_intent.succeeded` event.
- Check Supabase Dashboard → Edge Functions → `payment-webhook` → Logs. Look for `Webhook signature verification failed` or DB errors.

---

## Step 6 — Tick the TODO + sync Notion

After successful verification:

1. In `docs/TODO.md` "Session 19 close-out" — change the Stripe webhook line from `[ ]` to `[x]` and add a date.
2. If anything surprising came up, add a lesson to the Lessons Learned DB (especially anything about Stripe signing secret rotation or Dashboard event subscriptions).
3. CLAUDE.md doesn't need a version bump for this — it's a routine close-out, not a content/structural change.

---

## Rollback / abort path

If something goes wrong and you need to back out:

1. **In Stripe Dashboard:** disable the new endpoint (don't delete it — keeps the signing secret stable for next attempt).
2. **In Supabase:** the `STRIPE_WEBHOOK_SECRET` env var stays — the function just won't be called.
3. **The synthetic SQL UPDATE** from session 18 keeps working as a fallback until you re-enable.

No code rollback needed; this is pure config.

---

## What this DOESN'T do

- Doesn't fix the still-stub Pay Now button on SettlementPage (that's session 21 — Stripe Elements).
- Doesn't address production-mode (live) keys — still in Stripe test mode. Production key rotation is tracked separately under "Rotate ALL secrets at prod cutover" in `docs/TODO.md`.
- Doesn't auto-create a payment_intent.succeeded event if the underlying Edge Function call fails — it's a downstream notification, not a primary trigger.

---

## After this lands

Session 19 is fully closed. Next up:

- **Session 20** — Admin Listings/Auctions management. Brief: `docs/SESSION_20_BRIEF_ADMIN_LISTINGS_AUCTIONS.md`. Branch: `feature/session-20-admin-auctions` (already created locally).
- **Session 21** — Stripe Elements / Payment Element on SettlementPage. Needs `op://AM_Development/Stripe/publishable-key` populated first; backend `.env` shows a `pk_test_*` value already present, so verify which item it should canonically live under.
- **Session 22+** — Yoti integration. Decision locked.
