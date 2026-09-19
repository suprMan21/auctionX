# Authentic Materials — TODO

**Last updated:** 2026-09-19 (post S-ISO1)

This file tracks **live, actionable items only**. Per-session history is in Notion → Session Handoffs DB.
The pre-launch pipeline lives in the Feature Backlog DB. Lessons, Decisions and Ideas have their own DBs.

> **Rule:** if it's done, delete it. Don't accumulate `[x]` history here.

> **2026-09-18 token-first pivot (Locked):** the auction marketplace and the Unmentionables stream are
> **parked** — deployed but dormant. Everything marketplace-shaped that used to live in this file has moved
> to §Parked below. Re-activating any of it requires a new Decisions DB entry.

---

## 🔴 BOSS ACTION

- [ ] **Push `57f82b9`** — `fix(s-iso1): pin verify_jwt for own-auth functions; record staging verification`.
      `git push origin feature/s-iso1-marketplace-isolation` (and `dev` after the merge).
- [ ] **Confirm the marketplace crons are gone** — S-ISO1 acceptance criterion 4, the last one open. The
      `cron.unschedule` block carries an exception guard that can skip silently, so the grants applying
      does not prove it ran:
      ```sql
      SELECT jobname, schedule FROM cron.job;
      -- expect: neither 'release-escrow-tick' nor 'reconcile-escrow-daily'
      ```
- [ ] **Stripe dashboard (S-ISO1 §8)** — disable the Stripe **Connect** webhook endpoint; confirm no
      marketplace webhook is registered.
- [ ] **Create `SECURITY_LOG_HMAC_KEY`** for the S-NFC3 security-event addendum:
      ```bash
      openssl rand -base64 32 | op item create --category=password --title='Security' \
        --vault=AM_Development 'log-hmac-key[password]=-'
      ```
      Reference `op://AM_Development/Security/log-hmac-key` goes in `backend/.env.op`. Until it exists,
      `to_email_hash` is omitted rather than failing.

---

## 🟢 NEXT SESSION — S-NFC3 rev 2 (Tag Management API)

Brief: https://app.notion.com/p/3843baf6966481448f1bcb6ad07174a9
Addendum (in scope): https://app.notion.com/p/3df3baf6966481e6b01cca8711acffec

Scope confirmed with Boss: **backend + tests only.** Frontend is a separate session.

- [ ] `backend/src/lib/security/securityEvent.ts` **first**, then emit per route — no batch retrofit.
- [ ] Migrations split per the enum lesson:
      `20260918000001_nfc_lifecycle_enum.sql` (values only) then `20260918000002_nfc_tag_management.sql`.
      **Corrected against the real schema:** the enum is `nfc_lifecycle_status`, not
      `tag_lifecycle_status`; `RELEASED` already exists; **`SUSPENDED` is missing and must be added**;
      `transfer_type` needs `RELEASE` + `REISSUE` (`GIFT` exists); reuse `nfc_tags.sun_counter` rather than
      adding `last_counter`; `ownership_transfers` already has `tag_id`, `status`, `completed_at`.
- [ ] 11 endpoints, every static route before `/:tagId`.
- [ ] Stripe token-fee webhook — raw body **before** `express.json()`, own signing secret, transfer
      completes **only** on `payment_intent.succeeded`.
      **Stripe is on SANDBOX/test tokens** (confirmed by Boss 2026-09-19). Per the locked
      sandbox-in-staging pattern, wire the token-fee flow end-to-end against sandbox in staging; prod keys
      swap only at prod cutover. Publishable and secret keys must come from the **same** account
      (Every-Session lesson) — pair the sandbox keys, don't mix a sandbox pk with a live sk. Test cards
      only via `pm_card_visa`, never raw PANs.
      Open question carried into S-NFC3: confirm CAD presentment is available on the sandbox account
      before committing to the Stripe-presentment FX approach Boss chose; if not, ship USD-only and defer
      CAD with a note.
- [ ] Ownership ID + Receipt: generate and store only. Anchoring is S-ANCHOR1.
- [ ] `require2FA` behind `FEATURE_REQUIRE_2FA=false` (see blocker below).

### ⚠️ Hard prerequisite before 2FA can be enforced in prod
**There is no MFA enrollment anywhere in the product** — zero hits for `mfa|aal|totp` across
`backend/src`, `frontend/src` and all migrations. The locked decision makes 2FA mandatory before any claim
or transfer completion, so a new **S-2FA — MFA enrollment + AAL2 step-up** session has to land before
`/claim` and `/transfer/:id/complete` can go live.

---

## 🟡 AFTER S-NFC3

Order per the Locked token-first pivot:
S-NFC3.5 (real AN12196 SDM — **no physical chip may be encoded for customers until this ships**) →
S-NFC2 Ph2 (physical encode) → S-ANCHOR1 (Ownership Registry on Base) → S-NFC4 (external API; its fee
section is outdated, use flat $2.50) → S-TIER1 (Premier + token checkout) → S-SEC1 (red team, hard gate
before any public token sale) → S-SEC2 (external pentest).

---

## 🔵 HOUSEKEEPING

- [ ] **Route Registry is 6 months stale** (v1.1, 2026-03-07) yet an Every-Session lesson names it the
      authority for enum values. It predates S-NFC1.5, S-NFC2 and the pivot. Bump to v2.0.
- [ ] **`database.types.ts` regen** — both copies were behind S-NFC1.5 and differed from each other.
      Regen after the S-NFC3 migrations, into **both**, stripping the hint tag:
      ```bash
      npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru \
        | sed '/^<claude-code-hint/d' > frontend/src/types/database.types.ts
      cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
      ```
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
