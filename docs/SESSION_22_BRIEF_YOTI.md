# Session 22 Brief — Yoti Identity Verification (Phase 7A)

**Status:** Draft v1.0 — pending Boss approval before executor kickoff
**Drafted:** 2026-05-29
**Source:** Planner subagent output from S21 close-out session
**Branched from:** `dev` tip `9cfae35` (post-S21 close-out)

---

## Goal
Replace the manual document-upload seller-verification pipeline with Yoti hosted-session verification, and wire the same Yoti identity into the Unmentionables age gate so a single integration covers seller KYC + NSFW age check.

## Why now
Wave 1 / W1 of the Riley 3.0 21-session pre-launch plan. Yoti is the locked Phase 7A foundation that unblocks: (a) Stripe Connect Custom migration spike, (b) creator verification pipeline (S31 leans on the same identity record), (c) Unmentionables soft launch (cannot ship NSFW browse without an age wall), and (d) pre-launch legal checklist items in Phase 9F. Today's tip of `dev` is `9cfae35`; gated S19/S20/S21 staging deploys are unrelated to S22's code path.

## Scope (in)
- Yoti Node SDK install (backend) + Yoti web SDK / hosted-redirect (frontend).
- `users` columns: `yoti_session_id`, `yoti_age_estimate`, `yoti_verified_at`.
- New endpoint `POST /api/v1/verification/start` returning Yoti session URL.
- New endpoint `POST /api/v1/webhooks/yoti` (signature-verified, idempotent).
- Status mapping: Yoti `COMPLETED` → existing `verification_status` enum (`PENDING` → `APPROVED` / `REJECTED`). Reuses existing enum values; no new values added.
- Admin review queue UI: extend `/admin/seller-verification` with a Yoti session tab/column. Do NOT build a parallel `/admin/verifications` page (existing admin verification UI is already deployed and the locked decision page allows folding into it).
- Seller onboarding gate: replace `DocumentUploader` flow on `/seller/verification` with Yoti redirect button.
- Unmentionables age-gate banner reading `users.age_verified`.
- Postmark templates for `VERIFICATION_APPROVED` / `VERIFICATION_REJECTED`.
- vitest: happy path, signature-reject, idempotency replay, status transition.
- Existing manual pipeline: leave routes and tables in place as fallback for admin override; mark `DocumentUploader` deprecated in code but do not delete (keeps in-flight applications viable through cutover).

## Scope (out — deferred)
- Stripe Connect Express → Custom migration (separate spike, blocks S25 disputes era).
- Creator verification badge / `creator_profiles` table — that's S31.
- Yoti reusable digital ID / one-tap re-verification — post-launch (10A-adjacent).
- Account deletion of Yoti session records on user delete — S32/33 (Privacy).
- Webhook → realtime push to admin queue — S26–28 Admin Console era.
- Mobile (Flutter) Yoti SDK — defer to S35–37.

## Locked decisions that constrain this work

- **Identity verification provider: Yoti** (page `3673baf6-9664-8122-ad16-f130eccb9b9b`, Locked 2026-05-16, Review Priority = Every Session). Rationale verbatim:

  > "Yoti's age-estimation feature directly serves the **Unmentionables (NSFW)** age-gate requirement — single integration covers ID verification AND age verification. Reusable Yoti-app digital ID matches the brand's privacy-forward positioning. GDPR / privacy posture is strongest in the industry. UK regulatory familiarity with adult-content platforms (already deployed on age-gated UK platforms via Online Safety Act compliance). Avoids the duplicate-source-of-truth issue of running both Stripe Identity (auto-triggered via Connect) and a manual document pipeline — Yoti becomes the single canonical identity record."

  Key constraints: `users.seller_verification_status` is derived from Yoti webhook events (not direct admin writes); age-gate UX on Unmentionables must call Yoti age-estimation; Authentic Materials (SFW) does NOT need an age gate; new 1Password secrets at `op://AM_Development/Yoti/sdk-id` + `op://AM_Development/Yoti/pem-key`.

- **Age Verification: Three-tier** (page `3273baf6-9664-8136-9494-dd70012e9941`, Locked, Module Start). Frame age gate as Collector Verification / VIP access, not compliance friction — applies to copy on the Unmentionables banner.

## Lessons Learned — Every Session entries that apply

- **Seller verification fields already exist on users table** (`32a3baf6-9664-819a-8607-c19a28a402eb`) — confirmed: `seller_verification_status/_submitted_at/_reviewed_at/_rejection_reason` already on `users`. Do NOT add duplicate columns; only add Yoti-specific ones.
- **Stripe webhook in Deno: use `constructEventAsync`** (`3193baf6-9664-81cb-9428-c5a89c2d1661`) — Yoti webhook ships on Express (Node), not a Deno Edge Function, but the async-signature pattern applies if we ever port it.
- **Edge function webhook deploy needs --no-verify-jwt** (`3193baf6-9664-81ce-a487-cc036854696b`) — not applicable if webhook lives in Express; flag if anyone proposes moving it.
- **Enum + RLS same transaction: cast to ::text** (`3193baf6-9664-8165-8217-c908ee25120f`) — irrelevant only if we add zero new enum values. Plan adds none. Verify.
- **Migration idempotency: wrap all DDL** (`3193baf6-9664-81e7-8050-dbe35b111240`) — `ALTER TABLE … ADD COLUMN IF NOT EXISTS` required.
- **Service client bypasses RLS — filter manually** (`3193baf6-9664-816f-b928-fada8efaa731`) — webhook handler will use service role; must filter by Yoti `session_id → user_id` and add the user filter explicitly.
- **AWS App Runner env vars are static literals** (`36f3baf6-9664-81c3-aed7-f1246f5d7fe7`) — new Yoti secrets cannot be `op://`-referenced in App Runner config; Boss must paste literals.
- **Verify enum values against Route Registry & Database Reference** (`3193baf6-9664-812d-b354-c0722f3a2c4a`) — `verification_status` reuse only.

## Existing state (codebase grep findings)

**Not a clean slate.** Substantial Phase 7A manual-pipeline code is already deployed:

- `backend/src/controllers/sellerVerificationController.ts` (323 lines)
- `backend/src/routes/sellerVerification.ts` mounted at `/api/v1/seller-verification` (GET status, POST upload-url, POST documents, POST submit, DELETE)
- `backend/src/routes/admin/sellerVerification.ts` (353 lines) mounted at `/api/v1/admin/seller-verification` (queue / detail / approve / reject / revoke)
- `backend/src/routes/webhooks.ts:148-151` already contains a `POST /api/v1/webhooks/seller-verification` 501 stub — perfect anchor point to replace with the Yoti receiver.
- Migration `20260320000001_seller_verification_documents.sql` created `seller_verification_documents` + `seller_verification_reviews` tables with full RLS.
- `users` table already has: `seller_verification_status` (enum `verification_status`), `seller_verification_submitted_at/_reviewed_at/_rejection_reason`, `age_verification_provider` (text), `age_verified` (bool), `age_verified_at` (timestamptz). Also `listings.requires_age_verification` (bool).
- Frontend: `frontend/src/features/seller-verification/api/sellerVerificationApi.ts` exists (referenced in S21 handoff deferred list).
- Frontend: `frontend/src/pages/CreateListing.tsx` already references age-verification concepts.
- `verification_status` enum already contains `NONE / PENDING / APPROVED / REJECTED` plus NFC-specific values (`VIDEO_UPLOADED / NFC_PROGRAMMED / VERIFIED / FLAGGED / REVOKED`) — no schema changes required for status flow.

**Implication:** S22 is a swap, not a greenfield build. Pre-existing `age_verified` column means age-gate already has its read field; S22 just wires the writer.

## Proposed implementation phases (executor will run these in order)

### Phase 1: Schema + Migration
- File: `supabase/migrations/20260530000001_yoti_integration.sql`
- `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS yoti_session_id TEXT, ADD COLUMN IF NOT EXISTS yoti_age_estimate INTEGER, ADD COLUMN IF NOT EXISTS yoti_verified_at TIMESTAMPTZ;`
- Partial unique index on `yoti_session_id WHERE yoti_session_id IS NOT NULL` (idempotency for webhook replay).
- Schema Extension Rules check: only `ADD COLUMN`, all nullable, no enum changes, no field removals. ✅
- `supabase db push` against staging.
- Regenerate types into both `frontend/src/types/database.types.ts` and `backend/src/types/database.types.ts`. Strip `<claude-code-hint>` plugin tag per the lesson learned in v28.0.

### Phase 2: Backend — Yoti SDK integration
- Install: `cd backend && npm i yoti --save`.
- New: `backend/src/lib/yoti.ts` — instantiate Yoti client from `YOTI_SDK_ID` + `YOTI_PEM_KEY` (Base64-decoded). Singleton.
- New: `backend/src/controllers/yotiVerificationController.ts` with `startSession` handler. Returns `{ session_url, session_id, expires_at }`. Persists `yoti_session_id` to `users` and bumps `seller_verification_status` → `PENDING`.
- New: `backend/src/routes/verification.ts` (Note: project lesson #5 — static before parameterized; mount before existing `/verifications/*` NFC routes). Mount at `/api/v1/verification` (singular). Add `POST /start`, `GET /status` (proxies to existing seller-verification status).
- Edit `backend/src/index.ts` to mount new router before NFC `/verifications`.
- Env: backend reads `YOTI_SDK_ID`, `YOTI_PEM_KEY`, `YOTI_WEBHOOK_SECRET` from `process.env`. Add to `backend/.env.op` with `op://AM_Development/Yoti/*`. Per App Runner static-literal lesson, Boss must hand-paste these into App Runner service config.

### Phase 3: Backend — Webhook
- Replace stub at `backend/src/routes/webhooks.ts:151` with full Yoti receiver.
- New: `backend/src/controllers/yotiWebhookController.ts`. Path `POST /api/v1/webhooks/yoti` (rename existing `/seller-verification` route).
- Raw-body parsing (like `webhooks/stripe-account`). Verify Yoti webhook signature via shared secret + timing-safe compare.
- Idempotency: lookup by `yoti_session_id`; if `yoti_verified_at IS NOT NULL` → return 200 no-op (replay safe).
- On `session.completed` SUCCESS: set `seller_verification_status='APPROVED'`, `seller_verification_reviewed_at=now()`, `yoti_verified_at=now()`, `yoti_age_estimate=<value>`, derive `age_verified = (yoti_age_estimate >= 18)`, `age_verification_provider='yoti'`, `age_verified_at=now()`. Service-role client; explicit user_id filter per lesson.
- On `session.failed` / `session.completed` FAIL: set `REJECTED` + `seller_verification_rejection_reason`.
- Audit log via existing `auditLog` middleware pattern (admin-actor=null, source='yoti_webhook').
- Postmark template trigger via existing email layer (`process-payment` Edge Function pattern is the reference).

### Phase 4: Admin review queue UI
- Extend existing `frontend/src/pages/admin/AdminSellerVerificationPage.tsx` (do NOT create a parallel page).
- New columns: Yoti session ID (linked to Yoti dashboard), Yoti age estimate, Yoti verified at.
- New filter pill: "Yoti session present / absent" so admin can triage legacy document-upload cases.
- Override action endpoints (`approve`/`reject`/`revoke`) keep working — used for manual override when Yoti flags or fails.
- Permission check: existing `review_sellers` admin permission (already in DB per `20260320000002_admin_permission_review_sellers.sql`). No new permission.

### Phase 5: Seller onboarding gate
- Edit `frontend/src/features/seller-verification/pages/SellerVerificationPage.tsx` (or equivalent — verify path during executor pre-flight).
- Replace `DocumentUploader` primary CTA with "Verify with Yoti" button → calls `POST /api/v1/verification/start` → window.location.href = session_url.
- Keep document-upload fallback behind a "Use legacy upload" link for in-flight cases. Toast-warn when used.
- Status badge component reads `seller_verification_status` and shows Yoti session ID + age estimate when present.
- Listing-create gate: existing `requires_age_verification` flow on `CreateListing.tsx` already checks `users.age_verified`. No frontend change needed beyond confirming the flag flips correctly post-webhook.

### Phase 6: Unmentionables age gate
- New: `frontend/src/components/AgeGateBanner.tsx` — full-page modal/overlay on first load when `BRAND_LABEL === 'Unmentionables'` AND `users.age_verified === false`.
- Copy framing per locked Age-Verification decision: "Collector Verification" / VIP access, NOT compliance language.
- CTA: same "Verify with Yoti" button as seller onboarding (shared component). Different return URL.
- Mount in `frontend/src/App.tsx` under the Unmentionables sub-brand context only.
- Session cookie: persist age-gate-passed for unauthenticated visitors (Tier 1 of three-tier decision). Tier 2 (Yoti at purchase) and Tier 3 (full creator verification) implicitly covered once `age_verified=true` on the authenticated user.

### Phase 7: Tests + verification dossier
- `backend/src/controllers/__tests__/yotiWebhookController.test.ts`: signature-valid happy path; signature-invalid 400; replay idempotency; SUCCESS → APPROVED + age fields; FAIL → REJECTED.
- `backend/src/controllers/__tests__/yotiVerificationController.test.ts`: start session returns URL; persists session_id; sets status PENDING.
- `frontend/src/components/__tests__/AgeGateBanner.test.tsx`: renders for unverified Unmentionables user; hidden for verified; hidden on Authentic Materials.
- Manual E2E checklist in `docs/SESSION_22_VERIFICATION.md`: Yoti sandbox session start → complete in Yoti sandbox UI → webhook fires → DB row updates → admin queue shows row → Postmark email delivered.
- `cd backend && npx vitest run` and `cd frontend && npx vitest run` both green.

## Acceptance criteria (must pass before merge)

- [ ] Yoti SDK installed (`backend/node_modules/yoti` present; lockfile updated). Frontend integration is redirect-based — no frontend SDK install needed.
- [ ] Migration `20260530000001_yoti_integration.sql` applied to staging Supabase; types regenerated in both `frontend/src/types/database.types.ts` + `backend/src/types/database.types.ts`; `<claude-code-hint>` plugin tag stripped.
- [ ] No new enum values added; `verification_status` reused as-is.
- [ ] `POST /api/v1/verification/start` returns 200 with `session_url` for an authenticated seller; sets `users.seller_verification_status='PENDING'`.
- [ ] `POST /api/v1/webhooks/yoti` raw-body signature verification; idempotent on replay; updates `users.seller_verification_status`, `age_verified`, `yoti_*` fields.
- [ ] Admin tab on `/admin/seller-verification` surfaces Yoti session metadata + override actions intact.
- [ ] `/seller/verification` page renders "Verify with Yoti" primary CTA with legacy upload as secondary.
- [ ] `AgeGateBanner` blocks unverified users on Unmentionables sub-brand routes only.
- [ ] Postmark `VERIFICATION_APPROVED` + `VERIFICATION_REJECTED` templates wired and triggered.
- [ ] `cd frontend && npx tsc --noEmit` → 0 errors. `cd backend && npx tsc --noEmit` → 0 errors.
- [ ] `cd backend && npx vitest run` → all green. `cd frontend && npx vitest run` → all green.
- [ ] `docs/SESSION_22_VERIFICATION.md` written with sandbox E2E walkthrough.

## Open questions for Boss before kickoff

1. **Yoti account state.** Is the Yoti business account created and a sandbox SDK pair available? If not, Yoti onboarding is multi-day and S22 cannot start until at minimum a sandbox `sdk-id` + `pem-key` are populated.
2. **Webhook URL registration.** App Runner staging URL `https://vw7zy9mkyg.us-east-2.awsapprunner.com/api/v1/webhooks/yoti` — does Boss register this in Yoti dashboard, or executor via Yoti API?
3. **Sandbox vs. prod toggle.** Single env var `YOTI_ENV=sandbox|prod` driven by `op://` field, or separate SDK ID per environment? Recommend the latter to match Stripe pattern.
4. **Cutover plan for in-flight manual document submissions.** Current queue may have pending cases. Drain via legacy flow then deprecate, or force-redirect everyone to Yoti? Recommend drain (1-week grace).
5. **Listing-creation age-gate.** Today's `listings.requires_age_verification` flow on `CreateListing.tsx` — keep buyer-side check on view, or also pre-gate seller from listing if `age_verified=false`? Locked decision is silent.
6. **Unmentionables brand routing.** How does the executor detect Unmentionables vs Authentic Materials at runtime? Confirm: subdomain, `BRAND_LABEL` constant, or path-based. Affects where `AgeGateBanner` mounts.
7. **Yoti reusable digital ID (one-tap).** Yes/no at MVP? Decision implies "yes" eventually; recommend defer to post-launch unless cheap.

## Estimated complexity
~1,200–1,500 LOC across ~14 files (3 backend new, 4 backend edits, 4 frontend new, 3 frontend edits). Test surface: 5 backend specs + 2 frontend specs. Mid-weight session — should fit one executor pass if Yoti sandbox creds are pre-populated; two passes if creds need provisioning.

## Branch + commit naming
- Branch: `feature/session-22-yoti` (from `dev` tip `9cfae35`)
- Commits: `feat(session-22): yoti webhook handler + verification start endpoint`, `feat(session-22): replace document upload with yoti redirect`, `feat(session-22): unmentionables age gate banner`, etc.

## Pre-flight checks the executor must run before any code

- [ ] `cd unmentionables/Unmen` (project root)
- [ ] `git checkout -b feature/session-22-yoti dev` (from local `dev` tip `9cfae35`)
- [ ] `git status` → clean
- [ ] `cd frontend && npx tsc --noEmit` → 0 errors
- [ ] `cd ../backend && npx tsc --noEmit` → 0 errors
- [ ] Confirm `op://AM_Development/Yoti/sdk-id` and `op://AM_Development/Yoti/pem-key` resolve (don't print values; just `op read --no-newline … | wc -c` to confirm non-zero).
- [ ] Fetch Route Registry & Database Reference page; confirm `verification_status` enum values unchanged.
- [ ] Re-confirm existing `users.age_verified` / `age_verification_provider` / `age_verified_at` columns are present.

## Out-of-band Boss action items required before executor kicks off

1. Yoti business account + sandbox SDK ID + PEM key provisioned and pasted into 1Password (`op://AM_Development/Yoti/{sdk-id,pem-key,webhook-secret}`).
2. Decide on sandbox vs. prod env strategy (open question #3).
3. Register webhook URL in Yoti dashboard pointing at App Runner staging.
4. Provision Postmark templates `VERIFICATION_APPROVED` / `VERIFICATION_REJECTED` (or confirm existing seller-verification templates are reusable).
5. **Still-open S21 SSH gate**: `git push origin dev` is blocked. S22 development can proceed locally on `feature/session-22-yoti` without it, but staging deployment of S22 will stack behind S19/S20/S21 deploys. Recommend Boss resolve SSH before S22 close-out.
