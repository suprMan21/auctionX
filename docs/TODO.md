# Authentic Materials — TODO

**Last updated:** 2026-05-30 (post-S22 close-out + cleanup sweep)

This file tracks **live, actionable items only**. Full per-session history is in Notion → Session Handoffs DB. Full pre-launch session pipeline (S22–S42) is in Feature Backlog DB. Lessons + Decisions + Ideas have their own Notion DBs.

> **Rule:** if it's done, delete it. Don't accumulate `[x]` history here — that drift is what made the previous version unreadable.

---

## 🔴 BOSS ACTION — blocking next deploy

- [ ] **SSH fix → `git push origin dev`** (carried from S19/S20/S21/S22). Local `dev` is N commits ahead of `origin/dev`. Once pushed, App Runner auto-deploys backend; frontend deploy block lives in each session's verification doc.
  - Symptom: `git fetch / push` fails `Permission denied (publickey)` against `git@github.com:`. `SSH_AUTH_SOCK` points at a non-1Password agent.
  - Action: re-export `SSH_AUTH_SOCK` to the 1Password SSH agent socket OR `ssh-add` the GitHub key. Then push.

- [ ] **Merge `feature/session-22-yoti` → local `dev`** + apply migration `20260530000002_yoti_integration.sql` to staging. Branch is 13 commits, tsc clean, vitest 48/21 (no regressions). See `docs/SESSION_22_VERIFICATION.md`.

- [ ] **Register Stripe `payment-webhook`** in Stripe Dashboard → Developers → Webhooks. URL `https://pmlofthmobglcfkqjtru.supabase.co/functions/v1/payment-webhook`, events `payment_intent.succeeded` + `payment_intent.payment_failed`. Then:
  ```bash
  supabase secrets set STRIPE_WEBHOOK_SECRET="$(op read 'op://AM_Development/Stripe/webhook-secret')" --project-ref pmlofthmobglcfkqjtru
  ```
  Closes the last synthetic SQL step from S18.

- [ ] **S21 manual E2E** — Stripe Elements payment with test card `4242 4242 4242 4242` against staging. Expected: `payment_intent.succeeded` → `settlements.status=ESCROW_HOLD` → DKIM-verified Postmark email. S21 status stays pending until this clears.

- [ ] **Staging smoke test post-S20-deploy** — 7-step checklist in `docs/SESSION_20_VERIFICATION.md` "Staging verification" section.

---

## 🟡 NEXT SESSIONS (ready to plan)

- [ ] **S23 — Postmark / SMTP** — in progress (started 2026-05-30, immediately after S22.5 shipped). Wire `TODO(S23)` stubs in `backend/src/controllers/yotiVerificationController.ts:378,381`, sweep other unwired notification call sites, populate Postmark env on App Runner staging, DKIM-verify sender domain, vitest coverage for the new send paths.

- [ ] **Unmentionables-frontend scaffold** — Feature Backlog entry. Per 2026-05-29 Locked decision: separate Vite + S3 + CloudFront + domain; shared backend. Blocks any Unmentionables UI work (age-gate, NSFW browse).

- [ ] **Brand rename project-wide** — UI now reads "Authentic Materials" / "Unmentionables" but `brand_type` DB enum is still `AUCTIONX | UNMENTIONABLES`. A real rename (migration + backend + frontend + landing pages + tests) needs a Decisions DB entry + dedicated session. Currently retained as legacy schema-locked identifier per CLAUDE.md.

---

## 🟢 PRE-PROD CROSS-CUTTING (not blocking individual sessions)

- [ ] **Migrate backend off AWS App Runner** (MEDIUM)
  - App Runner is closed to new customers; existing customers can keep running but no new features will land. Target: Amazon ECS Express Mode (Fargate). Recommended blue/green with Route 53 weighted routing. AWS migration guide: https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html
  - Risk: source-based deploys need a Dockerfile + ECR push step; check current config first.

- [ ] **Rotate ALL secrets at prod cutover** (HIGH — production safety). Includes: `RELEASE_ESCROW_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, Stripe `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_WEBHOOK_SECRET` (live keys), Postmark `POSTMARK_SERVER_TOKEN`, payment-processor live keys when approved (PaymentCloud, Signature, CCBill, NOWPayments).
  - Rotation order: `docs/audits/2026-05-10-supabase-jwt-rotation-audit.md`.

- [ ] **Execute Stages 0–4 of the JWT rotation plan** (`docs/audits/2026-05-10-supabase-jwt-rotation-audit.md`). Stage 1 (staging probe) is the unblocker for the Session K mystery — must capture HTTP traces. Don't proceed past Stage 1 without green light or documented fix.

- [ ] **Migrate App Runner secrets** from `RuntimeEnvironmentVariables` (plaintext) → `RuntimeEnvironmentSecrets` (Secrets Manager refs). Includes AWS access key, Stripe keys, Supabase service-role JWT, MINTER_PRIVATE_KEY, SETTLE_SECRET, RELEASE_ESCROW_SECRET, Pinata JWT. Align with cutover-time rotation above.

- [ ] **Activate Sentry error tracking** (HIGH). `frontend/src/lib/errorTracking.ts` has Sentry calls commented out. When ready: `npm install @sentry/react`, set `VITE_SENTRY_DSN` env var, uncomment init + captureException calls.

- [ ] **Create `og-image.png`** — 1200×630px branded image. `frontend/index.html` references it for Open Graph / Twitter Card. (MEDIUM)

- [ ] **Sitemap generation cron** — `scripts/generateSitemap.ts` is a stub. Wire to CI/CD or daily cron once Supabase creds are in the build env. (LOW)

- [ ] **Seed real E2E test users in Supabase** — E2E specs (`auth.spec.ts`, `admin.spec.ts`, `auction.spec.ts`) require `TEST_USER_EMAIL` and `TEST_ADMIN_EMAIL` to point to real users. Create via Supabase dashboard → Authentication → Users; set creds in `.env.test`. (HIGH for E2E coverage)

- [ ] **Replace in-memory admin rate limit Map** with Redis or Supabase-backed store. Current impl resets on server restart. (MEDIUM)

- [ ] **CI pipeline for automated test runs** — `package.json` has `test:all` / `test:e2e` / `test:api` / `test:mechanics`. Wire to GitHub Actions on PRs. (MEDIUM)

- [ ] **WCAG 2.2 AA axe scan** on the four landing pages (`/collector`, `/creator`, `/am-sealed`, `/am-proof`). Built with proper contrast + semantic HTML but not yet scanned. (HIGH per session checklist)

- [ ] **`payment_window_expiring` pg_cron trigger** — preference column + docs exist but no job currently fires the notification. Should check offers expiring within ~5 minutes. (MEDIUM)

- [ ] **WaitlistCapture / landing page deploy verification** — already deployed 2026-05-09, re-verify nothing has rotted.

---

## 🟢 FOLLOW-UPS surfaced 2026-05-21

- [ ] **1Password test buyer credential mismatch** — `op://AM_Development/App Secrets/test-user-password` doesn't authenticate the no-hyphen `test@authenticmaterials.com` account on staging. Either reset that account's password + update vault entry, or add a separate vault entry for the no-hyphen account. Affects Playwright auth-flow test + automated buyer-flow E2E.

- [ ] **Decisions DB date property has embedded colons in name** — breaks API expanded date format (`date:<column>:start`). Rename column to clean name (e.g., "Decision Date") or document workaround (date in body text). Affects future agents pushing Decisions via API.

- [ ] **`scripts/.env.op` points at localhost** — fine for local dev but breaks `op run --env-file .env.op -- playwright test` against staging without a per-run override. Consider splitting into `.env.op.local` + `.env.op.staging`, or `STAGING=1` env switch.

---

## 🟢 SMALL TECH DEBT (LOW priority, do opportunistically)

- [ ] Promote `confirmProofRaw` helper → `api.nfcConfirmProof(proofId)` in `frontend/src/lib/api.ts`; remove inline helper in `NfcTagDetailPage.tsx`; add missing `proofId` to `nfcUploadProof` return type.
- [ ] Add `refetch()` to `useNfcTagDetail` hook (replaces `window.location.reload()` on transfer/mint success).
- [ ] Include `last_scanned_at` on `GET /verify/:tokenName` response (TODO comment in `VerificationPage.tsx`).
- [ ] Stream IPFS pin → mint stage progress from backend (SSE or polling — current UX uses fake 1.5s timer).
- [ ] Replace env-var-presence check in `backend/src/routes/admin/health.ts:40-45` with real S3 connectivity (`HeadBucket` + timeout).
- [ ] Fix `backend/src/lib/s3.ts:4` default `AWS_REGION` to `'us-east-2'` (currently `'us-east-1'`; not breaking but misleading).
- [ ] Stash `settle_secret` into `vault.secrets` for parity with `release_escrow_secret` / `reconcile_escrow_secret`.
- [ ] Side menu UX — Boss reported menu renders very small and won't fully open on staging. Repro + fix.
- [ ] Decide whether to keep the `[E2E-TEST-2026-05-11]` rows on prod or run cleanup SQL in `MODULE_7D_VERIFICATION.md`.
- [ ] Module 14: explicit `ts_rank` ordering for relevance sort; saved-search email notifications; BrowsePage category-grid pagination.
- [ ] Module 13: iOS NFC tag programming UX (deep-link to NFC Tools or screenshot guide); push notifications on scan; server-side NTAG 424 DNA SUN message verification; Supabase Realtime subscription on VerificationPage for live scan count.
- [ ] Module 15: message pagination (load older on scroll up); tighten `useUnreadCount` to scope by participant conversations once types are regenerated.
- [ ] Module 10: `GET /admin/health` endpoint; resolve `AdminProtectedRoute` RLS dependency; moderation queue `listing_media` join.
- [ ] Module 09: real NOWPayments integration in process-payment (currently 501 stub; user opt-in only, not blocking mainstream).
- [ ] Add loading skeletons to BrowsePage + SearchResultsPage.
- [ ] Resend email integration (`emailSender.ts` is a stub — replace stub body with `resend.emails.send(...)`).
- [ ] Offline check before sending MESSAGE_RECEIVED email (skip if recipient active in last 5min via presence/Realtime heartbeat).
- [ ] Module 02 port: wire `closeAuction` orchestrator to Supabase repo adapter (Module 11); port `auction.offerCascade.orchestrator.ts` if cascade flow needed.

---

## 📚 Notes

- **`docs/` directory is bloated** — 83 files including many one-shot `SESSION_N_*` verification docs. Consider archiving everything pre-S15 into `docs/archive/` to make the live working set easier to scan. Not blocking.
- **Feature Backlog DB** (`collection://07ce72ba-6432-45b8-9563-418e44a4ff7e`) holds the canonical S22–S42 pre-launch session list. Riley 3.0 orchestrator plan: `~/.claude/projects/.../memory/am_orchestrator_plan.md`.
- **Reconciliation note (2026-05-09, still valid):** previous TODO entries about "Apply DB migration and regenerate types" for modules 12/13/14/15 were stale. All migration files in `supabase/migrations/` are already applied to `pmlofthmobglcfkqjtru` (verified via `mcp__plugin_supabase_supabase__list_migrations`). Module-12 / 13 / 15 / 14 sections previously listed migration TODOs — those are gone now. The `as never` / `as any` casts they referenced can be removed and types regenerated whenever convenient.
