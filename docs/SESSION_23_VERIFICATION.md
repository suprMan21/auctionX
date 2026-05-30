# Session 23 Verification — Postmark Seller-Verification Emails

**Branch:** `feature/session-23-postmark-verification-emails`
**Plan:** `docs/plans/SESSION_23_PLAN.md`
**Date:** 2026-05-30
**Status:** ✅ Code complete — pending Boss-side staging migration push + DNS DKIM/SPF for Postmark sender signature.

## What shipped (code)

| Layer | Artifact | Notes |
|---|---|---|
| Migration | `supabase/migrations/20260530000003_notification_prefs_seller_verification.sql` | Appends `seller_verification_approved` + `seller_verification_rejected` boolean columns to `notification_preferences`, both `NOT NULL DEFAULT true`. Extension-only, schema-lock compliant. Idempotent (`ADD COLUMN IF NOT EXISTS`). |
| Templates | `backend/src/lib/notifications/emailTemplates.ts` | Added `sellerVerificationApprovedEmail({ username, dashboardUrl })` and `sellerVerificationRejectedEmail({ username, rejectionReason, supportUrl })` matching the existing dark-glassmorphic style. |
| Mapping + dispatch | `backend/src/lib/notifications/notificationService.ts` | `PREF_COLUMN_MAP` gains 2 entries (`SELLER_VERIFICATION_APPROVED` → `seller_verification_approved`, same for rejected). New `renderEmail()` dispatcher routes the 2 new types to the rich templates and falls back to the existing generic inline-HTML body for every other type — backwards compatible with all 4 existing controller call-sites. `send()` now fetches `username` alongside `email` (single round-trip). |
| Controller wiring | `backend/src/controllers/yotiVerificationController.ts` | Replaced the 2 `// TODO(S23)` + `logger.info('postmark_stub_*')` blocks at L378–383 with real `notificationService.send(...)` calls. Rejection path threads `rejectionReason` through `metadata` so the template renders it. |
| Tests | `backend/src/__tests__/yotiVerification.test.ts` | Added 3 specs (`SELLER_VERIFICATION_APPROVED` fires on VERIFIED, `SELLER_VERIFICATION_REJECTED` fires with rejection reason, idempotency short-circuit suppresses notification). `vi.hoisted` spy on `notificationService` keeps existing state-machine specs green without re-mocking the supabase chain. |

## Acceptance gates

| Gate | Result |
|---|---|
| `cd backend && npx tsc --noEmit` | ✅ 0 errors |
| `cd backend && npx vitest run` | ✅ 55 passed / 21 skipped (was 52 / 21 before S23 — +3 new specs) |
| `cd backend && npx vitest run src/__tests__/yotiVerification.test.ts` | ✅ 29 passed (was 26 before S23) |
| Migration applied on staging | ⏳ Pending — Boss to run `supabase db push --linked` from `amShell` (this session's `cCode`-mode 1Password auth expired mid-session) |
| Frontend `tsc --noEmit` | n/a — no frontend changes |
| Postmark Sender Signature for `noreply@authentic-materials.com` | ❌ Not yet verified — see follow-up below |

## Postmark deliverability — CORRECTION

> **Initial audit was wrong.** This section was rewritten 2026-05-30 19:05 UTC after re-querying Postmark's Domains API (`/domains/5018956`) with the Account Token from 1Password. The earlier dig used the wrong DKIM selectors (`pm._domainkey`, `postmark._domainkey`, `20240220._domainkey`) — Postmark's actual selector is timestamp-prefixed.

DNS audit re-run with Postmark's actual record names:

```
DMARC:        v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net   ✅
DKIM host:    20260509151220pm._domainkey.authentic-materials.com → k=rsa; p=MIGfMA…vQIDAQAB     ✅ (Postmark-controlled key, matches /domains/5018956)
Return-Path:  pm-bounces.authentic-materials.com → pm.mtasv.net.                                  ✅ (CNAME resolves)
SPF (raw):    v=spf1 include:dc-aa8e722993._spfm.authentic-materials.com ~all                    ⚠️ (see below)
```

Postmark API reports `SPFVerified: true / DKIMVerified: true / ReturnPathDomainVerified: true` for `authentic-materials.com` (domain ID 5018956).

**SPF caveat (non-blocking):** the dmarcian macro `_spfm.authentic-materials.com` flattens to `v=spf1 include:_spf.google.com ~all` — Google Workspace IPs only, no Postmark IPs explicit in the chain. Despite that, **mail still delivers DMARC-aligned** because relaxed-alignment DMARC (`adkim=r aspf=r`) requires *either* SPF or DKIM aligned, not both, and DKIM is fully aligned (signing key under `authentic-materials.com`, From-header same registered domain). Belt-and-suspenders fix if desired: add `include:spf.mtasv.net` to the dmarcian flattener config so SPF authorizes Postmark too. Not blocking the S23 emails or any other Postmark traffic.

**Net:** S22.5 + S23 emails (and existing Phase 7E transactional traffic, the Yoti seller-verification emails this session ships, and the upcoming S23.5 waitlist welcome) all deliver authenticated. No spam-folder risk from auth failures.

## Manual E2E verification (deferred to staging push)

Run after Boss pushes the migration + redeploys backend:

1. Trigger Yoti sandbox session → approve → confirm:
   - Postmark Activity dashboard shows `Your seller verification is approved` send to `test@authentic-materials.com`.
   - Inbox arrival expected (DKIM aligns, DMARC passes).
   - In-app notification row inserted (`notifications` table).
2. Trigger Yoti sandbox session → reject (sandbox supports force-failure modes) → confirm REJECTED email arrives with the rejection reason inline.
3. Verify users with the new pref columns set to `false` do NOT receive the corresponding email (insert one with `seller_verification_approved = false`, run the flow).

## Deferred / follow-up items

- ✅ **Postmark Sender Signature verification** — already in place (DKIM + Return-Path + SPF all green per Postmark `/domains/5018956`). See corrected section above. Optional belt-and-suspenders: add `include:spf.mtasv.net` to the dmarcian SPF flattener so SPF explicitly authorizes Postmark too.
- 🟡 **Notifications Preferences UI toggles** — Module 16's settings page needs 2 new toggles surfacing the new `seller_verification_*` columns. Logged as a follow-up; out of scope this session.
- 🟡 **Email template branding pass** — All `emailTemplates.ts` templates still hard-code "AuctionX" in the header gradient block (legacy from pre-rebrand). Should be replaced with a `BRAND_LABEL`-style constant. Separate session.
- 🟡 **`vw7zy9mkyg` App Runner redeploy** — triggers automatically once `dev` push lands.

## Notable decisions

- **Single dispatcher (`renderEmail`) instead of per-type controller branches** — Keeps the rich/generic split at one place. Adding a new templated type now requires one switch arm + one PREF_COLUMN_MAP entry + one template export. The 4 existing call-sites (`bidController`, `payoutController`, `verificationController`, `messagingController`) are untouched and continue to use the generic inline body.
- **`username` fetched alongside `email` in `notificationService.send`** — Cost is zero (same `.select` round-trip) and unlocks personalized greetings for all current + future templated types without re-plumbing each call-site.
- **`vi.hoisted` spy** on `notificationService` — mirrors the existing `yotiSdkMock` pattern in the same file. Cleanest way to assert calls without re-enqueueing the supabase chain three more times.
