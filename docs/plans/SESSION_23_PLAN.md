# Session 23 Plan — Postmark: Seller Verification Emails + Sender Signature

**Branch:** `feature/session-23-postmark-verification-emails` (off `dev`)
**Date drafted:** 2026-05-30
**Status:** 📝 Draft — awaiting Boss approval

## Objective

Wire the two outstanding `TODO(S23)` notification call-sites in the Yoti verification webhook handler (`yotiVerificationController.ts:378,381`) so that VERIFIED and REJECTED outcomes deliver real emails — and close the Phase 7E deferred item by DKIM-verifying the Postmark sender signature on `noreply@authentic-materials.com`. Out of scope: any other Postmark or notification work — everything else is already shipped (Phase 7E 2026-05-09 + the 4 already-wired controllers).

## What's already done (do not re-do)

- `backend/src/lib/notifications/emailSender.ts` — real Postmark Node SDK (Phase 7E)
- `backend/src/lib/notifications/notificationService.ts` — preference-aware in-app + email orchestrator
- `backend/src/lib/notifications/emailTemplates.ts` — 10 HTML templates (auction_won, outbid, payment_received, payout_completed, escrow_released, message_received, item_scanned, settlement_cascade, payment_window_expiring, dispute_opened)
- `supabase/functions/_shared/postmark.ts` — Deno REST helper used by settle-auction, release-escrow, check-payment-window
- App Runner staging: `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL=noreply@authentic-materials.com`
- Supabase Auth SMTP wired through Postmark (Phase 7E end-to-end verified 2026-05-09 20:19 UTC)
- Edge function secrets `POSTMARK_SERVER_TOKEN` + `POSTMARK_FROM_EMAIL` set

## Files to create

| File | Purpose |
|---|---|
| `supabase/migrations/20260530000003_notification_prefs_seller_verification.sql` | Add `seller_verification_approved` + `seller_verification_rejected` boolean columns to `notification_preferences` (both `DEFAULT true NOT NULL`) — extension-only, schema-lock compliant |

## Files to modify

| File | Change |
|---|---|
| `backend/src/lib/notifications/emailTemplates.ts` | Add `sellerVerificationApprovedEmail({ username })` + `sellerVerificationRejectedEmail({ username, rejectionReason })` — match existing template style (dark glassmorphic, gradient header, `noreply@authentic-materials.com` footer). |
| `backend/src/lib/notifications/notificationService.ts` | Extend `PREF_COLUMN_MAP` with `SELLER_VERIFICATION_APPROVED` → `seller_verification_approved` and `SELLER_VERIFICATION_REJECTED` → `seller_verification_rejected`. Add a type→template mapping path so the orchestrator picks the right HTML body (currently `send()` builds inline HTML from `payload.body` — add an optional `htmlOverride` field or branch on `type` to call the new templates). |
| `backend/src/controllers/yotiVerificationController.ts` | Replace the two `// TODO(S23)` + `logger.info('postmark_stub_*')` blocks (lines 378–383) with `notificationService.send(supabase, { userId, type: 'SELLER_VERIFICATION_APPROVED', ... })` / `'SELLER_VERIFICATION_REJECTED'`. Fetch `username` from `users` before the call. Keep the same non-fatal contract (`.catch` inside service already enforces this). |
| `backend/src/__tests__/yotiVerification.test.ts` | Add 2 specs to the existing `applyYotiWebhookEnvelope` block: assert `notificationService.send` is called with the right `type` on VERIFIED + REJECTED outcomes. Mock the service to avoid network. |
| `backend/src/types/database.types.ts` | Regenerate after migration (`supabase gen types typescript --project-id pmlofthmobglcfkqjtru`). |

## Database changes

Migration `20260530000003_notification_prefs_seller_verification.sql`:

```sql
-- Add seller_verification notification preferences (S23, Phase 7A close-out).
-- Extension-only: appending optional columns with NOT NULL DEFAULT true; safe
-- under schema-lock rules. Default true so existing users get the emails
-- without an explicit opt-in flip.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS seller_verification_approved boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS seller_verification_rejected boolean NOT NULL DEFAULT true;
```

Apply via `supabase db push --linked` (staging), no data migration needed.

## API endpoints

None — webhook handler already exists; only its notification side-effect changes.

## Frontend components

None for this session.

> **Follow-up (NOT this session):** the existing Notifications Preferences page (Module 16) needs 2 new toggles for the new columns. Tracked separately so this session stays scoped to the email layer.

## Test plan

- `backend/src/__tests__/yotiVerification.test.ts` — add 2 specs:
  - `applyYotiWebhookEnvelope on VERIFIED outcome calls notificationService.send with SELLER_VERIFICATION_APPROVED`
  - `applyYotiWebhookEnvelope on REJECTED outcome calls notificationService.send with SELLER_VERIFICATION_REJECTED + rejectionReason in metadata`
- Mock `notificationService` import via `vi.mock` so no Supabase/Postmark calls fire.
- Existing 26 Yoti specs must remain green.

## Manual verification

1. Yoti sandbox session → approve → confirm Postmark Activity dashboard shows `SELLER_VERIFICATION_APPROVED` email + inbox arrival on `test@authentic-materials.com`.
2. Yoti sandbox session → reject (force failure) → confirm REJECTED email arrives with the rejection reason text.
3. DKIM/SPF check: Postmark Dashboard → Sender Signatures → confirm green checks on `noreply@authentic-materials.com`. If missing, add DNS TXT records via the domain registrar and verify in dashboard.
4. `cd backend && npx tsc --noEmit` → 0 errors.
5. `cd backend && npx vitest run` → all green (52 → 54 expected).

## Dependencies

- S22.5 ✅ shipped (provides the VERIFIED/REJECTED transitions that trigger the send).
- Phase 7E ✅ shipped (provides `notificationService`, `sendEmail`, Postmark client).
- DNS access for `authentic-materials.com` — Boss may need to add DKIM TXT records if the sender signature isn't already verified.

## Estimated effort

~60–90 min for code + tests + migration + types regen. DKIM verification depends on DNS propagation (5–60 min wait, can run in background). Single session.

## Session-end checklist

- [ ] Migration applied on staging via `supabase db push --linked`
- [ ] DB types regenerated, tsc clean
- [ ] All vitest green (existing + 2 new)
- [ ] App Runner staging redeployed (push to `origin/dev` triggers auto-deploy)
- [ ] Sandbox Yoti flow walked end-to-end on staging — both VERIFIED + REJECTED emails delivered
- [ ] Postmark sender signature verified (or follow-up DNS ticket filed)
- [ ] `docs/SESSION_23_VERIFICATION.md` written
- [ ] Lessons / Decisions added to Notion
- [ ] Notifications Preferences UI follow-up logged in Feature Backlog DB
