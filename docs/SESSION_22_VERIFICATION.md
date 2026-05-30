# Session 22 Verification — Yoti Identity Verification (Phase 7A)

**Branch:** `feature/session-22-yoti`
**Brief:** `docs/SESSION_22_BRIEF.md` (v2, 2026-05-29)
**Date:** 2026-05-30
**Status:** Code complete; merge gated on Boss review + manual migration apply on staging.

## What shipped

### Schema (additive only)
- New migration `supabase/migrations/20260530000002_yoti_integration.sql`
  - 3 nullable columns on `public.users`: `yoti_session_id`, `yoti_age_estimate`, `yoti_last_event_at` (+ partial index)
  - New table `public.yoti_sessions` (event/audit log) with RLS owner-only read; service-role-only write
  - `touch_yoti_sessions_updated_at` trigger maintains `updated_at`
  - Indices on `(user_id)` and `(status)` for admin query paths
- `frontend/src/types/database.types.ts` + `backend/src/types/database.types.ts` hand-augmented for the new columns + table block (CLI gen would have required prod-applied migration first; manual edit keeps the branch tree consistent with the migration file).
- **No new enum values.** `verification_status` already had everything the state machine needs.
- Legacy `seller_verification_documents` + `seller_verification_reviews` tables left in place per Schema Extension Rules. Reviews table reused for override audit trail.

### Backend (`backend/src/lib/yoti/` + controllers + routes)
- `YotiClient` interface (`createSession` / `getSession` / `verifyWebhookSignature`)
- `MockYotiClient` — vitest + dev, HMAC-SHA256 sign/verify with `MOCK_WEBHOOK_SECRET`, deterministic session ids
- `LiveYotiClient` — every method throws `NotImplementedError('Yoti live client wired in S22.5')`
- `getYotiClient()` factory keyed on `YOTI_CLIENT_MODE`; `NODE_ENV=test` forces mock; memoised per process
- `isYotiFeatureEnabled()` reader of `process.env.FEATURE_YOTI_ENABLED`
- `yotiVerificationController` — `startYotiSession`, `getMyVerificationStatus`, `applyYotiWebhookEnvelope` (exported for tests), `yotiWebhook`
- `adminYotiVerificationController` — `listVerifications`, `getVerificationDetail`, `overrideVerification`
- Routes
  - `POST /api/v1/verification/start` — auth + 5/min rate-limit per user
  - `GET /api/v1/verification/status` — auth
  - `POST /api/v1/webhooks/yoti` — raw body, HMAC, 60/min per IP. Mounted with `express.raw({type:'application/json'})` BEFORE global `express.json()`
  - `GET /api/v1/admin/verifications` + `GET /:userId` + `POST /:userId/override` — all gated by `review_sellers`
- State machine (brief §5.4) lives in `applyYotiWebhookEnvelope`. Idempotent on `(session_id, event_type)`. Looks up `user_id` from the local `yoti_sessions` row, NEVER from the payload (defence in depth — service client bypasses RLS).
- Postmark calls stubbed with `// TODO(S23): wire postmark.send(...)` as per Boss-locked answer (S23 hasn't merged yet).
- `AppError` codes added: `YOTI_NOT_AVAILABLE`, `YOTI_WEBHOOK_SIGNATURE_INVALID`, `VERIFICATION_ALREADY_VERIFIED`, `YOTI_SESSION_CREATE_FAILED` (used in logger.error path).
- `backend/.env.op` extended with seven `YOTI_*` / `FEATURE_YOTI_ENABLED` / `YOTI_CLIENT_MODE` `op://` references (1Password items don't need to exist for S22 — fallback to mock).

### Frontend (`frontend/src/`)
- `lib/api.ts` — added `api.verification.startVerification` + `api.verification.getStatus` with Yoti types (`YotiStatus`, `YotiStartResult`, `YotiVerificationPurpose`, etc.).
- `lib/featureFlags.ts` — new module with `getFeatureFlags()` + `isYotiEnabledOnClient()` reading `VITE_FEATURE_YOTI_ENABLED`. Backend wins on disagreement (503 + `YOTI_NOT_AVAILABLE`).
- `features/seller-verification/types/sellerVerification.ts` — `VerificationStatus` widened to include `VIDEO_UPLOADED`, `NFC_PROGRAMMED`, `VERIFIED`; new `isSellerVerified()` helper.
- `features/seller-verification/pages/SellerVerificationPage.tsx` — rewritten from doc-upload UI to Yoti hosted redirect. Renders flag-off placeholder when `feature_enabled === false`.
- `features/seller-verification/components/YotiReturnHandler.tsx` — new. Mounted at `/seller/verification/return`. Polls `/verification/status` for ~30s. Honest about race ("we're still waiting" copy after timeout).
- `features/seller-verification/components/VerificationStatusBadge.tsx` — added VERIFIED / VIDEO_UPLOADED / NFC_PROGRAMMED rows; VERIFIED renders emerald like APPROVED.
- `features/seller-verification/components/VerificationBanner.tsx` — copy updated to reference Yoti hosted flow; CTA goes to `/seller/verification`; APPROVED + VERIFIED both render as "no banner".
- `features/seller-verification/components/DocumentUploader.tsx` — **DELETED** (legacy doc-pipeline UI superseded; no remaining import sites at delete time).
- `pages/CreateListing.tsx` — hard publish-gate. Publish button `disabled` with `title="Verify your identity to publish"` + inline `<Link to="/seller/verification">Verify now →</Link>` banner above the form. Save Draft button added — writes the listing as `status='DRAFT'` (no auction row inserted) and navigates to `/my-listings`. Admin/super_admin bypass the gate.
- `App.tsx` — added `/seller/verification/return` (static before parameterized) + `/seller/verification` (canonical) routes; old `/seller-verification` retained as alias. New admin routes `verifications` + `verifications/:userId`.
- `features/admin/api/adminApi.ts` — new `listYotiVerifications` / `getYotiVerificationDetail` / `overrideYotiVerification` + 5 response types.
- `features/admin/pages/AdminVerificationsPage.tsx` — list page with URL-synced filters (status pill bar, debounced search), pagination, row-click navigation.
- `features/admin/pages/AdminVerificationDetailPage.tsx` — detail page with user info, Yoti session history, review history, override action gated by `window.confirm` + `window.prompt` (reason ≥ 10 chars) + `react-hot-toast`.
- `features/admin/AdminLayout.tsx` — "Verifications" nav entry added between "Users" and "Moderation".

### Hard prohibitions honoured
- ✅ No files under `frontend/src/features/unmentionables/`
- ✅ No live Yoti calls (LiveYotiClient throws everywhere)
- ✅ No new enum values
- ✅ No removal of `seller_verification_documents` / `seller_verification_reviews`
- ✅ No modification of `functions/src/v1/schemas/domain/` or `functions/src/v1/services/auctions/`
- ✅ No `--no-verify` on commits; no push to origin/dev; no local merge

## Acceptance gate evidence (§7)

| Gate | Result |
|------|--------|
| `cd frontend && npx tsc --noEmit` | ✅ 0 errors |
| `cd backend && npx tsc --noEmit` | ✅ 0 errors |
| `cd backend && npx vitest run` | ✅ 6 files, 45 passed + 21 skipped (integration tests with no live server). 19 new specs in `yotiVerification.test.ts` all green. |
| `grep -r "unmentionables" frontend/src/features/` | ✅ no matches (no new Unmentionables UI added) |
| New `"AuctionX"` / `"Unmentionables"` literals outside `branding.ts` | ✅ none introduced |
| `DocumentUploader.tsx` + import sites removed | ✅ file deleted via `git rm`; no remaining importers |
| 1Password references only — no hardcoded keys | ✅ `grep YOTI_ backend/src` — all `process.env` reads / comments / test fixtures |
| Rate limits per Security Checklist | ✅ /start 5/min/user; /webhooks/yoti 60/min/IP; admin destructive inherits adminRateLimit |
| `FEATURE_YOTI_ENABLED=false` → 503 + `YOTI_NOT_AVAILABLE` from /start | ✅ covered by spec `returns 503 + YOTI_NOT_AVAILABLE when FEATURE_YOTI_ENABLED is false` |
| LiveYotiClient guard | ✅ 3 specs cover createSession / getSession / verifyWebhookSignature all throw NotImplementedError |
| HMAC failure → 401 | ✅ spec `returns 401 + YOTI_WEBHOOK_SIGNATURE_INVALID on bad signature` + spec `accepts correctly-signed payload` |
| Idempotency | ✅ spec `no-ops when the same event_type is already the most-recent last_event_type` |
| State machine — VERIFIED + age_verified | ✅ spec `transitions PENDING → VERIFIED and sets age_verified when age_estimate >= 18` + `does NOT set age_verified when age_estimate < threshold` |
| State machine — REJECTED + rejection_reason | ✅ spec `transitions PENDING → REJECTED and captures rejection_reason` |
| `startYotiSession` rejects already-VERIFIED users | ✅ spec `rejects when user is already VERIFIED with VERIFICATION_ALREADY_VERIFIED` |
| Admin override writes review row + audit | ✅ spec `writes seller_verification_reviews row + flips user status` (audit middleware exercised in route wiring; auditLog middleware runs on /override route) |

## What I did NOT verify manually (acceptance gates deferred to S22.5 + Boss)

| Item | Status | Why |
|------|--------|-----|
| Migration applied to staging | ❌ Deferred | The S22 executor environment has no `op://` resolution + no `SUPABASE_ACCESS_TOKEN`. Boss runs `supabase db push` against `pmlofthmobglcfkqjtru` from the `cc-auctionx-op` shell. Migration file is idempotent (`IF NOT EXISTS` on every DDL + policy guard). |
| Bundle deploy to staging (`aws s3 sync` + CloudFront invalidate) | ❌ Deferred | Same SSH-push gate carried from S19/S20/S21 — Boss handles when the branch merges into `dev`. |
| Sandbox E2E screenshots of Yoti hosted page | ❌ Deferred to S22.5 | LiveYotiClient is a stub; sandbox creds don't exist in `op://AM_Development/Yoti/*` yet. |
| App Runner env-var rotation | ❌ Deferred — Boss action item | App Runner env vars are static literals (Lesson). At S22.5 Boss copies the resolved Yoti values into App Runner config OR sets them via `aws apprunner update-service`. |

## S22.5 action items (carry-forward)

When Yoti business-account verification clears and sandbox creds populate:
1. **Drop `NotImplementedError`** from `backend/src/lib/yoti/LiveYotiClient.ts`. Wire `@getyoti/sdk-node` (or current SDK):
   - `import { Client } from '@getyoti/sdk-node'`
   - construct from `process.env.YOTI_SDK_ID` + `process.env.YOTI_PEM_KEY`
   - map `createSession` / `getSession` to SDK calls
   - implement `verifyWebhookSignature` against `process.env.YOTI_WEBHOOK_SECRET` (HMAC-SHA256 over raw body; confirm header name against current Yoti docs — code currently reads `x-yoti-hmac` with `x-yoti-signature` fallback)
2. **Populate Yoti creds in 1Password**: `op://AM_Development/Yoti/sdk-id`, `pem-key`, `webhook-secret`, `base-url`, `return-url`.
3. **Copy resolved values into App Runner env** (static literal lesson). Same applies to `FEATURE_YOTI_ENABLED=true` and `YOTI_CLIENT_MODE=live` for staging.
4. **Capture sandbox E2E screenshots**: seller-verification → Yoti redirect → return handler → status flip → admin verifications list shows the new row → admin override → audit log entry visible.
5. **Register the webhook URL** in Yoti dashboard pointing at `https://vw7zy9mkyg.us-east-2.awsapprunner.com/api/v1/webhooks/yoti`.
6. **Run the `notion-librarian` skill** after any DB writes to keep the SSOT clean.

## Other follow-ups (non-blocking)

- **S23 (Postmark)**: replace the two `// TODO(S23): wire postmark.send(...)` stubs in `applyYotiWebhookEnvelope` with real mailer calls (`seller_verification_approved` / `seller_verification_rejected`).
- **Frontend env**: when staging flips on, set `VITE_FEATURE_YOTI_ENABLED=true` in the frontend's App Runner env or .env.op so the placeholder card stops rendering.
- **Migration of existing PENDING doc-pipeline users**: manual Boss step — decide whether to leave them as PENDING (and have them re-verify via Yoti at next login) or batch-set to NONE so they re-enter the flow.
- **`getYotiClient()` fallback log**: the current factory logs `yoti_client_select { mode: ... }` at first call. If 1Password fails to resolve at runtime AND `YOTI_CLIENT_MODE=live`, LiveYotiClient throws on every call — that surfaces in `yoti_create_session_failed` log lines. We do NOT silently fall back to mock in production. Documented intentionally — confirm at S22.5 review.

## Commit log

(See git log on `feature/session-22-yoti` — 10-commit split per brief §7 execution plan.)
