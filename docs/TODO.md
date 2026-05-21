# AuctionX — TODO Tracker

Last updated: 2026-05-21 (session 20 code complete on `feature/session-20-admin-auctions` — local tsc/vitest/build all green; staging deploy still gated on SSH push to origin/dev. Session 19 push gate also still open.)

---

## ⏱ Session 20 close-out — status (2026-05-21)

- [x] **Code complete on `feature/session-20-admin-auctions`** — commit `a332d84`. 11 files, +1715/-12. Brief at `docs/SESSION_20_BRIEF_ADMIN_LISTINGS_AUCTIONS.md` fully covered. Verification dossier at `docs/SESSION_20_VERIFICATION.md`.
- [x] **Local verification green** — backend `npx tsc --noEmit` exit 0, frontend `npx tsc --noEmit` exit 0, `npx vitest run` 20 passed / 21 skipped (pre-existing integration skips), `npm run build` clean.
- [x] **New backend tests** — 8 specs in `backend/src/__tests__/adminAuctions.test.ts` covering end/cancel happy paths, precondition rejections, settlement guard, rollback.
- [ ] **BLOCKED on Boss — SSH push to origin** — same gate as session 19. Once resolved: merge feature → dev, push, App Runner auto-deploys backend, then run frontend deploy block in `SESSION_20_VERIFICATION.md` "Staging verification" section. I did NOT ship the frontend alone because the new admin/auctions UI would 404 against the unchanged backend.
- [ ] **Staging smoke test (Boss, post-deploy)** — 7-step checklist in `SESSION_20_VERIFICATION.md`. As admin (`2b3f1532-9345-4720-8fac-55d07517c78b`): list loads, filters/pagination/URL sync, row click → detail, End auction (ACTIVE), Cancel auction (with reason), Force-settle (ENDED), 412 on bad-state transitions.
- [ ] **Bump CLAUDE.md to v30** — both local file and Notion. Update Current State (Phase row + branch row + next-up row), append v30 history table entry.

---

## ⏱ Session 19 close-out — status (2026-05-21)

- [x] **Feature branch pushed to origin** — `feature/phase-7e-real-buyer-loop` has all 7 commits on remote (was incorrectly listed as "local-only" — branch was already pushed before close-out resumed).
- [x] **Staging smoke test (Playwright)** — 15/16 tests pass on `https://d1bwev65w7rqzl.cloudfront.net` (public routes, auth-gated redirects, backend health, CORS, 404 all green). 1 test failed: auth-flow login → bad credentials. Diagnosis: stale 1Password mapping — `op://AM_Development/App Secrets/test-user-password` doesn't match the no-hyphen `test@authenticmaterials.com` account on staging. LoginPage rendered + validated correctly (inline "Invalid credentials" error visible in screenshot). **NOT a session-19 regression.** See `scripts/reports/test-artifacts/smoke-Auth-flow-Login-→-dashboard-→-logout-smoke/test-failed-1.png`.
- [x] **Lessons + Decisions pushed to Notion** — 2 lessons in Lessons Learned DB (`<claude-code-hint>` plugin tag + Check related routes), 3 decisions in Decisions DB (Stripe Elements deferral, Yoti, Place Bid navigation). All Locked/Active. Decision dates landed in body text due to a Notion API quirk (Decisions DB "Decision Date" column has embedded colons in its name → expanded date format ambiguous).
- [x] **CLAUDE.md bumped to v29 in Notion** — Notion was already at v28 (Deep Research Queue, 2026-05-16) so session 19 work landed as v29 instead of overwriting v28. Updated: Version property, Last Updated (2026-05-21), Current State date, Current branch row, Next-up row, new v29 history table entry.
- [x] **Local merge `feature/phase-7e-real-buyer-loop` → `dev`** — clean fast-forward, 998 insertions / 117 deletions across 15 files. Local `dev` now 7 commits ahead of `origin/dev`. No push yet (see next).
- [ ] **Push local `dev` to `origin/dev`** — **BLOCKED on Boss**. `git fetch / push` fails with `Permission denied (publickey)` against `git@github.com:`. Current `SSH_AUTH_SOCK` points at a non-1Password agent (`/Users/chris/.ssh/agent/s.lYoJevTwUt...`) that has one ED25519 key but it's not the GitHub one. Boss action: re-export `SSH_AUTH_SOCK` to the 1Password SSH agent socket OR `ssh-add` the GitHub key, then `git push origin dev`. After push, App Runner auto-deploys; verify https://vw7zy9mkyg.us-east-2.awsapprunner.com/api/v1/health returns healthy.
- [ ] **Register Stripe `payment-webhook`** in Stripe Dashboard → Developers → Webhooks. URL `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook`, events `payment_intent.succeeded` + `payment_intent.payment_failed`. Update `op://AM_Development/Stripe/webhook-secret`, then:
  ```bash
  supabase secrets set STRIPE_WEBHOOK_SECRET="$(op read 'op://AM_Development/Stripe/webhook-secret')" --project-ref pmlofthmobglcfkqjtru
  ```
  Closes the last synthetic SQL step from session 18.

## Close-out follow-ups surfaced 2026-05-21

- [ ] **1Password test buyer credential mismatch** — `op://AM_Development/App Secrets/test-user-password` is set but doesn't authenticate the no-hyphen `test@authenticmaterials.com` account on staging. Either (a) reset the no-hyphen account's password and update the vault entry, or (b) the vault entry is for the hyphenated legacy account and the no-hyphen account needs its own vault entry. Affects: Playwright auth-flow test, any automated buyer-flow E2E.
- [ ] **Decisions DB date property has embedded colons in its name** — breaks the API expanded date format (`date:<column>:start`). Either rename the column to a clean name (e.g., "Decision Date") or document the workaround (date in body text). Affects any future agent pushing Decisions via the API. Surfaced 2026-05-21 while pushing the Yoti decision.
- [ ] **`scripts/.env.op` points at localhost** (`PLAYWRIGHT_BASE_URL=http://localhost:5173`, `PLAYWRIGHT_BACKEND_URL=http://localhost:3001`) — fine for local dev but breaks `op run --env-file .env.op -- playwright test` against staging without a per-run override. Consider splitting into `.env.op.local` + `.env.op.staging` or adding a `STAGING=1` env switch. Workaround for now: `sed` a temp file before invoking `op run`.

---

## 🎯 Next sessions (briefs ready or scoped)

- [ ] **Session 20 — Admin Listings/Auctions management** — brief at `docs/SESSION_20_BRIEF_ADMIN_LISTINGS_AUCTIONS.md`. Self-contained, ready to hand to claude.ai. Includes `/admin/auctions` list + detail pages, end/cancel/force-settle actions, AdminLayout nav entry, backend list/detail/action endpoints, audit logging. Branch: `feature/session-20-admin-auctions`. Scope is tight: ONE session.
- [ ] **Session 21 — Stripe Elements / Payment Element on SettlementPage Pay Now** — replaces the `alert()` stub on `frontend/src/pages/SettlementPage.tsx:98-106`. Pre-req: drop `pk_test_*` into `op://AM_Development/Stripe/publishable-key`. Estimated 3-4h focused work. After this lands, real buyer can complete bid → pay → confirm → release entirely through clicks on staging. No brief written yet — flag when ready and I'll scope it.
- [ ] **Session 22+ — Yoti integration** — decision locked (`SESSION_19_NOTION_DRAFTS.md` Decision 2). Rebuild seller verification flow around Yoti's hosted session API; derive `users.seller_verification_status` from Yoti webhook events; add Yoti age-estimation gate on Authentic Materials browse/detail (covers NSFW age requirement). Pre-reqs: `op://AM_Development/Yoti/sdk-id` + `op://AM_Development/Yoti/pem-key` populated, decision made on whether to migrate Stripe Connect Express → Custom (to push pre-collected Yoti KYC and avoid double-verification). No brief yet.

---

> **🔄 Reconciliation note (2026-05-09):** The TODO entries below for "Apply DB migration and regenerate types" in Modules 12, 13, 14, 15 are STALE. Verified via `mcp__plugin_supabase_supabase__list_migrations` — all migration files in `supabase/migrations/` are already applied to `pmlofthmobglcfkqjtru`. Zero schema drift. The TS casts (`as never`/`as any`) listed in those entries can be removed and types regenerated. Edge function deploys for `process-payment`, `payment-webhook`, and `release-escrow` are also LIVE — the only remaining gate for real Stripe processing is the env vars in Supabase dashboard. See `PAYMENT_DEPLOY_CHECKLIST.md` banner.

---

## Pre-prod (cross-cutting)

- [ ] **TODO (Infra, 2026-05-11):** Migrate backend off AWS App Runner.
  - Context: App Runner is **closed to new customers** as of 2026; existing customers (Boss) can keep running it but AWS has stated no new features will land. No hard EOL date published. Recommended target is **Amazon ECS Express Mode** (Fargate) — single API call provisions ECS service + ALB + auto-scaling + networking. AWS migration guide: https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html
  - Recommended approach: blue/green with Route 53 weighted routing — both services run simultaneously while traffic shifts gradually.
  - Priority: MEDIUM — not blocking launch, but should ship before any major scaling event or before App Runner removes a feature we depend on.
  - Risk: source-based App Runner deploys need a containerization step (Dockerfile + ECR push) before migrating. Check whether current App Runner config is image-based or source-based; if source-based, factor in the Dockerfile work.

- [ ] **TODO (Boss directive 2026-05-10):** Rotate ALL secrets at the prod cutover. Includes: `RELEASE_ESCROW_SECRET` (Edge Function env + matching `release_escrow_secret` vault entry); `SUPABASE_SERVICE_ROLE_KEY` (App Runner + 1Password `cli-admin-ops` and `service-role-key` items); `SUPABASE_ANON_KEY` (Vercel + frontend `.env.op` + 1Password `anon-key`); Stripe `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_WEBHOOK_SECRET` (live keys); Postmark `POSTMARK_SERVER_TOKEN`; payment-processor live keys when approved (PaymentCloud, Signature, CCBill, NOWPayments).
  - Priority: HIGH — production safety
  - Depends on: `docs/audits/2026-05-10-supabase-jwt-rotation-audit.md` for the Supabase rotation order
- [ ] **TODO (next session):** Execute Stages 0–4 of the JWT rotation plan in `docs/audits/2026-05-10-supabase-jwt-rotation-audit.md`. Stage 1 (staging probe) is the unblocker for the Session K mystery — must capture HTTP traces. Don't proceed past Stage 1 without a green light or a documented fix.
- [x] **DONE (session 18, 2026-05-11):** Stripe sandbox mode confirmed — `op://AM_Development/Stripe/secret-key` starts with `sk_test_`.

- [x] **DONE (session 18, 2026-05-12):** Phase 7D real-data E2E completed. Real Stripe charge `pi_3TW645D8XmCocfaE0uyzH7Nl` → real Stripe Connect Transfer `tr_1TW6GUD8XmCocfaEFXRoUvZC` → real Postmark email delivered to buyer (DKIM-verified). Code fixes shipped: `npm:stripe@17.5.0` import pinning, `paymentMethodId` support, `allow_redirects:'never'`. See `MODULE_7D_VERIFICATION.md` "Real-Data E2E COMPLETE 2026-05-12" for full evidence.
- [x] **DONE (session 18, 2026-05-12):** `SETTLE_SECRET` rotated and synced between Edge Function env and 1Password.
- [ ] **TODO (session 19 — stash settle_secret in vault):** Recommended follow-up: add `settle_secret` to `vault.secrets` for parity with `release_escrow_secret` / `reconcile_escrow_secret`. Lets future settle invocations go via pg `net.http_post` without op/curl.
- [ ] **TODO (Boss action — pending session 19 close-out):** Register Stripe `payment-webhook` in Stripe Dashboard → Developers → Webhooks → add endpoint `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook` with events `payment_intent.succeeded` + `payment_intent.payment_failed`. Update `op://AM_Development/Stripe/webhook-secret` with the new signing secret. Push to Supabase via `supabase secrets set STRIPE_WEBHOOK_SECRET=$(op read 'op://AM_Development/Stripe/webhook-secret') --project-ref pmlofthmobglcfkqjtru`. After this, the synthetic SQL UPDATE from session 18 is no longer needed.
- [x] **DONE (session 19, 2026-05-13):** `frontend/src/pages/ViewListing.tsx` Place Bid button wired with auth/seller/status gating + Link-based navigation to `/auctions/:auctionId` (reuses existing BidPlacementForm + AuctionDetailPage). Current bid + reserve indicator + CountdownTimer surfaced above the button. Deployed to staging.
- [x] **DONE (session 19, 2026-05-13):** `frontend/src/pages/SettlementPage.tsx` BuyerView Confirm Delivery CTA shipped — emerald card with `window.confirm` guard, calls `POST /api/v1/delivery/:settlementId/confirm-delivery`, optimistic update + toast, hides Open-Dispute card after confirmation. `api.confirmDelivery` helper added to `frontend/src/lib/api.ts`. Deployed to staging.
- [ ] **TODO (session 20 — Stripe Elements):** Build Stripe Elements / Payment Element on SettlementPage to replace the current Pay Now stub (`alert()`). Requires `op://AM_Development/Stripe/publishable-key` populated first. After this lands, the buyer can complete the full bid → pay → confirm → release loop entirely through clicks on staging.
- [ ] **TODO (session 19 — side menu UX, lower priority):** Boss reported the side menu renders very small and won't fully open on staging. Capture screenshot, repro, fix.
- [ ] **TODO (session 19 — test fixture cleanup):** Decide whether to keep the `[E2E-TEST-2026-05-11]` rows (listing/auction/bid/settlement/transaction/payout) on prod as a real-data sample, or run the cleanup SQL in `MODULE_7D_VERIFICATION.md` "Cleanup SQL (post-verification)".

---

## Infrastructure: 1Password + Postmark (2026-05-09)

- [x] **DONE:** Migrate all dev secrets from plain `.env` files into 1Password `AM_Development` vault (kyniteinc.1password.ca business account)
  - 8 new items: Supabase Staging, AWS AuctionX Media, Postmark API, Stripe, Pinata, Base Network, App Secrets, Third Party APIs
  - Business-account isolation via `.op-account` file (gitignored) + explicit `--account` flag in all scripts
- [x] **DONE:** Commit `.env.op` template files for backend/frontend/supabase/scripts (op:// references, no real secrets)
- [x] **DONE:** Add `scripts/inject-secrets.sh` — populates real `.env` files from 1Password
- [x] **DONE:** Wrap `npm run dev` (backend + frontend) with `op run --env-file .env.op` so secrets resolve at process start
- [x] **DONE:** Replace email sender stub with Postmark (`postmark@4.0.7`) — `sendEmail()` now actually delivers
- [x] **DONE:** `cc-auctionx` shell alias in `~/.zshrc` for launching Claude Code with secrets injected
- [x] **DONE:** `.claude/settings.json` PreToolUse hook warns when `SUPABASE_URL` is missing
- [x] **DONE:** Install Notion MCP at user scope (`https://mcp.notion.com/mcp`) — needs OAuth on next session start
- [ ] **TODO (Boss):** Restart Claude Code + authenticate Notion MCP via OAuth in next session
- [x] **DONE (session 18, 2026-05-11):** Postmark server token + from-email populated in 1Password + Supabase Edge Function secrets (Boss-confirmed). Live test send still pending — first real ESCROW_RELEASED fire of session 19's E2E will validate.
- [ ] **TODO (Boss):** Fill in 2 remaining vault fields when values are available
  - `Stripe / publishable-key` (from Stripe dashboard) — only if frontend Stripe Elements wired up
  - `Third Party APIs / anthropic-api-key` — only if Boss creates Anthropic API account; not blocking
- [x] **DONE (session 18, 2026-05-12):** Postmark live-verified via real ESCROW_RELEASED email delivery to test buyer inbox. DKIM signatures from both `pm.mtasv.net` and `authentic-materials.com` verified.
- [ ] **TODO (next session):** Push Lessons Learned + Decisions entries to Notion (drafts in `docs/SESSION_2026-05-09_NOTION_DRAFTS.md`)

---

## Design Session D: Landing Pages

- [x] **DONE (Session D):** Build `/collector` landing page -- hybrid dark/light layout, verbatim spec copy
- [x] **DONE (Session D):** Build `/creator` landing page -- hybrid dark/light layout, verbatim spec copy
- [x] **DONE (Session D):** Build `/am-sealed` product page -- four-phase animation, ProductToggle
- [x] **DONE (Session D):** Build `/am-proof` product page -- four-phase animation, ProductToggle
- [x] **DONE (Session D):** LandingNav component with page links + login/signup
- [x] **DONE (Session D):** WaitlistCapture email capture component
- [x] **DONE (Session D close-out):** Wire WaitlistCapture to Supabase `waitlist_signups` table
  - Migration applied, types regenerated, `waitlist.ts` uses typed client
- [x] **DONE (Session D close-out):** Deploy landing pages to staging
  - Built + synced to S3 + CloudFront invalidated (2026-05-09)
- [ ] **TODO:** WCAG 2.2 AA axe scan on all four landing pages
  - Context: Built with proper contrast, focus rings, and semantic HTML but not yet scanned with axe
  - Priority: HIGH -- required per session checklist

---

## Auth / Session Fixes

- [x] **DONE (Session H_c):** Fix ProtectedRoute race condition — add `initialized` guard
  - `App.tsx` inline ProtectedRoute now checks `!initialized || loading` before rendering
  - Removed redundant page-level auth redirects from `MyListings.tsx` and `ProfilePage.tsx`
  - Deleted unused `features/auth/components/ProtectedRoute.tsx` (zero imports)
- [x] **DONE (Session I):** Deploy auth fixes to staging — Session H fixes were in code but never deployed
  - Built and deployed to S3 + CloudFront invalidation
- [x] **DONE (Session J):** Fix Dashboard blank page — `/dashboard` route was missing from App.tsx
- [x] **DONE (Session J):** Fix Browse page missing menu bar — wrapped public routes in `PublicWithHeader` layout

---

## Design System Fixes

- [x] **DONE (Session I):** Fix button gradient bleed — added `overflow-hidden` to Button.tsx baseClasses
- [x] **DONE (Session I):** Fix text contrast violations — replaced `text-gray-500` → `text-gray-400`, `text-gray-600` → `text-gray-500` across 42 files (102 occurrences)
- [x] **DONE (Session I):** Document Unmentionables nav link pink accent as accepted brand exception
- [x] **DONE (Session J):** Fix gradient button text cutoff — inner div gets own size classes + flex centering
- [x] **DONE (Session J):** Smooth harsh gradient stop — added `via-primary-400` + changed to `to-br` direction
- [x] **DONE (Session J):** Enlarge header search bar — `h-9` → `h-11`, `max-w-xs` → `max-w-md`, added search icon
- [x] **DONE (Session J):** Declutter nav — primary nav reduced to 3 items, rest moved to user dropdown
- [x] **DONE (Session K):** Fix Button.tsx gradient — was hardcoded `purple→pink`, changed to design system `primary-500→accent-500` (purple→blue)
- [x] **DONE (Session K):** Fix root `.env.production` — outdated App Runner URL `spuk5673jm` → `vw7zy9mkyg`

---

## Admin Dashboard

- [x] **DONE (Session I):** Fix admin_users RLS infinite recursion — created SECURITY DEFINER helpers
- [x] **DONE (Session I):** Fix TEXT vs admin_permission enum type mismatch in RLS helper
- [x] **DONE (Session I):** Insert admin_users row for Boss's UUID (was missing from table)
- [x] **DONE (Session J):** Add admin console access button in Header nav (desktop dropdown + mobile drawer)
- [x] **DONE (Session K):** Admin dashboard API calls fixed
  - Root cause: App Runner had `sb_secret_...` format key instead of JWT for `SUPABASE_SERVICE_ROLE_KEY`
  - Also fixed: `AWS_REGION` typo (`s-east-2` → `us-east-2`) in App Runner env
  - Updated local `backend/.env` and App Runner env vars via `aws apprunner update-service`
  - Admin dashboard, Users, Audit Logs all verified working on staging
  - **2026-05-10 audit follow-up:** No smoking gun found in code for why the rotation broke — see `docs/audits/2026-05-10-supabase-jwt-rotation-audit.md` §1 hypotheses. Most likely contributor is the conflated `AWS_REGION` typo fix; secondary is unverified SDK behaviour with `sb_secret_*`. Next rotation attempt MUST capture failing-endpoint traces on staging before touching prod.
- [x] **DONE (Session 18 bonus, 2026-05-11):** Admin dashboard storage tile fixed (was reporting `degraded`).
  - Root cause: four different env var names in play for one logical setting — App Runner + `.env.op` use `S3_BUCKET_NAME`, but `src/lib/s3.ts` + `verificationController.ts` read `S3_BUCKET`, and the health check read yet another phantom `AWS_S3_BUCKET`. Uploads worked only because of a hard-coded `|| 'auctionx-media-prod-cl'` fallback that happens to match the real bucket name.
  - First commit `f555630` aligned health → `S3_BUCKET` (still unset; tile remained degraded).
  - Second commit `97498ab` aligned all 3 files → `S3_BUCKET_NAME` (canonical name). Deployed via App Runner auto-deploy on push to `dev` (Op `9b841dbf...`). Boss verified storage tile is now green.
- [ ] **TODO (follow-up to 2026-05-11 fix):** Replace env-var-presence check in `backend/src/routes/admin/health.ts:40-45` with a real S3 connectivity test (`HeadBucket` with timeout). Current logic only verifies config is present, not that S3 is reachable — a green tile is not yet a true health signal.
- [ ] **TODO (follow-up to 2026-05-11 fix):** `backend/src/lib/s3.ts:4` defaults `AWS_REGION` to `'us-east-1'`, but the bucket lives in `us-east-2`. Not breaking today (App Runner has `AWS_REGION` set), but the default is misleading — change to `'us-east-2'`.
- [ ] **TODO (security hygiene, surfaced 2026-05-11):** All non-publishable secrets in `aws apprunner describe-service` for `auctionX_backend_staging` are stored in `RuntimeEnvironmentVariables` (plaintext) rather than `RuntimeEnvironmentSecrets` (empty). Includes AWS access key, Stripe test-keys + connect webhook secret, Supabase service-role JWT, MINTER_PRIVATE_KEY, SETTLE_SECRET, RELEASE_ESCROW_SECRET, Pinata JWT. Migrate to Secrets Manager references before prod cutover; align with the cutover-time rotation TODO above.

---

## Module 18: Launch Prep

- [ ] **TODO:** Activate Sentry error tracking
  - Context: `frontend/src/lib/errorTracking.ts` has Sentry calls commented out. When ready: `npm install @sentry/react`, set `VITE_SENTRY_DSN` env var in Vercel, uncomment the Sentry init + captureException calls.
  - Priority: HIGH — required for production error visibility
  - File: `frontend/src/lib/errorTracking.ts`

- [ ] **TODO:** Create `og-image.png` asset
  - Context: `frontend/index.html` references `/og-image.png` for Open Graph and Twitter Card previews. This file does not exist yet. Create a 1200×630px branded image.
  - Priority: MEDIUM — affects link previews on social media

- [ ] **TODO:** Set up sitemap generation cron
  - Context: `scripts/generateSitemap.ts` is a stub that generates `sitemap.xml` from active listings + NFC tokens. Wire it to the CI/CD pipeline or a daily cron job once Supabase credentials are available in the build environment.
  - Priority: LOW — improves SEO discoverability
  - Depends on: Supabase credentials in build environment

- [ ] **TODO:** Add `GET /admin/health` endpoint
  - Context: `AdminHealthPage` polls `/api/v1/admin/health` every 30s but the endpoint is not implemented. The page handles the 404 gracefully. Module 18 introduced `/api/v1/health` (DB ping), but the admin-specific health page needs a richer endpoint including queue depths and processor status.
  - Priority: LOW — admin functionality works without it
  - Depends on: Backend route addition

---

## Module 17: E2E Testing & Security Audit

- [ ] **TODO:** Seed real test users in Supabase for E2E tests
  - Context: E2E specs (`auth.spec.ts`, `admin.spec.ts`, `auction.spec.ts`) require `TEST_USER_EMAIL` and `TEST_ADMIN_EMAIL` to point to real Supabase users. Create these users via Supabase dashboard → Authentication → Users, then set credentials in `.env.test`.
  - Priority: HIGH — without test users, authenticated E2E tests are skipped

- [x] **DONE:** Add rate limit to `GET /search` endpoint
  - Added `searchRateLimit` (60 req/min) via `router.use()` in `routes/search.ts`

- [ ] **TODO:** Replace in-memory admin rate limit Map with persistent store
  - Context: The admin rate limiter uses an in-memory Map that resets on server restart. Replace with Redis or Supabase-backed store.
  - Priority: MEDIUM

- [ ] **TODO:** Set up CI pipeline for automated test runs
  - Context: `package.json` at root now has `test:all`, `test:e2e`, `test:api`, `test:mechanics` scripts. Wire these to GitHub Actions or similar CI on pull requests.
  - Priority: MEDIUM — prevents regressions on future modules

---

## Module 16: Notifications System

- [ ] **TODO:** Resend email integration
  - Context: `emailSender.ts` is a stub that logs intent only. When `RESEND_API_KEY` is available, install `resend` package and replace the stub body with `resend.emails.send(...)`.
  - Priority: HIGH — required for real email delivery

- [ ] **TODO:** Offline check before sending MESSAGE_RECEIVED email
  - Context: `messagingController.sendMessage` always sends a notification to the recipient. Ideally it should check if the recipient has been active in the last 5 minutes (e.g., via presence/Realtime heartbeat) and skip the email if they're online.
  - Priority: MEDIUM — avoids unnecessary emails for active users

- [ ] **TODO:** PAYMENT_WINDOW_EXPIRING trigger (pg_cron job)
  - Context: The `payment_window_expiring` preference column is defined and documented, but no trigger currently fires this notification. A pg_cron job should check for offers expiring within ~5 minutes and insert PAYMENT_WINDOW_EXPIRING notifications.
  - Priority: MEDIUM — improves buyer experience during settlement

- [x] **DONE:** Add FRONTEND_URL env var to all edge functions
  - All 4 edge functions already use `Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'`
  - Remaining: set `FRONTEND_URL` in Supabase dashboard secrets (ops task, not code)

---

## Module 14: Enhanced Search

- [ ] **TODO:** Apply DB migration and regenerate types
  - Context: `supabase/migrations/20260302000001_full_text_search.sql` adds `search_vector` column + GIN index + `saved_searches` table. After applying, run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp ...`. Until then, `.textSearch('search_vector')` uses `as never` assertion.
  - Priority: HIGH — required before full-text search works in production
  - Depends on: Supabase CLI + project credentials

- [ ] **TODO:** Explicit ts_rank ordering for relevance sort
  - Context: `textSearch()` returns results in relevance order naturally via PostgREST, but a raw SQL `ORDER BY ts_rank(search_vector, plainto_tsquery('english', $q)) DESC` would give more explicit control. Not implemented because the default behavior is correct for the common case.
  - Priority: LOW

- [ ] **TODO:** Saved search email notifications
  - Context: `notify_new_results` column is stored in `saved_searches` but there is no background worker or cron to check for new matches and send notifications. Would require a Supabase Cron job + email provider integration.
  - Priority: MEDIUM

- [ ] **TODO:** BrowsePage category grid pagination
  - Context: Categories are fetched in one query (no limit). Acceptable at current scale (< 20 categories). If categories grow large, paginate or use virtual scroll.
  - Priority: LOW

---

## Module 12: Seller Payouts

- [ ] **TODO:** Apply DB migration and regenerate types
  - Context: `supabase/migrations/20260301000002_payouts_table.sql` adds `payouts` table + escrow/dispute columns on settlements. After applying, run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp ...`. Then remove `(supabase as any)` cast in `PayoutsPage.tsx`.
  - Priority: HIGH — required before payouts feature works
  - Depends on: Supabase CLI + project credentials

- [x] **DONE (2026-05-10):** pg_cron schedule for release-escrow live — `release-escrow-tick` jobid=3, `*/15 * * * *`, vault-based secret pattern (mirrors `reconcile-escrow-daily`). End-to-end pipeline verified: cron → vault lookup → http_post → gateway (verify_jwt:false) → function (x-release-secret match) → settlements query → 200 with empty-result stats. Real-data test deferred — prod has 0 settlements; needs purchase-flow fixtures in a separate session.
  - Bump cadence to `*/5 * * * *` once load + timing are confirmed safe.
- [x] **DONE (2026-05-10) Phase 7B:** Buyer delivery confirmation as escrow-release trigger.
  - Migration `20260509120200_delivery_confirmation.sql` adds `delivery_confirmed_at` + `delivery_confirmed_by` columns + partial index to `settlements`.
  - `POST /api/v1/delivery/:settlementId/confirm-delivery` endpoint (service-role, idempotent on re-confirm, requires `ESCROW_HOLD`).
  - `release-escrow` v10 ACTIVE — query widened with `.or(escrow_ends_at.lte.<now>,delivery_confirmed_at.not.is.null)`. `verify_jwt: false` pinned via `release-escrow/config.toml`.

- [x] **DONE (Phase 7D, live-verified 2026-05-11):** Stripe Connect Express + real Transfer end-to-end on prod (Stripe test mode).
  - `release-escrow` v10 ACTIVE (`verify_jwt: false`, vault-based cron secret). Transfer gate verified: Stripe Transfer `tr_1TVih0D8XmCocfaEczXpPKTf` fired against onboarded seller; payout transitioned `PENDING → PROCESSING` with `stripe_transfer_id` populated.
  - Schema: `stripe_connect_account_id`, `_onboarding_started_at`, `_charges_enabled`, `_payouts_enabled` on `users`; `stripe_transfer_id` on `payouts`. Migration `20260510000001_stripe_connect.sql` applied.
  - Webhook destination registered in Stripe Dashboard → Connect → Connected accounts (`account.updated`). `STRIPE_CONNECT_WEBHOOK_SECRET` populated in both 1Password and App Runner env.
  - Onboarding: `POST /api/v1/stripe-connect/onboarding-link`, `GET /status`, `POST /webhooks/stripe-account`. UI at `/settings/payouts`.
  - See `docs/MODULE_7D_VERIFICATION.md` "Live Verification 2026-05-11" section for full evidence.
  - **Remaining for prod launch:** rotate Stripe live keys + re-register webhook with live signing secret + re-activate Connect platform in live mode (tracked under "Rotate ALL secrets at prod cutover").

- [x] **DONE:** Implement admin dispute resolution (approve → refund, reject → release)
  - `POST /api/v1/admin/disputes/:id/approve` → DISPUTED → REFUNDED (with notes)
  - `POST /api/v1/admin/disputes/:id/reject` → DISPUTED → ESCROW_HOLD (restores release-escrow eligibility)
  - TODO: Wire actual Stripe refund in approve path once Stripe Connect is configured

---

## Module 02 Port: Auction Mechanics

- [ ] **TODO:** Wire `closeAuction` orchestrator to a Supabase repo adapter (Module 11)
  - Context: `closeOrchestrator.ts` depends on `AuctionsAggregateRepoPort`, `ListingsRepoPort`, and
    `AuctionsMetaRepoPort`. These are port interfaces — a Supabase implementation needs to be written
    when Module 11 (Settlement) is built.
  - Priority: HIGH — required before settlement flow works end-to-end
  - Depends on: Module 11 (Settlement)

- [ ] **TODO:** Consider porting `auction.offerCascade.orchestrator.ts`
  - Context: `functions/src/v1/services/orchestration/auction.offerCascade.orchestrator.ts` handles
    the reserve-not-met → next-bidder cascade flow. Not ported in Module 02 — only the primary
    close path was needed. Port when the cascade flow is required.
  - Priority: LOW
  - Depends on: Module 11 (Settlement)

---

## Module 10: Admin Dashboard Frontend

- [ ] **TODO:** Add `GET /admin/health` endpoint to the backend
  - Context: AdminHealthPage polls this endpoint every 30s but it doesn't exist in the Module 10 backend routes (index.ts only mounts `/users`, `/moderation`, `/audit-logs`). The page handles the 404 gracefully with a warning.
  - Priority: LOW — cosmetic; admin functionality works without it
  - Depends on: Backend work in a future pass

- [ ] **TODO:** Resolve AdminProtectedRoute RLS dependency
  - Context: `AdminProtectedRoute` uses the anon Supabase client to query `admin_users`. If RLS prevents users from reading their own admin_users row, valid admins will be redirected to `/`. Consider adding a `/admin/auth/verify` backend endpoint instead.
  - Priority: MEDIUM — affects admin access if RLS is restrictive
  - Depends on: RLS policy review on `admin_users` table

- [ ] **TODO:** Moderation queue listing_media join
  - Context: Moderation cards cannot show listing images because the backend query does not join `listing_media`. A note is shown in each card. Requires backend change to include media URLs in the queue response.
  - Priority: LOW — audit/moderation workflow still functional
  - Depends on: Backend route update + adminApi.ts update

---

## Module 09: Payment Hardening

- [x] **DONE:** Add `default_content_flag TEXT` column to `categories` table
  - Migration: `supabase/migrations/20260303000002_content_flag_enum_expansion.sql`
  - Pending: `npx supabase db push` + `supabase gen types` re-run

- [x] **DONE:** Add SWIMWEAR, LINGERIE, PERSONAL_ITEM, FETISH to `content_flag` DB enum
  - Migration: `supabase/migrations/20260303000002_content_flag_enum_expansion.sql`
  - Pending: `npx supabase db push` + update CascadeOrchestrator FLAG_SCORES with scores 3–5

- [ ] **TODO:** Implement real NOWPayments integration in process-payment
  - Context: Crypto path returns 501 stub. Needs NOWPAYMENTS_API_KEY + NOWPAYMENTS_IPN_SECRET, invoice creation via `POST /v1/invoice`, crypto_payments record creation.
  - Priority: LOW (user opt-in, not blocking mainstream flow)
  - Depends on: NOWPayments merchant account + API keys

- [x] **DONE:** Add Stripe transactionId to payment_intent metadata for webhook correlation
  - `StripeProcessor.ts` now builds a clean `stripeMetadata` with `transactionId`, `auctionId`, `listingId`, `sellerId`
  - `process-payment/index.ts` now sets `paymentRequest.metadata.auctionId = auction.id` before cascade

- [x] **DONE (Session E):** Fix missing `await` on `constructEventAsync` in StripeProcessor webhook handler
  - `StripeProcessor.ts` line 138: `constructEventAsync` returns `Promise<Stripe.Event>` — was missing `await`
  - Without `await`, the event variable was a Promise object, not the resolved event — webhook handling silently broken

- [x] **DONE (Session E):** Add missing type definitions to `_shared/payment/types.ts`
  - Added: `ProcessorResult`, `RefundResult`, `HealthCheckResult`, `PaymentProcessor`, `PaymentIntent`
  - Were imported by `StripeProcessor.ts`, `BaseProcessor.ts`, `PaymentCloudProcessor.ts` but never defined

- [x] **DONE (2026-05-09):** Deploy process-payment and payment-webhook Edge Functions
  - `process-payment` v17 ACTIVE (`verify_jwt: true`)
  - `payment-webhook` v18 ACTIVE (`verify_jwt: false`)
  - `release-escrow` v6 ACTIVE (`verify_jwt: true`, uses `x-release-secret` header)
  - Outstanding gate for real card processing: STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET in Supabase dashboard. Code is ready and waiting.

## Module 06: Browse & Search

- [x] **DONE (Module 14):** Add pagination to browse and search results
- [x] **DONE (Module 14):** Replace ilike search with full-text search
- [x] **DONE (Module 14):** Move sort to database level for ending soonest / price sorts

- [ ] **TODO:** Add loading skeletons to BrowsePage and SearchResultsPage
  - Context: No loading state during fetch — text placeholder only, page appears partially empty briefly
  - Priority: LOW
  - Depends on: Standalone

## Phase 5C: NFC Frontend Stub Completion (2026-05-09 follow-ups)

- [ ] **TODO:** Promote `confirmProofRaw` helper to `api.nfcConfirmProof(proofId)` in `frontend/src/lib/api.ts`
  - Context: Lane A subagent had to add an inline helper in `NfcTagDetailPage.tsx` because the api.ts client doesn't expose `POST /nfc/proof/confirm`. Backend route exists and is wired; just missing client surface.
  - Also: `nfcUploadProof` return type omits `proofId` even though the backend returns it (controller line 326). Add it.
  - Priority: MEDIUM — workaround works but breaks the encapsulation pattern.
  - File: `frontend/src/lib/api.ts`, `frontend/src/features/verification/pages/NfcTagDetailPage.tsx` (remove inline helper after promotion)

- [ ] **TODO:** Add `refetch()` to `useNfcTagDetail` hook
  - Context: Lane A's success paths (transfer, mint) currently use `window.location.reload()` because the hook has no in-place refetch. Cleaner UX after these mutations.
  - Priority: LOW — works, just ugly.
  - File: `frontend/src/features/verification/hooks/useNfcTags.ts`

- [ ] **TODO:** Include `last_scanned_at` on `GET /verify/:tokenName` response
  - Context: `VerificationPage.tsx` has a TODO comment in the scan telemetry section. The verification_events table has scan timestamps; this would surface them.
  - Priority: LOW — telemetry already shows `scan_count` and `view_count`.
  - File: `backend/src/controllers/verificationController.ts`

- [ ] **TODO:** Stream IPFS pin → mint stage progress from backend
  - Context: Lane A's mint UX flips "Pinning… → Minting…" labels on a 1.5s timer; not actually tied to backend stages. SSE or polling would make this real.
  - Priority: LOW — purely cosmetic for user trust during the ~5-30s mint window.
  - File: `backend/src/controllers/nfcController.ts` (mint endpoint), `frontend/src/features/verification/pages/NfcTagDetailPage.tsx`

---

## Module 13: NFC Verification

- [ ] **TODO:** Apply DB migration and regenerate types
  - Context: `supabase/migrations/20260301100000_nfc_verification.sql` adds `item_verifications` + `ownership_transfers` tables. After applying, run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp ...`. Then remove `(supabase.from as any)` cast in `TokenCreationPage.tsx`.
  - Priority: HIGH — required before verification feature works
  - Depends on: Supabase CLI + project credentials

- [ ] **TODO:** iOS NFC tag programming UX
  - Context: Web NFC API not supported on iOS. Current flow shows instructions to use NFC Tools app. Could improve with a deep-link to the app store or step-by-step screenshot guide.
  - Priority: MEDIUM

- [ ] **TODO:** Push notifications when item is scanned (Module 16)
  - Context: When a buyer scans an NFC-verified item, the owner could receive a push notification. Requires web push / FCM integration.

- [ ] **TODO:** Anti-counterfeit — server-side NTAG 424 DNA cryptographic SUN message verification
  - Context: NTAG 424 DNA tags generate a cryptographic SUN message in the URL on each scan. A future endpoint could verify this signature server-side using the tag's key, making tag cloning detectable.
  - Priority: LOW (future)

- [ ] **TODO:** Supabase Realtime subscription on VerificationPage for live scan count updates
  - Context: VerificationPage currently shows a static scan count fetched on load. A Realtime subscription on `item_verifications` would update the count live.
  - Priority: LOW

## Module 15: Messaging

- [ ] **TODO:** Apply DB migration and regenerate types
  - Context: `supabase/migrations/20260302120000_messaging.sql` adds `conversations` + `messages` tables. After applying, run `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts && cp ...`. Then remove `as never` casts in `ConversationsPage.tsx` and `Header.tsx`.
  - Priority: HIGH — required before messaging feature works
  - Depends on: Supabase CLI + project credentials

- [ ] **TODO:** RLS policy allows service client to bypass participant checks — validate participant in DB layer
  - Context: messagingController.ts uses service client + manual participant checks. For defense-in-depth, an RLS policy using `service_role` bypass is acceptable but worth noting.
  - Priority: LOW

- [x] **DONE (Session J):** Mobile nav menu — Messages link already in mobile drawer (was added previously); verified still present after nav refactor

- [ ] **TODO:** Message pagination — load older messages on scroll up
  - Context: `getMessages` supports `page` param but ConversationsPage only loads page 1. "Load earlier messages" UI needed for long conversations.
  - Priority: MEDIUM

- [ ] **TODO:** Unread badge count in the `useUnreadCount` hook queries ALL messages not sent by the user, not scoped to conversations the user participates in — after type regen, tighten the query to use an IN subquery on `conversations`.
  - Context: Until DB types include conversations/messages, using `as never` cast prevents the scoped query. Post-type-regen: use `.in('conversation_id', participantConvIds)`.
  - Priority: MEDIUM
