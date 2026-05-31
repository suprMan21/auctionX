# Session 23.5 Verification — Waitlist Welcome Email

**Branch:** `feature/session-23-5-waitlist-welcome`
**Plan:** `docs/plans/SESSION_23_5_PLAN.md`
**Date:** 2026-05-31
**Status:** ✅ Code complete + deployed + webhook live — pending Boss landing-page smoke test on /collector + /creator.

## What shipped

| Layer | Artifact | Notes |
|---|---|---|
| Edge function | `supabase/functions/waitlist-welcome/index.ts` | ~150 LOC. Bearer-auth on `WAITLIST_WEBHOOK_SECRET` with constant-time compare. Parses Supabase Database Webhook envelope, dispatches by `record.source` to 2 inline HTML templates (collector + creator; any `am-*` value falls through to collector). Sends via `_shared/postmark.ts` `sendEmail()`. Non-INSERT or wrong-table events return 200/ignored (no Supabase retry). Send failures return 200 (Postmark handles its own bounce/suppression — we don't want webhook retries on deliverability issues). |
| Secret | `WAITLIST_WEBHOOK_SECRET` | 32-byte hex generated 2026-05-30, stored at `op://AM_Development/Waitlist Webhook/webhook-secret`, set as Supabase edge function secret via `supabase secrets set` (digest visible in `supabase secrets list`). |
| Database Webhook | Supabase Dashboard → Integrations → Webhooks → `waitlist_welcome` | Table=`waitlist_signups`, Event=INSERT, Method=POST, URL=`https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/waitlist-welcome`, Authorization header = `Bearer <raw secret>`. Boss-configured 2026-05-31 — confirmed "its live". |
| Frontend | (none — `WaitlistCapture` + `joinWaitlist` unchanged) | The existing anon insert path continues to fire; the new email is purely a server-side reaction to the row insert. |

## Acceptance gates

| Gate | Result |
|---|---|
| `deno check supabase/functions/waitlist-welcome/index.ts` | ✅ 0 errors |
| `supabase functions deploy waitlist-welcome --use-api --no-verify-jwt` | ✅ Deployed (first deploy without `--no-verify-jwt` was rejected by Supabase platform JWT gate — see Lessons) |
| Direct curl — wrong Bearer → 401 | ✅ |
| Direct curl — right Bearer + non-INSERT → 200 `{"ignored":true}` | ✅ |
| Direct curl — right Bearer + INSERT w/ missing email → 400 `{"error":"Malformed record"}` | ✅ |
| Direct curl — right Bearer + valid INSERT (`source:"collector"`) → 200 `{"sent":true}` + email delivered to inbox | ✅ |
| Direct curl — right Bearer + valid INSERT (`source:"creator"`) → 200 `{"sent":true}` + email delivered to inbox | ✅ |
| Real landing-page submit on `/collector` → Postmark Activity dashboard shows send + inbox arrival | ⏳ Boss to verify |
| Real landing-page submit on `/creator` (use fresh email — duplicates short-circuit before the webhook) | ⏳ Boss to verify |

## Idempotency + dedup notes

- `waitlist_signups.email` has a UNIQUE constraint (from migration `20260401000001_waitlist_signups.sql`). The frontend `joinWaitlist()` catches `error.code === '23505'` and returns `{ duplicate: true }` without re-inserting. This means: **the webhook never fires for duplicate emails**, so a user who signs up on `/collector` first then tries `/creator` with the same email will NOT receive a second (creator-variant) welcome — they get a UI "You're already on the list" instead. Mid-session diagnosis: Boss initially reported "creator not working"; root cause was re-using a collector-signup email on the creator page. Test with fresh emails per source.
- Supabase Database Webhook retries on 5xx responses. The function returns 200 in every benign case (ignored events, malformed envelopes, send failures) to suppress unwanted retries. A duplicate send is acceptable; a retry loop is not.

## Decisions baked in

- **Webhook over Postgres-trigger-with-pg_net.** Database Webhooks are dashboard-configured, monitored, and retried for free; no `pg_net` extension wiring or in-DB secret storage required. Trade-off: Boss has to remember the webhook lives in the Supabase Dashboard (not in code). Captured in plan doc.
- **Send out-of-band, not in user submission path.** Keeps the landing page's "You're on the list" feedback to one round-trip. Postmark latency (~200–500ms) doesn't block the UX.
- **Inline templates instead of `_shared/emailTemplates.ts`.** Mirrors the Phase 7E edge-function pattern (`settle-auction`, `release-escrow`, `check-payment-window` all inline their HTML). Extracting to a Deno-importable shared module is a deferred cleanup that should happen across all 4 functions at once, not piecemeal in S23.5.
- **Header in templates says "Authentic Materials"** (not the legacy "AuctionX" still hard-coded in `backend/src/lib/notifications/emailTemplates.ts`). Establishes the precedent for the eventual rebrand sweep across all templates.

## Lessons learned

1. **Supabase Edge Functions enforce a platform-level JWT check by default.** The first deploy (without `--no-verify-jwt`) rejected my Bearer-auth smoke tests with `UNAUTHORIZED_INVALID_JWT_FORMAT` before my function ever ran. Database Webhooks don't send Supabase JWTs (they send whatever headers you configure), so functions invoked by webhooks need `--no-verify-jwt`. The function's own Bearer secret becomes the auth gate.
2. **Postmark Database Webhook header storage.** Headers (including the Bearer secret) are stored in the Postgres trigger args under the hood, masked in the dashboard UI but readable by anyone with `service_role` DB access. For S23.5 staging the blast radius is small (only protects this one function); for prod, evaluate the Supabase Vault `{{vault.secret_name}}` syntax to keep the raw value out of trigger args.

## Deferred / follow-up

- **Migrate inline templates** in all 4 edge functions to a Deno-importable shared template module — one cleanup pass across `settle-auction`, `release-escrow`, `check-payment-window`, `waitlist-welcome`. Carryover from Phase 7E + S23.
- **Rebrand sweep** of `backend/src/lib/notifications/emailTemplates.ts` ("AuctionX" → "Authentic Materials"). Separate session.
- **Unmentionables-variant welcome** when the Unmentionables landing page ships — reuse `waitlist-welcome` with a new template variant for the NSFW brand, or fork as needed.
- **Drip / scheduled follow-up sequences** — out of scope until we're ready for real marketing automation. Postmark Broadcasts or a separate tool.
- **Evaluate Supabase Vault for the webhook Bearer** before prod cutover.
