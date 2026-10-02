# Authentic Materials — TODO

**Last updated:** 2026-10-01 (S-DB1 applied to staging)

This file tracks **live, actionable items only**. Per-session history is in Notion → Session Handoffs DB.
The pre-launch pipeline lives in the Feature Backlog DB. Lessons, Decisions and Ideas have their own DBs.

> **Rule:** if it's done, delete it. Don't accumulate `[x]` history here.

> **2026-09-18 token-first pivot (Locked):** the auction marketplace and the Unmentionables stream are
> **parked** — deployed but dormant. Everything marketplace-shaped that used to live in this file has moved
> to §Parked below. Re-activating any of it requires a new Decisions DB entry.

---

## 🔴 BOSS ACTION

### ✅ S-DB1 — done 2026-10-01

The "no egress" blocker was misdiagnosed: the free-plan staging project had **auto-paused**
(`supabase projects list` → `INACTIVE`, host NXDOMAIN). Boss restored it; then:
`20260919000001` + `20260919000002` applied, types regenerated into both copies (they had also
drifted from each other), the drift-guard exemption list emptied (proven to still fire), criterion
11 checked live (view exposes no owner/user/UID column; anon REST read works; anon still gets
nothing from `nfc_tags.aes_key_enc` and `permission denied` on `ownership_proofs`), S-ISO1 crons
confirmed gone (`cron.job` empty). Extra: `20261001000001` revokes the default-privilege
REFERENCES/TRIGGER/TRUNCATE that anon/authenticated had inherited on `public_tag_provenance`.

- [ ] **Decide on Supabase Pro** — staging will auto-pause again after ~7 idle days on the free plan.

### S-NFC3 — remaining (not database)
- [ ] **Resolve the duplicate "Stripe" 1Password items** before any token fee is charged. The vault
      has **three**: two LOGIN (`4jjqf5cazuxgjnk23lpwstzqoe`, `sejob6wh6bcjs4eyoimp4ugkk4`) and one
      API_CREDENTIAL (`tbocfigu7g5kfogpyuddhwpqgu`). `op://AM_Development/Stripe/...` is ambiguous
      across them, so backend and frontend can silently resolve to different accounts.
- [ ] **Create the two new secrets** (references already in `backend/.env.op`):
      ```bash
      openssl rand -base64 32 | op item create --category=password \
        --title='Ownership Salt Key' --vault=AM_Development 'key[password]=-'
      openssl rand -base64 32 | op item create --category=password \
        --title='Security' --vault=AM_Development 'log-hmac-key[password]=-'
      ```
      ⚠️ `OWNERSHIP_SALT_KEY` must be **backed up before any real claim in production** — losing it
      means no owner can ever re-download their Receipt.
- [ ] **Register the Stripe token-fee webhook** (sandbox first): `POST /api/v1/webhooks/stripe-token-fees`,
      event `payment_intent.succeeded`. Put the `whsec_...` in
      `op://AM_Development/Stripe/token-fee-webhook-secret`, then paste the **literal** value into
      App Runner (it does not resolve `op://`).
- [ ] **Confirm CAD presentment on the sandbox account.** Shipped USD-only behind
      `FEATURE_CAD_PRESENTMENT=false`; if CAD is available set it plus `USD_CAD_RATE`.

### S-ISO1 carry-over

- [ ] **Stripe dashboard (S-ISO1 §8)** — disable the Stripe **Connect** webhook endpoint; confirm no
      marketplace webhook is registered.

---

## ✅ S-NFC3 — CODE DONE AND MERGED (2026-10-01)

Merged to `dev` (`e5531f4`) and pushed; verified against the remote. Also on `dev`: the
`feature/s-nfc-ios-testflight` merge, which fixes the mobile 401-on-login (stale Supabase
publishable key) and the legacy `com.authenticmaterials.auctionx` bundle id.

Verification: `docs/S_NFC3_VERIFICATION.md` (v1.1). 252 tests pass, tsc 0 errors both sides,
0 boundary violations across 121 modules. Database work done in S-DB1 (above).

A post-merge fix (`9762429`) corrected two column names that would only have failed against the
real database: `c.username` (no such column — it is `display_name`) would have aborted the
`CREATE VIEW` and taken the whole migration with it, and `users.country` (no such column) left the
CAD path with nothing to read. Guarded now by `schemaColumnDrift.test.ts`.

Two things deliberately deferred, both behind default-off flags:
- **2FA** (`FEATURE_REQUIRE_2FA=false`) — there is still no MFA enrollment path anywhere in the
  product, so turning it on would make `/claim` and `/transfer/:id/complete` unreachable.
  **S-2FA is a hard prerequisite** before it can default true in production.
- **CAD presentment** (`FEATURE_CAD_PRESENTMENT=false`) — unconfirmed on the sandbox account, so
  per the TODO's own instruction this shipped USD-only. Criterion 5's CAD half is deferred.

Also outstanding: the **$10 re-issue charge**. `POST /reissue-request` prices and records the
request; no PaymentIntent is created, because the brief routes re-issue through admin review first
and charging before review would mean refunding every rejection. The charge belongs with the admin
approval endpoint, which was not in this session's scope.

---

## 🟢 NEXT SESSION — S-NFC3.5 (real AN12196 SDM)

**No physical chip may be encoded for customers until this ships.** The SUN crypto S-NFC3 exercises
is the S-NFC2 codec, not the production SDM scheme.

## 🟡 AFTER S-NFC3.5

Order per the Locked token-first pivot:
S-NFC3-FE (the token lifecycle frontend, split out of S-NFC3) → S-NFC2 Ph2 (physical encode) →
S-ANCHOR1 (Ownership Registry on Base) → S-NFC4 (external API; its fee section is outdated, use flat
$2.50) → S-TIER1 (Premier + token checkout) → S-SEC1 (red team, hard gate before any public token
sale) → S-SEC2 (external pentest).

**S-2FA (MFA enrollment + AAL2 step-up)** has no fixed slot but gates `FEATURE_REQUIRE_2FA` in
production, so it must land before any real token sale.

---

## 🔵 HOUSEKEEPING

- [ ] **Route Registry is 6 months stale** (v1.1, 2026-03-07) yet an Every-Session lesson names it the
      authority for enum values. It predates S-NFC1.5, S-NFC2 and the pivot. Bump to v2.0.
- [ ] **`public.users` is world-readable** — `"Anyone can view users" FOR SELECT USING (true)`
      (`20260201042342_remote_schema.sql:1537`). A privacy problem under anonymous token ownership, though
      not key material. Needs a view-based replacement. **Tracked for S-SEC1.** Its `UPDATE` policy also
      self-references `users`, violating the "RLS must never self-reference" lesson.
- [ ] **Mobile hardcodes the Supabase publishable key** in `mobile/lib/core/constants/api_constants.dart`
      — in git history; should move to `--dart-define`.
- [ ] **`op` CLI integration** — the desktop "Integrate with 1Password CLI" toggle is on but does not reach
      Claude Code's shell, and an inherited `OP_SESSION_*` expires after 30 idle minutes. Launch dev
      sessions with `amCode`, not `cCode`.

---

## ⏸️ PARKED (marketplace + Unmentionables)

Frozen by the token-first pivot. **Not cancelled** — re-activation needs a new Decisions DB entry.
Reversal procedure: `docs/PARKED_MARKETPLACE.md`.

- S24 shipping + the 5 carrier outreach items · S25.5 dispute-resolution UI · S26–S30 marketplace admin
- Stripe `payment-webhook` dashboard registration · S21 manual E2E with a test card
- Unmentionables frontend scaffold + age-gate UI
- Payment cascade processors beyond Stripe
- Project-wide brand rename (`brand_type` stays legacy `AUCTIONX`, schema-locked)
