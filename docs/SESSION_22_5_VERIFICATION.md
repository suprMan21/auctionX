# Session 22.5 Verification — Yoti Live Wiring + Sandbox E2E

**Branch:** `dev` (originally `feature/session-22.5-yoti-live`, merged + pushed)
**Brief:** Notion S22.5 brief (https://www.notion.so/3703baf69664812f9983d587cf1e0c7b)
**Date:** 2026-05-30
**Status:** ✅ Shipped — sandbox E2E green; flag-on staging exercised; webhook delivered.

**Commits on dev** (in order applied to staging):

| SHA | Description |
|---|---|
| `3e394b0` | feat — wire LiveYotiClient against Yoti IDV SDK (initial drop of NotImplementedError throws) |
| `779f031` | fix — decode escaped-newline PEM (App Runner single-line constraint) |
| `afd338c` | merge — feature/session-22.5-yoti-live → dev |
| `2229482` | feat — switch Yoti webhook protocol HMAC → Bearer + topic-bridge |
| `38bb37a` | fix — set manualCheck=FALLBACK on doc-authenticity + face-match builders |
| `9bf6a6d` | chore — pre-export staging AWS identifiers on session sign-in (op-claude-session.sh) |
| `00bba47` | fix — pass YOTI_BASE_URL as apiUrl override to IDVClient (the actual `APP_NOT_FOUND` fix) |

## What shipped (code)

### Backend
- `backend/src/lib/yoti/LiveYotiClient.ts` — IDVClient instantiated with `{ apiUrl }` from `YOTI_BASE_URL`. SessionSpec built with three checks (doc-authenticity + face-match — both `withManualCheckFallback()` — and static-liveness) plus `withNotifications(NotificationConfigBuilder.withEndpoint(YOTI_WEBHOOK_URL).withAuthTypeBearer().withAuthToken(YOTI_WEBHOOK_SECRET).forSessionCompletion().build())`. getSession reads `getState()` + walks `getChecks()` to derive outcome/rejectionReason. `decodePem` normalizes `\n`-escaped App Runner values back to real-newline PEM.
- `backend/src/lib/yoti/YotiClient.ts` — interface method renamed `verifyWebhookSignature` → `verifyWebhookAuth`. Both Live + Mock implementations switched from HMAC to constant-time Bearer-token compare.
- `backend/src/controllers/yotiVerificationController.ts` `yotiWebhook` — reads `Authorization: Bearer …`, parses `{ session_id, topic }`, on `SESSION_COMPLETION` calls `yoti.getSession()` to synthesize the envelope (outcome/age_estimate/rejection_reason) into the existing state machine.
- `backend/.env.op` — 8 `YOTI_*` references; sandbox creds consolidated into the single `yoti_NewSandbox` 1Password item.
- `backend/package.json` — `yoti@4.13.2` added.

### Frontend
- `frontend/.env.production` — `VITE_FEATURE_YOTI_ENABLED=true` (gitignored, lives locally on dev machine).

### Infrastructure / tooling
- `scripts/op-claude-session.sh` — pre-exports `STAGING_ARN`, `STAGING_CF_DISTRO_ID`, `STAGING_FE_BUCKET`, `STAGING_BACKEND_URL`, `STAGING_FRONTEND_URL` so new shells don't have to re-look-them-up.
- App Runner staging — 29 runtime env vars total (21 existing + 8 new Yoti/feature flags). `FEATURE_YOTI_ENABLED=true`, `YOTI_CLIENT_MODE=live`, `YOTI_BASE_URL=https://api.yoti.com/sandbox/idverify/v1`.
- IAM — `auctionx-deploy` user granted `CloudWatchLogsRead-StagingBackend` policy (logs:GetLogEvents, logs:DescribeLogStreams, logs:FilterLogEvents) so we can read App Runner logs without console fallback.

## Acceptance gates

| Gate | Result |
|---|---|
| `cd backend && npx tsc --noEmit` | ✅ 0 errors |
| `cd frontend && npx tsc --noEmit` | ✅ 0 errors |
| `cd backend && npx vitest run` | ✅ 52 passed / 21 skipped — 26 Yoti specs incl. Bearer auth + topic-bridge + manualCheck path |
| App Runner deploy status | ✅ RUNNING with the latest commit `00bba47` |
| `/api/v1/health` | ✅ `{"status":"healthy"}` |
| Sandbox E2E — Start Verification → Yoti iframe redirect | ✅ — backend signs request with `c5e106f8…` sandbox SDK ID against `https://api.yoti.com/sandbox/idverify/v1`, Yoti returns iframe URL |
| Webhook delivered to `/api/v1/webhooks/yoti` with Bearer auth | ✅ |
| FE bundle rebuilt + S3-synced + CloudFront invalidated | ✅ (distro `E3JOPXHI8DB4BE`) |
| NSFW age-gate routing decision recorded | ✅ Decisions DB Locked: https://www.notion.so/3703baf696648184a84fdee4bea891fd |

## The 5 surprises that bit us mid-session

(Recorded in detail in the [Lessons Learned DB](https://www.notion.so/01abaaccd8274389a9fd4dabe9bba82a) — search "S22.5". Summary:)

1. **Yoti SDK `IDVClient` defaults to the production URL** — `new IDVClient(sdkId, pem)` ignores `YOTI_BASE_URL` env unless you pass `{ apiUrl }` as the third arg. Setting the env without wiring it through is a no-op.
2. **Yoti sandbox path is `/sandbox/idverify/v1`, not `/idverify/v1`** — same host, different path. Sandbox SDK IDs aren't registered at the production endpoint and return `APP_NOT_FOUND`.
3. **Every Yoti IDV check builder requires `withManualCheck*`** — `RequestedDocumentAuthenticityCheckBuilder().build()` produces a spec with `manualCheck = null` which the Yoti API rejects with `manualCheck cannot be null or empty`.
4. **Yoti IDV webhooks: per-session NotificationConfig + Bearer auth** — not dashboard-registered, not HMAC. S22 wired all three assumptions wrong. The payload Yoti delivers is `{ session_id, topic }` — backend has to call `getSession()` to read the actual outcome.
5. **App Runner env regex rejects `\r`, not just `\n`** — and `wc -l` won't catch CR-only contamination. The error message misleadingly cites the first env-var name in the map (e.g. STRIPE_SECRET_KEY) rather than the actual offender. `tr -d '\r'` before `awk` is mandatory.

## Prod-cutover checklist (deferred to the prod-push session)

When AM flips to prod, the prod App Runner service `auctionX_backend_prod` (TBC name) needs:

- [ ] Populate `op://AM_Development/Yoti_prod/*` items (or equivalent) with production SDK ID + PEM + URL.
- [ ] Production `YOTI_BASE_URL` = `https://api.yoti.com/idverify/v1` (no `/sandbox/`).
- [ ] Generate fresh `YOTI_WEBHOOK_SECRET` for prod — do NOT reuse sandbox secret.
- [ ] Rotate the same 8 Yoti env vars on prod App Runner via the procedure in `reference_yoti_op_paths.md`.
- [ ] Re-run the E2E walkthrough against the prod URL.

This is the sandbox-in-staging pattern (Lesson 2026-05-30) — applies to every third-party service: Stripe, Postmark, NOWPayments, CCBill, Signature, PaymentCloud, NFC vendor.
