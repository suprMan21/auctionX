# Phase 7E — Email Notifications: Verification

**Date:** 2026-05-09
**Branch:** merged into `dev` via merge commit `b36b8e2` on top of `fe43ddc` (feat). Local `dev` ahead of `origin/dev` by 14 commits — Boss to push manually.

## What shipped this session (delta)

The Node-side Postmark integration was already merged in commit `8534036` from a prior session — `emailSender.ts`, all 10 templates in `emailTemplates.ts`, `notificationService.ts` preference orchestrator, and four controller call-sites (bid, payout, verification, messaging). This phase added the missing edge-function layer.

| Layer | Artifact | Status |
|-------|----------|--------|
| Edge runtime helper | `supabase/functions/_shared/postmark.ts` | ✅ `sendEmail()` REST + `emailRecipient()` preference check (mirrors backend `PREF_COLUMN_MAP`) |
| `settle-auction` | AUCTION_WON email after settlement insert | ✅ Deployed (version bumped on staging) |
| `release-escrow` | ESCROW_RELEASED emails to seller + buyer | ✅ Deployed |
| `check-payment-window` | PAYMENT_WINDOW_EXPIRING email to expired bidder | ✅ Deployed |
| Supabase secrets | `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL` | ✅ Set via `supabase secrets set` (read from 1Password vault `AM_Development/Postmark API`) |
| Plan doc | `docs/plans/2026-05-09-phase-7e-email-notifications.md` | ✅ Patched to mark Tasks 1–3 as complete in prior session, removed stale "stub" language |

## End-to-end smoke

- All four edge functions redeployed to staging via `supabase functions deploy --use-api`. No Docker dependency. (Default Docker-bundled deploy hung silently — `--use-api` is the recommended path for headless / CI environments.)
- `supabase secrets list` confirms POSTMARK_* digests present.
- A real outbid/win/expire flow was not exercised in this session (would require placing a live test bid + winning + cron firing). Recommended Boss verification:
  1. Place a bid as `test@authentic-materials.com`, get outbid from another account → AUCTION_OUTBID email arrives (already wired via `bidController` + Node-side `notificationService`).
  2. Trigger a password reset → arrives via Postmark SMTP **once Boss has finished the SMTP config below**.
  3. Settle a test auction → AUCTION_WON email to winner.
  4. Wait 72h on a successful purchase → ESCROW_RELEASED emails to both parties.
  5. Don't pay within 20 minutes after winning → PAYMENT_WINDOW_EXPIRING email.

## Auth SMTP verified end-to-end (2026-05-09 20:19 UTC)

```
[failed]  2026-05-09 20:10:32Z  /recover → 500 unexpected_failure
          error: "535 5.7.8 Error: authentication failed"
          (cause: Username field had a different value than Password — Postmark
           SMTP requires both fields to hold the Server API token)

[fixed]   Boss re-pasted the same Postmark Server Token into both Username and
          Password on the Auth SMTP form

[passed]  2026-05-09 20:19:18Z  /recover → 200 (no error_code, 250ms)
          → SMTP auth accepted, recovery email handed off to Postmark
```

Confirmation pending in `test@authentic-materials.com` inbox + Postmark Activity dashboard. If the message lands in Postmark Activity but not the inbox, that's a DKIM/SPF sender-signature issue at Postmark, not Supabase.

## Remaining nice-to-have items

- **Verify Postmark sender signature** for `noreply@authentic-materials.com` in [Postmark → Sender Signatures](https://account.postmarkapp.com/signature_domains). DKIM + Return-Path approval is what makes deliverability work cleanly (no spam folder routing). If the SMTP-handoff succeeds but the email doesn't arrive, this is the first thing to check.

## Notable decisions

- **Single Deno helper for all 3 edge functions** — `_shared/postmark.ts` exports both `sendEmail` (low-level REST) and `emailRecipient(supabase, userId, type)` (preference-aware lookup that mirrors the backend `PREF_COLUMN_MAP`). Saves ~120 lines of duplicated preference-check logic across the three functions.
- **Inline HTML templates** in each edge function — Deno can't import the backend `emailTemplates.ts` (npm + Node-only). Templates are tiny inline glassmorphic-styled HTML matching the AuctionX dark theme. If templates start drifting between Node and Deno, future work could extract them to a shared `_shared/emailTemplates.ts` (Deno-friendly, no Node deps).
- **Non-fatal sends** — every email path is wrapped in try/catch with a `logger.warn`. Notification failures must never block a settlement or a payout flow (existing convention from `insertNotification` helper).
- **`emailRecipient` returns `null` if the user has no email** or has opted out — the caller's only check is `if (recipient) await sendEmail(...)`. Keeps each call site small.

## Deferred

- AuctionX-branded variant of the same templates (collectxmrkt.com sender, sports memorabilia copy). Currently all emails use the Authentic Materials sender + brand voice.
- Postmark click/open tracking, suppression-list management.
- Migrating the inline HTML in edge functions to a Deno-importable shared template module.
