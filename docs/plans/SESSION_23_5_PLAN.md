# Session 23.5 Plan — Waitlist Welcome Email

**Branch:** `feature/session-23-5-waitlist-welcome` (off `dev`)
**Date drafted:** 2026-05-30
**Status:** 📝 Draft — awaiting Boss approval
**Parent context:** S23 shipped the Postmark plumbing for transactional notifications (sha `6266703`). The landing-page `<WaitlistCapture>` component writes to `waitlist_signups` directly and sends no email — this session closes that gap.

## Objective

When a visitor submits their email at the bottom of any landing page (`/collector`, `/creator`, `/am-sealed`, `/am-proof`), they receive a Postmark "you're on the list" welcome email within seconds. Source-aware: the email's copy + the post-launch follow-up bucket varies by `waitlist_signups.source` (`collector` vs `creator` vs an `am-*` value).

## Approach: Supabase Database Webhook → new edge function

Pattern parallel to the three Phase 7E edge-function senders (`settle-auction`, `release-escrow`, `check-payment-window`):

1. Frontend → direct insert into `waitlist_signups` (unchanged — the existing `joinWaitlist()` helper stays as-is).
2. Supabase **Database Webhook** (Dashboard config) fires on `INSERT INTO waitlist_signups` and POSTs the new row JSON to a new edge function.
3. New edge function `waitlist-welcome` validates the webhook secret, reads `email` + `source`, picks the right inline-HTML template, calls the existing `_shared/postmark.ts` `sendEmail()` helper.

Why Database Webhooks over a Postgres trigger + `pg_net`: the webhook is configured + monitored in the Supabase Dashboard, retries on 5xx for free, doesn't require enabling/wiring `pg_net` or storing a Postmark token in a Postgres GUC. Same maturity as the other live integrations.

Why not move the insert behind an edge function instead: the current flow is one round-trip from the browser to Supabase REST. Inserting a synchronous email send into the user's submission path adds ~300–500ms of latency for no UX benefit — the user already sees "You're on the list" before the email needs to land.

## Files to create

| File | Purpose |
|---|---|
| `supabase/functions/waitlist-welcome/index.ts` | Edge function — Bearer-token auth, parses Database Webhook envelope `{ type:'INSERT', table:'waitlist_signups', record:{...} }`, dispatches by `source` to the right inline HTML, sends via `_shared/postmark.ts`. |
| `supabase/functions/waitlist-welcome/deno.json` | Function-scoped Deno config (matches sibling functions). |
| `docs/SESSION_23_5_VERIFICATION.md` | Close-out doc + manual E2E walkthrough. |

## Files to modify

| File | Change |
|---|---|
| `docs/TODO.md` | Replace today's S23 line with an S23.5 in-progress line; cross-link to this plan. |

## Files to read but not modify

- `supabase/functions/_shared/postmark.ts` — reuse `sendEmail()` + `emailRecipient()` (the latter doesn't apply here since waitlist signups aren't `users` rows yet).
- `supabase/functions/settle-auction/index.ts` — reference for inline HTML style + import shape.

## Database changes

**None.** `waitlist_signups` table is unchanged. The webhook is dashboard-configured (not schema), so no migration. If you'd prefer the webhook lives in code, we can add a `pg_net` trigger via migration — flag it and I'll pivot.

## Edge function design

```
POST /functions/v1/waitlist-welcome
Authorization: Bearer <WAITLIST_WEBHOOK_SECRET>
Content-Type: application/json

{
  "type": "INSERT",
  "table": "waitlist_signups",
  "record": { "id": "...", "email": "...", "source": "collector", "created_at": "..." },
  "schema": "public",
  "old_record": null
}
```

Behavior:
- Reject non-Bearer or wrong-secret with 401, no body parse.
- Reject non-INSERT or wrong-table with 200 + log (Supabase will retry on non-2xx; we don't want retries for benign mismatches).
- Pick template by `record.source` — `collector` (default), `creator`, anything starting with `am-` falls through to the generic SFW Authentic Materials welcome.
- `sendEmail({ to: record.email, subject, htmlBody })` — failure is logged but returns 200 (Supabase shouldn't retry deliverability problems; Postmark handles bounces).
- Idempotency: the webhook can fire >1x on dashboard pause/resume. The function reads-the-row-back is unnecessary because Postmark dedupe is best-effort anyway; instead we accept rare duplicate sends and rely on the unique-email constraint on `waitlist_signups` to keep the second INSERT from firing in the first place.

## Templates (inline in the edge function)

Per the Phase 7E pattern (`settle-auction` etc.), templates live inline. Three variants:

| `source` | Subject | CTA |
|---|---|---|
| `collector` (default) | "You're on the list — Authentic Materials" | "Browse drops as they go live" → `${FRONTEND_URL}/collector` |
| `creator` | "Welcome — let's get you set up to sell" | "Become a creator" → `${FRONTEND_URL}/creator` |
| any `am-*` value | "You're on the list — Authentic Materials" | Same as collector |

Body for all three: confirm signup, set expectation ("we'll only email when something matters"), unsubscribe-via-reply line (List-Unsubscribe header is overkill until we have a real preference center; "reply STOP" is sufficient at this scale).

## Configuration

| Secret/setting | Where | Value |
|---|---|---|
| `WAITLIST_WEBHOOK_SECRET` | Supabase Edge Function secrets (set via `supabase secrets set`) | Generate a fresh random 32-byte hex string; store in 1Password `op://AM_Development/Waitlist/webhook-secret`. |
| Database Webhook | Supabase Dashboard → Database → Webhooks → "Create a new hook" | Name: `waitlist_welcome`. Table: `waitlist_signups`. Events: `INSERT`. Method: `POST`. URL: `${BACKEND_URL}/functions/v1/waitlist-welcome`. Headers: `Authorization: Bearer ${WAITLIST_WEBHOOK_SECRET}`. |
| `POSTMARK_SERVER_TOKEN` + `POSTMARK_FROM_EMAIL` | Edge Function secrets | Already set in Phase 7E — reused. |

## Test plan

- **Function-local smoke:**
  ```bash
  supabase functions serve waitlist-welcome --env-file supabase/.env.local --no-verify-jwt
  ```
  POST a fake webhook payload with each of the 3 sources → confirm Postmark sandbox-mode logs the right subject + recipient.
- **Staging E2E (post-deploy):**
  1. Visit `https://d1bwev65w7rqzl.cloudfront.net/collector` → submit a test email → confirm Postmark Activity dashboard shows the send + inbox arrives.
  2. Repeat from `/creator` → confirm the creator copy + CTA.
  3. Submit the same email twice → confirm the second insert returns `duplicate: true` (existing path) and the function does NOT fire a second email (because the INSERT is rejected by the unique constraint).
- **No new vitest specs** — edge functions aren't part of the backend vitest harness. Sufficient coverage: function-local smoke + staging E2E.

## Dependencies

- S23 ✅ (provides Postmark plumbing pattern; this just adds a new edge function consumer).
- Phase 7E ✅ (provides `_shared/postmark.ts` + Postmark secrets already in edge env).
- **DKIM/SPF still pending** — same caveat as S23: until the sender signature on `noreply@authentic-materials.com` is DNS-verified, welcome emails will deliver but risk spam under `p=quarantine` DMARC. Recommend doing the DNS work before flipping the Database Webhook on in the dashboard, so the first impression for new signups isn't spam-foldered.

## Estimated effort

~30–45 min: 1 edge function (~80 lines including 3 inline templates), 1 dashboard config step (Database Webhook), 1 secret added, deploy + staging E2E. Single short session.

## Session-end checklist

- [ ] Edge function `waitlist-welcome` deployed (`supabase functions deploy waitlist-welcome --use-api`)
- [ ] `WAITLIST_WEBHOOK_SECRET` written to 1Password + `supabase secrets set`
- [ ] Database Webhook configured in dashboard pointing at the function
- [ ] All 3 source variants exercised on staging end-to-end (verified in Postmark Activity dashboard)
- [ ] `docs/SESSION_23_5_VERIFICATION.md` written
- [ ] DKIM/SPF status re-stated in verification doc as the gating item for deliverability quality
- [ ] Merge to `dev` + push (Boss-authorized)

## Out of scope (deferred)

- Drip campaigns / scheduled follow-up sequences — Postmark Broadcasts or a separate tool when we're ready to do real marketing automation.
- Unsubscribe preference center (List-Unsubscribe header, dedicated table) — premature until we send >1 email per signup.
- Brand-token split for Unmentionables welcome (NSFW) — Unmentionables landing page doesn't exist yet (per CLAUDE.md current state).
- Migrating inline templates into `_shared/emailTemplates.ts` for Deno — same deferred item as Phase 7E and S23.
