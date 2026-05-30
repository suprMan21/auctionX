# Session 22 Brief — Yoti Identity Verification (Phase 7A)

**Status:** Revised draft for Boss approval (v2)
**Revisions:**
- **(A)** Yoti is mocked behind a `YotiClient` interface + `FEATURE_YOTI_ENABLED` flag — live wiring deferred to **S22.5** because the Yoti business-account verification is still pending and no sandbox creds exist yet in `op://AM_Development/Yoti/*`.
- **(B)** Unmentionables age-gate UI deferred entirely — Unmentionables ships as a fully separate frontend at its own domain (Locked decision 2026-05-29). Backend Yoti facts (including `age_verified`) still ship in S22; the UI that renders them lives in a future Unmentionables-frontend session.
- **(C)** Boss-locked answers applied — age threshold **18**, hard publish-gate with draft save allowed, Postmark stub if S23 hasn't merged, `review_sellers` admin permission, App Runner env rotation stays a Boss action item.

**Authored:** 2026-05-29 by planner subagent (revised same day after Boss review)
**Target branch:** `feature/session-22-yoti`
**Worktree:** isolation per orchestrator plan
**Reference:** Roadmap v3 §Phase 7A; Feature Backlog `S22 — Yoti Identity Verification`; Decisions DB `Identity verification provider: Yoti` (Locked, 2026-05-16); Decisions DB `Unmentionables ships as a fully separate frontend at its own domain` (Locked, 2026-05-29)

---

## 1. Session Goal

Integrate Yoti as the canonical identity-verification provider for both brands. Replace the interim document-upload pipeline (`/seller/verification` + `DocumentUploader` + `seller_verification_documents` table) with a Yoti hosted-session redirect flow. Wire two product surfaces from a single integration:

1. **Seller KYC** — applies to both brands. Required before a user can publish their first listing (gate enforced at listing-create, not at signup).
2. **Unmentionables age gate** — required to render any route under the Unmentionables subdomain/path. Powered by Yoti age-estimation; first-visit cookie-bypass deferred to S33 per the three-tier decision (`Age Verification: Three-tier`).

Done = a user can complete a Yoti hosted session from the seller-verification page, the webhook updates `users.seller_verification_status` and (optionally) `users.age_verified`, admin can review/override in `/admin/verifications`, and the Unmentionables age gate hard-blocks unverified users.

Out of session scope: Stripe Connect Custom migration (separate spike), the DOB session-cookie tier of the three-tier age model (S33), creator verification (S31), full PIPEDA flows (S32–33).

---

## 2. Brand Scope (READ FIRST)

This session touches **both** brands but in different ways. Get this wrong and you violate two Locked decisions:

| Brand | Yoti use | UI surface | Why |
|-------|----------|------------|-----|
| **Authentic Materials (SFW)** | Seller KYC only — no age gate | `/seller/verification` page (existing route, contents replaced) | SFW; no NSFW content rendered; no age requirement |
| **Unmentionables (NSFW)** | Seller KYC **and** age verification (estimation) — **backend facts only** | **No UI in this session** | Backend writes `users.age_verified` + `yoti_sessions.purpose='age_gate'`. The UI that renders the age gate lives in the separate Unmentionables frontend (Locked decision 2026-05-29) and ships in a future session. |

**Hard rules (from Decisions DB, Status = Locked, Review Priority = Every Session):**
- Decision `Identity verification provider: Yoti` — any age-gate UX on the Unmentionables stream MUST hit Yoti age-estimation, not roll its own. AM does not need an age gate.
- Decision `Unmentionables ships as a fully separate frontend at its own domain` (Locked, 2026-05-29) — no Unmentionables UI files land in `frontend/src/` during S22. Backend facts only. The Unmentionables frontend gets scaffolded in a future session, then consumes these facts.
- Decision `Unmentionables brand is NEVER referenced in public-facing marketing or landing pages` — still applies; satisfied by physical separation under the new decision above.
- Schema-locked: `brand_type` enum value `'AUCTIONX'` is the opaque legacy identifier for the SFW Authentic Materials stream. Do not rename.

**Concrete consequence for executor:** S22 touches zero files under `frontend/src/features/unmentionables/`. Any temptation to add an `AgeGateModal`, a route subtree, or any UI surfacing Unmentionables age-verification status — stop. That UI ships in the separate Unmentionables frontend, not here.

---

## 3. Yoti Integration Approach

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Product | **Yoti Identity Verification (IDV)** with the age-estimation add-on enabled per session | Locked decision. Single integration covers KYC + age. |
| Integration mode | **Mock by default; live stub throws** | `YotiClient` interface with `MockYotiClient` (vitest + dev) and `LiveYotiClient` (`NotImplementedError` until S22.5). Factory selects via `YOTI_CLIENT_MODE='mock'\|'live'`. Entire user-facing surface additionally gated on `FEATURE_YOTI_ENABLED` (default `false`). Mergeable before Yoti business-account verification clears. |
| Flow | **Hosted session URL (redirect)**, not embedded SDK | Faster to ship; matches existing seller-verification page redirect pattern; Yoti's hosted page handles all device-capture UX. Embed deferred until S31 (Creator Verify) if needed. |
| Async/sync | **Async**. Frontend redirects to Yoti, Yoti redirects back to a return URL; status updates arrive via webhook (out-of-band). | IDV sessions take 30s–5min; cannot block UI. |
| Webhook auth | Yoti signs webhook payloads with the same PEM key used for session-create. Verify the `X-Yoti-Hmac` (or current equivalent — confirm against Yoti docs at integration time) HMAC against the raw request body. Reject on mismatch with 401. | Same pattern as `payment-webhook` (Stripe constructEventAsync). Lessons #2 + Webhooks. |
| Idempotency | `session_id` is unique; webhook handler must be idempotent on `session_id` + `event_type`. Store the last-seen event per session. | Yoti retries on 5xx. |
| Return URLs | `VITE_FRONTEND_URL/seller/verification/return?status=success` and `.../return?status=failure`. Status from the URL is **advisory only** — DB truth comes from the webhook. | Defense in depth — don't trust URL query params. |

---

## 4. Schema Changes

Follow Schema Extension Rules (CLAUDE.md): optional fields only, no in-transaction enum-reference, RLS for every new table.

### Migration file

`supabase/migrations/20260530000002_yoti_integration.sql`

### 4.1 Reuse existing columns (no migration needed for these)

The `users` table **already has** the fields we need for the status flag and the age fact:

- `users.seller_verification_status` — `verification_status` enum (NONE / PENDING / APPROVED / REJECTED / … / VERIFIED / FLAGGED / REVOKED). **Reuse as-is.** Yoti webhook is the only writer.
- `users.age_verified` — boolean
- `users.age_verified_at` — timestamptz
- `users.age_verification_provider` — text (set to `'yoti'`)
- `users.seller_verification_submitted_at`, `users.seller_verification_reviewed_at`, `users.seller_verification_rejection_reason` — reuse for Yoti event timestamps + rejection reason

Verified against `frontend/src/types/database.types.ts:1986–2091` and `verification_status` enum (Route Registry, 9 values).

### 4.2 New optional columns on `users` (additive only)

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS yoti_session_id TEXT,
  ADD COLUMN IF NOT EXISTS yoti_age_estimate INTEGER,
  ADD COLUMN IF NOT EXISTS yoti_last_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_yoti_session_id
  ON public.users(yoti_session_id)
  WHERE yoti_session_id IS NOT NULL;
```

All nullable. Backfill not required.

### 4.3 New table — `yoti_sessions` (audit/event log)

```sql
CREATE TABLE IF NOT EXISTS public.yoti_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  yoti_session_id TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('seller_kyc', 'age_gate', 'both')),
  status TEXT NOT NULL CHECK (status IN ('created', 'in_progress', 'completed', 'failed', 'expired')),
  age_estimate INTEGER,
  rejection_reason TEXT,
  last_event_type TEXT,
  last_event_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.yoti_sessions ENABLE ROW LEVEL SECURITY;

-- Users see only their own sessions
CREATE POLICY "Users can view own yoti sessions"
  ON public.yoti_sessions FOR SELECT
  USING (auth.uid() = user_id);

-- Inserts/updates only via service role (webhook). No user-facing INSERT/UPDATE policy.
```

`raw_payload` retains the verified Yoti webhook body for forensics. Strip PII before logging anywhere outside DB.

### 4.4 Do NOT touch

- `seller_verification_documents`, `seller_verification_reviews` tables — leave intact; controller will return empty / read-only for now (full deprecation deferred). Removing them would violate Schema Extension Rules.
- `verification_status` enum — already has all the values we need. No new enum values, no in-transaction enum/RLS combination (Lesson #3).

### 4.5 RLS sanity

- New `yoti_sessions` policies use `auth.uid() = user_id` — owner-only read, service-role-only write. Same pattern as `seller_verification_documents`.
- The new columns on `users` inherit existing `users` RLS — no policy changes needed there.

---

## 5. Backend Surface

### 5.0 Client abstraction (foundation for the whole §5)

`backend/src/lib/yoti/`:

- `YotiClient` interface — `createSession(opts)`, `getSession(sessionId)`, `verifyWebhookSignature(rawBody, signature)`.
- `MockYotiClient` — deterministic session IDs (`mock_sess_${nanoid()}`), configurable outcomes (`completed_verified`, `completed_rejected`, `expired`, `failed`), signs payloads with a test secret. Used by vitest and by local dev when `YOTI_CLIENT_MODE !== 'live'`.
- `LiveYotiClient` — every method throws `NotImplementedError('Yoti live client wired in S22.5')`. Production deploys cannot accidentally call Yoti before sandbox creds exist.
- `getYotiClient()` factory — selects implementation via `process.env.YOTI_CLIENT_MODE` (`'mock' | 'live'`); default `'mock'`. Vitest always forces `'mock'` via test setup.

**Feature flag:** `process.env.FEATURE_YOTI_ENABLED` (default `false`).
- When `false`: `POST /api/v1/verification/start` returns `503` with `error.code = 'YOTI_NOT_AVAILABLE'`, `error.message = 'Identity verification is coming soon.'`. The webhook endpoint stays mounted (routing + HMAC paths exercisable via tests) and the admin surface stays browsable but empty.
- When `true` AND `YOTI_CLIENT_MODE='mock'`: full mock flow runs end-to-end (useful for staging smoke tests once we wire it).
- When `true` AND `YOTI_CLIENT_MODE='live'`: real Yoti calls — DO NOT flip until S22.5 confirms creds, webhook secret, and App Runner env are all rotated.

S22.5 (follow-up mini-session) does exactly three things: drop `NotImplementedError` from `LiveYotiClient`, flip `FEATURE_YOTI_ENABLED=true` in staging via App Runner env, capture sandbox E2E screenshots in a verification doc.

### 5.1 New route file

`backend/src/routes/yotiVerification.ts`, mounted at `/api/v1/verification` in `backend/src/index.ts` AFTER any static-path admin routes are mounted (Lesson #5: static before parameterized).

### 5.2 Endpoints

| Method | Path | Auth | Rate Limit | Handler | Notes |
|--------|------|------|------------|---------|-------|
| POST | `/api/v1/verification/start` | requireAuth | 5/min per user | `startYotiSession` | Body: `{ purpose: 'seller_kyc' \| 'age_gate' \| 'both', return_url?: string }`. If `FEATURE_YOTI_ENABLED=false`, returns `503` with `YOTI_NOT_AVAILABLE`. Otherwise calls `yotiClient.createSession(...)`, persists `yoti_sessions` row (status=`created`), returns `{ session_url, session_id }`. |
| GET | `/api/v1/verification/status` | requireAuth | — | `getMyVerificationStatus` | Returns the caller's `users.seller_verification_status`, `age_verified`, `age_verified_at`, plus the latest `yoti_sessions` row. Used by SettingsPage, ListingCreate gate, and Unmentionables age-gate banner to read truth. |
| POST | `/api/v1/webhooks/yoti` | None — HMAC verification | 60/min per IP | `yotiWebhook` | RAW body required (mount with `express.raw({ type: 'application/json' })`, not the global `express.json()`). Verifies HMAC against `op://AM_Development/Yoti/webhook-secret`. Idempotent on `session_id` + `event_type`. Updates `users.seller_verification_status`, `users.age_verified`, `users.age_verified_at`, `users.age_verification_provider`, `users.yoti_age_estimate`, `users.yoti_last_event_at` and inserts/updates the `yoti_sessions` row. |

### 5.3 Admin endpoints

Mount under `backend/src/routes/admin/verifications.ts` (new file). Wire into the existing admin router with `verifyAdminAuth` + `adminRateLimit` already inherited globally.

| Method | Path | Permission | Audit Log | Handler |
|--------|------|------------|-----------|---------|
| GET | `/api/v1/admin/verifications` | `manage_users` (reuse — `review_sellers` permission already exists, prefer that) | — | List pending/failed sessions with filters (status, brand, date) |
| GET | `/api/v1/admin/verifications/:userId` | `review_sellers` | — | Detail: user + all `yoti_sessions` rows |
| POST | `/api/v1/admin/verifications/:userId/override` | `review_sellers` | `override_verification` | Body: `{ new_status, reason }`. Manual override with audit. Reuses `seller_verification_reviews` table for audit trail (already exists). |

### 5.4 Status transitions (state machine, enforced server-side)

| Yoti event | DB transition (`users.seller_verification_status`) | Side effects |
|------------|----------------------------------------------------|--------------|
| `session.created` | NONE → PENDING | Insert `yoti_sessions` row, status=`created` |
| `session.in_progress` | PENDING → PENDING (no-op) | Update `yoti_sessions.status=in_progress` |
| `session.completed` + checks pass | PENDING → VERIFIED | If `age_estimate ≥ 18`: set `users.age_verified=true`, `age_verified_at=now()`, `age_verification_provider='yoti'`. Trigger Postmark `seller_verification_approved` notification (uses S23 mailer; for S22 stub the call with a TODO if S23 hasn't landed). |
| `session.completed` + checks fail | PENDING → REJECTED | Capture `rejection_reason`. Trigger Postmark `seller_verification_rejected`. |
| `session.failed` / `session.expired` | PENDING → NONE | Allow retry. |
| Admin override | any → any | `seller_verification_reviews` row, audit log. |

Apply state transitions in a single SQL update inside a transaction with the `yoti_sessions` upsert — never two separate writes.

### 5.5 Secret management (1Password)

Add to `backend/.env.op`:

```
YOTI_SDK_ID=op://AM_Development/Yoti/sdk-id
YOTI_PEM_KEY=op://AM_Development/Yoti/pem-key
YOTI_WEBHOOK_SECRET=op://AM_Development/Yoti/webhook-secret
YOTI_BASE_URL=op://AM_Development/Yoti/base-url
YOTI_RETURN_URL=op://AM_Development/Yoti/return-url
FEATURE_YOTI_ENABLED=op://AM_Development/Features/yoti-enabled
YOTI_CLIENT_MODE=op://AM_Development/Features/yoti-client-mode
```

**These items do not need to exist for S22 to merge.** Yoti business-account verification is still pending. The executor adds the env keys to `backend/.env.op` with `op://` references but does NOT block on the secrets resolving — the factory + flag pattern (§5.0) means tests run against `MockYotiClient` and the user-facing surface stays behind the `503` until S22.5 flips the flag. When 1Password items don't resolve at runtime, the backend falls back to mock mode with a structured warning log (`yoti.client.fallback_to_mock`).

PEM key handling (for the eventual LiveYotiClient in S22.5): load once at startup; never log it; never serialize to JSON. Yoti SDKs expect the PEM as a string or path — pass the string from env.

Also remember (these apply at S22.5, not S22):
- AWS App Runner env vars are static literals — does NOT resolve `op://` (Lesson). At S22.5, copy resolved values into App Runner config OR set the resolved literals via `aws apprunner update-service`. **Boss action item, deferred to S22.5.**
- Supabase Edge Function secrets: not needed for S22 (no edge function touches Yoti yet). If S31 adds one, route it then.

### 5.6 API response shape

All responses follow `{ success: boolean, data?: T, error?: { code, message, requestId } }` (CLAUDE.md Code Style). `AppError` codes to add:

- `YOTI_SESSION_CREATE_FAILED`
- `YOTI_WEBHOOK_SIGNATURE_INVALID`
- `YOTI_SESSION_NOT_FOUND`
- `VERIFICATION_ALREADY_VERIFIED` (returned from `/start` if user is already VERIFIED)

### 5.7 Validation (Zod)

- `startYotiSession` body: `{ purpose: enum(['seller_kyc','age_gate','both']), return_url: string().url().optional() }`
- `yotiWebhook`: parse the raw body to JSON inside the handler **after** HMAC verification (never before — never trust an unverified payload). Validate with a Zod schema matching Yoti's webhook envelope.
- Admin override body: `{ new_status: verification_status enum, reason: string().min(10) }`

---

## 6. Frontend Surface

### 6.1 Pages / components to add or modify

| File | Action | Notes |
|------|--------|-------|
| `frontend/src/features/seller-verification/pages/SellerVerificationPage.tsx` | **Rewrite** | Replace document upload UI with: status card (current status from `/verification/status`) + "Start Verification" button that POSTs to `/verification/start` and `window.location.href = data.session_url`. After Yoti redirect-back, poll `/verification/status` for 30s OR show "We're processing — refresh in a minute" copy. |
| `frontend/src/features/seller-verification/components/YotiReturnHandler.tsx` | **New** | Mounted at `/seller/verification/return`. Reads `?status=` query param, kicks off a status poll, shows pending/success/failure UI. Truth is webhook-driven; this is UX skin. |
| `frontend/src/features/seller-verification/components/VerificationStatusBadge.tsx` | **Update** | Already exists. Update to render new VERIFIED/REJECTED states; remove document-specific UI. |
| `frontend/src/features/seller-verification/components/VerificationBanner.tsx` | **Update** | Already exists on dashboard. Update copy to reference Yoti hosted flow. Render only for `seller_verification_status ∈ (NONE, PENDING, REJECTED)`. |
| `frontend/src/features/seller-verification/components/DocumentUploader.tsx` | **Delete** | Document flow is superseded. Safest: delete the import sites first, then delete the file. |
| `frontend/src/pages/CreateListing.tsx` | **Update** | **Hard publish-gate** for non-VERIFIED sellers: Publish button is `disabled` with `title="Verify your identity to publish"` tooltip + inline `<Link to="/seller/verification">Verify now →</Link>` below. Draft Create AND Save Draft remain enabled. The gate is on Publish only — sellers can build listings while their Yoti session is still PENDING. |
| `frontend/src/App.tsx` | **Update** | Add `/seller/verification/return` route (protected). The existing `/seller/verification` route stays. |
| `frontend/src/pages/AdminVerificationsPage.tsx` (or under `frontend/src/features/admin/pages/`) | **New** | List + detail + override UI. Mirror the structure of Session 20's `AdminAuctionsPage` + `AdminAuctionDetailPage`: URL-synced filters, status pills, debounced search, row-click into detail, override action via `window.confirm` + reason prompt + `react-hot-toast`. |
| Admin sidebar nav | **Update** | Add "Verifications" entry between "Users" and "Moderation". |

**Flag gating (frontend-side):** every user-facing Yoti CTA reads `FEATURE_YOTI_ENABLED` from a single `getFeatureFlags()` helper (synced from backend `/api/v1/health` or hardcoded build-time `VITE_FEATURE_YOTI_ENABLED` — pick whichever already exists; do not invent a new pattern). When false:
- `SellerVerificationPage` shows an "Identity verification coming soon" placeholder card instead of the Start button. Status panel still renders so users see their current state.
- `CreateListing` hard publish-gate still applies (status is real), but the inline "Verify now →" link goes to the placeholder card.
- `AdminVerificationsPage` stays browsable and shows the empty state for "no sessions yet" (which is truth when the mock isn't seeded).

### 6.2 API helper

Add to `frontend/src/lib/api.ts`:

```ts
async function startVerification(purpose: 'seller_kyc' | 'age_gate' | 'both'): Promise<{ session_url: string; session_id: string }>;
async function getVerificationStatus(): Promise<{ seller_verification_status: VerificationStatus; age_verified: boolean; age_verified_at: string | null; last_session: YotiSession | null }>;
```

### 6.3 Brand-aware rendering rules (Locked decisions — re-check before each PR)

- The seller-verification page is brand-neutral by design (`/seller/verification` is shared between both eventual frontends — currently only the AM frontend exists). Copy emphasizes "Verify your identity to start selling" — never differentiates SFW/NSFW.
- No Unmentionables-specific UI lands in this session. The age-gate UI is a future-Unmentionables-frontend concern (Locked 2026-05-29). Resist the urge to add a stub.
- AM landing pages (`CollectorLandingPage`, `CreatorLandingPage`, `Dashboard`, `BrowsePage`) get zero new Yoti or Unmentionables imports.

### 6.4 Brand label centralisation

Use `BRAND_LABEL` from `frontend/src/constants/branding.ts` (rebrand-aligned by v30.0) for any user-facing brand name — never hardcode "Authentic Materials" or "Unmentionables".

---

## 7. Acceptance Criteria

Executor cannot open the merge PR until every box below is checked.

- [ ] Migration `20260530000002_yoti_integration.sql` applies cleanly to staging (`supabase db push` or MCP `apply_migration`).
- [ ] `npx tsc --noEmit` passes in BOTH `frontend/` and `backend/` (zero errors).
- [ ] `npx vitest run` passes in `backend/`. New specs covering:
  - happy path: webhook session.completed transitions PENDING → VERIFIED and sets `age_verified=true` when `age_estimate ≥ 18`
  - rejection path: session.completed + checks_failed transitions PENDING → REJECTED, captures rejection_reason
  - webhook idempotency: same session_id + event_type received twice yields one DB write
  - HMAC failure: invalid signature returns 401 and writes nothing
  - `startYotiSession` rejects when user is already VERIFIED with `VERIFICATION_ALREADY_VERIFIED`
  - admin override writes a `seller_verification_reviews` row + audit log entry
- [ ] No new "AuctionX" or "Unmentionables" string literals introduced outside `branding.ts` (lessons from rebrand alignment, v30.0).
- [ ] `DocumentUploader.tsx` and all import sites removed.
- [ ] `/admin/verifications` reachable + functional from admin sidebar; override happy path tested in vitest.
- [ ] CreateListing publish-gate active for non-VERIFIED users; draft save still works.
- [ ] No Unmentionables-specific UI added in this session — `grep -r "unmentionables" frontend/src/features/` returns nothing new vs. the merge base. (Existing files are fine; no additions.)
- [ ] Mock-mode vitest pass — all status-machine specs run against `MockYotiClient`, no live network calls (proven by a network-disabled test environment or by mock-only assertion).
- [ ] Flag-off path covered — vitest spec confirms `POST /api/v1/verification/start` returns `503` + `YOTI_NOT_AVAILABLE` when `FEATURE_YOTI_ENABLED=false`.
- [ ] Live client guard covered — vitest spec confirms `LiveYotiClient.createSession()` throws `NotImplementedError` (so a misconfigured prod deploy fails loudly, not silently).
- [ ] All new endpoints rate-limited per Security Checklist (Lesson — Architecture / Every Session): `/verification/start` 5/min/user, `/webhooks/yoti` 60/min/IP, admin override inherits adminRateLimit destructive (10/min).
- [ ] 1Password references (`op://AM_Development/Yoti/*`) — no hardcoded keys anywhere in source.
- [ ] `docs/SESSION_22_VERIFICATION.md` created with: migration apply log, vitest output, screenshots of seller-verification + Yoti redirect (sandbox) + admin review UI, App Runner env-var rotation note, list of deferred items.
- [ ] Bundle deploy to staging (`aws s3 sync` + CloudFront invalidate) — but Boss controls the actual `git push origin dev` (same SSH gate carried from S19–S21).

---

## 8. Out of Scope (Explicit)

These do NOT get touched in S22. If the executor finds itself writing code for any of these, stop and ask.

- **Live Yoti wiring** — moved to **S22.5**. S22 ships the interface + mock + stub-live + feature flag. Sandbox E2E test + App Runner env-var rotation + `LiveYotiClient` implementation all belong to S22.5.
- **Unmentionables age-gate UI** — deferred to the future Unmentionables-frontend session (Locked decision 2026-05-29: Unmentionables ships as a separate frontend at its own domain). Backend age-verification facts still ship in S22.
- **The Unmentionables frontend scaffold itself** — separate session, not yet on Roadmap v3 (flagged by librarian; Boss to slot).
- Stripe Connect Custom migration (separate spike; current Express setup remains)
- The DOB-cookie tier of the three-tier age model (S33, Phase 7J)
- Creator verification pipeline + creator badge + creator profile page (S31)
- Account deletion / data export / cookie consent (S32–33, Phase 7J)
- 2FA/MFA (S33)
- Postmark template content (S23 owns the templates; S22 only wires the trigger calls — stub them if S23 hasn't merged)
- Listing-submit Context-Aware Pre-Screen (Provisional in Decisions DB; do not implement)
- Yoti reusable-identity / Yoti app integration (the Yoti-app flow can be evaluated post-launch — this session uses hosted IDV only)
- Bulk migration of existing PENDING document-pipeline users to Yoti (manual operational step Boss will run after merge)
- Removing `seller_verification_documents` / `seller_verification_reviews` tables (Schema Extension Rules — additive only)

---

## 9. Lessons Learned to Enforce

All filtered from Lessons Learned DB. Listed by title with one-line applicability.

1. **Security checklist: run through EVERY module before commit** (Architecture / Critical / Every Session) — applies here because S22 adds an external integration with HMAC-verified webhooks; run the full 10-point list before commit.
2. **Static routes before parameterized** (Critical / Every Session) — `/api/v1/verification/start` and `/status` before `/:id`; same for admin `/admin/verifications` static GET before `:userId`.
3. **Service client bypasses RLS** (Every Session) — the webhook handler uses service role to update `users` + insert `yoti_sessions`. Always filter by `user_id` manually; verify HMAC FIRST then trust nothing else from payload (look up `user_id` from your own `yoti_sessions` row by `session_id`, not from the Yoti payload).
4. **Stripe in Deno: constructEventAsync** (Every Session) — analogous lesson for webhooks: in Node/Express we use synchronous HMAC verification, but the principle is the same: never accept a webhook body without crypto verification first.
5. **Enum + RLS same transaction** (Every Session) — applies if executor decides to add new `verification_status` enum values mid-session. Don't. Existing enum has the needed values.
6. **GoTrue / auth.users** (Every Session) — Yoti webhook never INSERTs into `auth.users`. Operates only on `public.users`.
7. **Edge Function deploys default to verify_jwt=true** (Every Session) — N/A this session (no edge function added), but note for future: any future edge function that receives a third-party webhook needs `--no-verify-jwt`.
8. **AWS App Runner env vars are static literals** (Every Session) — must update App Runner config after merge for Yoti creds. Document in verification doc.
9. **Vite shell env beats .env files** (Every Session) — frontend takes no Yoti secrets (Yoti is backend-only). Don't add `VITE_YOTI_*` to `frontend/.env.op`. If a Yoti redirect URL becomes a public-facing var, route it through `VITE_FRONTEND_URL` instead.
10. **Supabase CLI gen types injects `<claude-code-hint>` plugin tag** — strip it after regenerating `database.types.ts` post-migration.
11. **New lesson to enforce in this session: stub-and-flag pattern for awaiting-creds third-party integrations.** When the upstream vendor account or credentials aren't ready, the integration still ships if (a) there's a `Client` interface, (b) a `MockClient` for tests, (c) a `LiveClient` whose methods throw `NotImplementedError`, (d) a feature flag that short-circuits the user-facing surface to a friendly placeholder + `503`. Lets the code merge without blocking on a third-party calendar. **Capture as a Lessons Learned DB entry at session close** under Architecture / Module Start, severity Medium.

---

## 10. Open Questions for Boss

The first batch (#1, #2, #3, #7 from v1) is **resolved** by Boss's 2026-05-29 answers and the separate-frontend Locked decision. Remaining open questions, with proposed defaults:

1. **Admin override permission.** Use existing `review_sellers` permission (granted via migration `20260320000003`) or broader `manage_users`? **Default proposed: `review_sellers`.** Confirm or override.
2. **Postmark notifications on status transitions.** S23 (SMTP/Postmark) is the parallel Wave 1 session. If S23 ships first, S22 wires it up; if S22 ships first, S22 stubs the call with `// TODO(S23): wire postmark.send(...)`. **Default proposed: stub-if-S23-not-merged.** Confirm.
3. **App Runner env-var rotation.** **Default proposed: Boss action item at S22.5, not executor.** (Consistent with App Runner static-env lesson + S21 carry-over.)
4. **`FEATURE_YOTI_ENABLED` scope.** Per-environment (staging on / prod off) or single global? **Default proposed: per-environment via `op://AM_Development/Features/yoti-enabled` resolving to literal `"true"` or `"false"` in the App Runner config.** Lets you flip staging on at S22.5 without touching prod. Confirm.

---

## 11. Estimated Complexity & Checkpoint Plan

**Complexity:** Low-Medium (revised down from v1). With AgeGateModal + route-tree work + live Yoti integration test all removed:
- Backend: ~450 LoC (interface + mock + live-stub + factory + routes + controllers + admin)
- Frontend: ~400 LoC (SellerVerificationPage rewrite + YotiReturnHandler + AdminVerificationsPage + admin nav + CreateListing publish-gate + flag-gating helper)
- Migration: ~50 LoC
- Vitest: ~300 LoC (status machine + idempotency + HMAC + flag-off 503 path + LiveYotiClient guard)
- **Total ≈ 1,200 LoC.** Smaller than Session 20. Only real cognitive load is the mock/stub/factory pattern in §5.0.

**Checkpoint plan:**
1. **Boss approves this revised brief** → executor starts in worktree on `feature/session-22-yoti`.
2. Executor runs straight through §4 → §5 → §6 → §7 without mid-phase pausing (per orchestrator plan).
3. Executor produces `docs/SESSION_22_VERIFICATION.md` + the merge-ready branch.
4. **Boss reviews merge.** Executor does NOT merge to `dev` autonomously. Same SSH-push gate as S19/S20/S21 still applies; executor stops at local merge.
5. **S22.5 (follow-up mini-session) — owns live Yoti wiring.** Runs only after Yoti business-account verification clears and sandbox creds are populated in `op://AM_Development/Yoti/*`. Scope: drop `NotImplementedError` from `LiveYotiClient`, copy resolved Yoti creds + `FEATURE_YOTI_ENABLED=true` into App Runner config, capture sandbox E2E screenshots, append a verification doc. ~150 LoC, 1–2 hours.
