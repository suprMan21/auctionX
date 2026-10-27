# Authentic Materials — TODO

**Last updated:** 2026-10-27 (S-2FA Ph2 + Ph2b live on staging, flags off; S-ANCHOR1 on hold for the hardware wallet)

This file tracks **live, actionable items only**. Per-session history is in Notion → Session Handoffs DB.
The pre-launch pipeline lives in the Feature Backlog DB. Lessons, Decisions and Ideas have their own DBs.

> **Rule:** if it's done, delete it. Don't accumulate `[x]` history here.

> **2026-09-18 token-first pivot (Locked):** the auction marketplace and the Unmentionables stream are
> **parked** — deployed but dormant. Everything marketplace-shaped that used to live in this file has moved
> to §Parked below. Re-activating any of it requires a new Decisions DB entry.

---

## 🔴 BOSS ACTION

### S-2FA (2026-10-27)
Ph1 backend, Ph2 screens and Ph2b (24 h cool-off, password/email DB lock) live on staging, all three flags off.
`docs/S_2FA_PH1_VERIFICATION.md`, `docs/S_2FA_PH2_VERIFICATION.md`. Supabase Secure password + email change: on.
- [x] Frontend deployed; daily admins enrolled (2026-10-27). super_admin YubiKeys wait for Ph4 (attestation +
      AAGUID allowlist may need re-registering).
- [ ] Regenerate `database.types.ts` (migrations `20261027000009/10` added columns + `auth_change_permits`).
- [ ] **Ph3**: two-admin approval; email-code recovery (72 h hold, 7-day freeze, backup email); Postmark staging
      security server (tracking off, retention 7 d, token in 1Password); release + transfer-completed owner emails.
- [ ] **App Runner env var cap** (2 slots left, 2026-10-27): Boss deletes vars equal to defaults (`WEBAUTHN_RP_NAME`,
      `MFA_SESSION_TTL_HOURS`, every `FEATURE_*=false`). Ph3: `WEBAUTHN_ORIGINS` defaults to `https://<WEBAUTHN_RP_ID>`;
      move secrets into one Secrets Manager JSON secret read at boot by `am-backend-staging-instance` (one env var).
- [x] 2026-10-27: `admin@` has authenticator app + passkey "adminkey1" (synced; waits until 2026-10-28 18:46 EDT).
      Fix was a leading space in the `WEBAUTHN_RP_ID` name. `admin2@`: passkey (no wait) + 10 backup codes.
- [ ] Ph3 tidy-up: why App Runner has `AWS_ACCESS_KEY_ID` (should be the instance role); confirm NFT vars are gone;
      delete the dead NFT mint code (`services/nfc/nftMinting.ts`, `pinataService.ts`, `/nfc/mint`).
- [ ] Ph4: phones (iOS Safari, Android Chrome), then flags in order: `FEATURE_REQUIRE_2FA` → `FEATURE_REQUIRE_ADMIN_2FA` → `FEATURE_REQUIRE_STEP_UP`.

### Account types (2026-10-27)
- [ ] `scripts/deploy-frontend.sh staging`, then click through: sign up a throwaway as **A creator** (lands on
      Account type); Admin → Accounts → Type filter; test2@ → **Change account type…** → Creator now, skip the ID
      check (badge "Creator (set by staff)"), then back to Collector. `docs/ACCOUNT_TYPES_VERIFICATION.md`.

### S-ANCHOR1 Ph1 — testnet setup (on hold until the hardware wallet arrives, ~2026-10-28)
- KMS writer key done + funded. First deploy `0xC74C…913d` is **abandoned** (its owner was the faucet's address).
- [ ] Set up the hardware wallet; send Claude the address from its app's **Receive** screen (not from Basescan).
- [ ] Faucet a new throwaway deployer (Claude makes it) → Claude redeploys → App Runner `ANCHOR_*` env (incl.
      `ANCHOR_LOW_BALANCE_WEI=20000000000000`) → Vault `anchor_tick_secret` (no trailing newline) →
      `gh label create anchoring --repo suprMan21/auctionX` → push `dev`. Runbook: `docs/S_ANCHOR1_PH1_VERIFICATION.md`.
- [ ] Rotation drill with the hardware wallet on Basescan (runbook step 9).
- [ ] Optional: Etherscan API key so the contract source can be verified on Basescan.

### Verified Creator OAuth (DR-3, 2026-10-26)
Source: Notion "OAuth Platform Approval Matrix v1.0" (https://app.notion.com/p/4053baf696648120be1af1894ffbe9b5).
- [ ] **Confirm or change the Tier 1 list** (Decisions DB, Proposed): Twitch, TikTok, Instagram, YouTube;
      X Tier 2 behind a flag + Discord; drop Facebook and Reddit.
- [ ] **Decide where the Verified Creator flow lives on authentic-materials.com.** TikTok, Google and Meta
      reviews need a real site + privacy policy + a reachable demo on the production domain; the public build
      bars API calls today (`publicSite.test.ts`).
- [ ] **Start Meta Business Verification** for The Craving Company Inc. (legal-name document, e.g. articles
      of incorporation or CRA Business Number record, plus one showing address or phone; up to ~14 business days).

### S-NFC3 — remaining (not database)
- [ ] **Resolve the duplicate "Stripe" 1Password items** before any token fee is charged. The vault
      has **three**: two LOGIN (`4jjqf5cazuxgjnk23lpwstzqoe`, `sejob6wh6bcjs4eyoimp4ugkk4`) and one
      API_CREDENTIAL (`tbocfigu7g5kfogpyuddhwpqgu`). `op://AM_Development/Stripe/...` is ambiguous
      across them, so backend and frontend can silently resolve to different accounts.
- `Ownership Salt Key` (staging): 1Password is the only copy, and that's enough for staging (Boss, 2026-10-03).
  **Production:** the salt envelope moves to AWS KMS at launch, so there is no raw key to back up.
  See `docs/LAUNCH_CHECKLIST.md` §4.
- [ ] **Optional: `Security/log-hmac-key`** (without it, `to_email_hash` is just omitted from logs). Piping into
      `op item create` does NOT work (stdin is read as a JSON template), so use a variable:
      ```bash
      KEY="$(openssl rand -base64 32)" && op item create --category=password \
        --title='Security' --vault=AM_Development "log-hmac-key[password]=$KEY" >/dev/null && unset KEY
      ```
      Then paste the literal into App Runner as `SECURITY_LOG_HMAC_KEY`.
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

## ✅ Shipped 2026-10-01/02 (details in Notion: Session Handoff + S-NFC3.5 Verification)

S-DB1 (S-NFC3 migrations live) · S-NFC3.5 real AN12196 SDM with KMS-derived keys (deployed, KMS confirmed live) ·
`public_tag_provenance` enumeration hole closed · `/replace` staff-only.

## ✅ Shipped 2026-10-03 — S-NFC2 Ph2 (physical encode)

First real NTAG 424 DNA (`chip_001`) encoded under the staging KMS roots; phone tap → `tapcheck` HTTP 200, valid.
Details: `docs/S_NFC2_PH2_VERIFICATION.md`. Runbook: `tag-encoder/README.md` → "Physical encode".
- [ ] **Boss: confirm** audit ledger keys on tag id (not UID). (K1/K4: now set on every v2 chip — S-NFC-ID.)
- Fixed 2026-10-26: public `GET /nfc/:tagId` and `/nfc/by-uid` returned tap IPs, browsers, tap links, account IDs and the full UID; now public-safe only, and the UID log is suffix-only (`legacyNfcPublic.test.ts`).

## ✅ Shipped 2026-10-03 — S-NFC3-FE Phase 1 (tap, verify, claim, My Tokens)

Live on staging: `chip_001` tapped → genuine/unclaimed → claimed by test@ → one current Ownership ID
(`0xcbfa9f6e…`), public lookup resolves. Details: `docs/S_NFC3_FE_VERIFICATION.md`.
- [ ] Follow-ups: mobile drawer still shows
      "Search listings" + empty dividers while the marketplace is parked; one unexplained backend test failure
      (1 in ~45 runs, name not captured; watch for it).

## 🟡 AFTER

**S-NFC3-FE Phase 2: ✅ live 2026-10-03** (first paid transfer test@ → test2@ completed). Recipient email on initiate + cancel ✅ live
2026-10-05 (`docs/S_NFC3_FE_RECIPIENT_EMAIL_VERIFICATION.md`). → **S-ADMIN1 Ph1 ✅ live 2026-10-05** → **chip identity
fix: S-NFC-ID ✅ live 2026-10-07** (KDF v2 per-chip serial + K1/K4; duplicate-UID finding was a suffix misread —
`docs/S_NFC_ID_VERIFICATION.md`) → **S-ADMIN1 physical reset test ✅ 2026-10-09** (chip_002 → chip_003) → **S-ADMIN1 Ph2 ✅ 2026-10-09** (re-issue chip_003 → chip_004, $10) → S-ADMIN1
Ph3a ✅ 2026-10-25 (stuck-payment queue + GitHub Issues) → admin search + token names ✅ 2026-10-24 → Ph3b (admin pricing + vouchers) ✅ 2026-10-24 → S-SEC hotfix (RPC + users lockdown) ✅ 2026-10-25 → S-ADMIN2 Ph1 (users/roles) ✅ 2026-10-26 →
S-ANCHOR1 (Ownership Registry on Base) → S-NFC4 (external API; its fee section is outdated, use flat $2.50) →
S-TIER1 (Premier + token checkout) → S-SEC1 (red team, hard gate before any public token sale) → S-SEC2 (external pentest).

Deferred behind default-off flags since S-NFC3: **2FA** (`FEATURE_REQUIRE_2FA`, needs S-2FA) and **CAD presentment**
(`FEATURE_CAD_PRESENTMENT`). The **$10 re-issue charge** moves into S-ADMIN1's approval flow.

**Production KMS keys (decide at launch):** create a `-prod` pair (`am-tag-sdm-prod`, `am-tag-admin-prod`),
never shared with staging. Decide **multi-Region vs single-Region at creation**, because it cannot be changed later and chip
keys cannot be re-derived without the master. Multi-Region is needed if prod must survive a us-east-2 outage.

**S-2FA** (in-house passkeys + authenticator app + backup codes, step-up, two-admin approval): Ph1 backend + Ph2 screens + Ph2b ✅ live
2026-10-27 (flags off) → Ph3 two-admin approval → Ph4 phones + flags. Must land before any real token sale.

---

## 🚀 Frontend deploy (two separate sites since 2026-10-12)

| Site | Serves | Command |
|---|---|---|
| Staging (`d1bwev65w7rqzl.cloudfront.net`) | the whole app | `scripts/deploy-frontend.sh staging` |
| Public (`authentic-materials.com`) | landing pages only | `scripts/deploy-frontend.sh public` |

Claude's shell cannot use the `auctionx` profile (op plugin needs a TTY), so Boss runs them. Add `--dry-run` to build,
run the checks and print the AWS commands without running them.

Switched 2026-10-12: the public domain reads its own bucket `am-frontend-prod-904183418667`; a staging deploy no longer
touches it. Setup record and rollback: `infra/s3/am-frontend-prod-904183418667/README.md`; checks in
`docs/SESSION_SITE1_VERIFICATION.md`. Logo/icons: the header mark and favicon use the real AM path; regenerate the PNG
icons with `cd frontend && node scripts/make-icons.mjs` if the mark changes.

Backend: after `git push origin dev`, run `scripts/verify-backend-deploy.sh` (pushes do not always deploy).
Deploy order: backend (push `dev`, wait for App Runner **Running**) BEFORE frontend.

## 🛠️ ADMIN CONSOLE (new section, Boss 2026-10-02)

Re-scoped from the parked S26/S28 for the token platform (Decisions DB, 2026-10-02). Lands **before S-TIER1**: no public
token sale without admin tooling.

- **S-ADMIN1 Ph1 ✅ live 2026-10-05, verified on silicon 2026-10-09** (`docs/S_ADMIN1_VERIFICATION.md`).
- **S-ADMIN1 Ph2 ✅ live + verified on silicon 2026-10-09** (`docs/S_ADMIN1_PH2_VERIFICATION.md`): owner-only re-issue for a
  chip coming loose (live tap + live-camera photos, private bucket), web-only $10, approve / waive / reject / fulfil,
  serial-suffix confirmation. Owner override dropped (Boss).
  - [ ] **Encoder auto-naming** ✅ live on staging 2026-10-10 (`docs/S_ENCODER_AUTO_NAMING_VERIFICATION.md`): name reserved
        on the backend before any chip write, shown in the admin console, `chip_` prefix reserved for the sequence.
        **Open:** the no-name path has not run on a real chip yet (a chip was enrolled as `chip_` by a manual name).
        Next time a chip is needed anyway, encode with no `--item`/`--token` and expect `chip_005`.
  - [ ] Boss (optional): remove inline policy `ReissueEvidenceStaging` from IAM user `auctionx-s3-access` (unused; the
        instance role has it).
  - [ ] Boss: decide on App Runner auto-deploy (pushes did not reliably deploy on 2026-10-09).
  - [ ] Pre-launch: media bucket `auctionx-media-prod-cl` is publicly readable by path (`PublicReadGetObject`); fine for
        listing images, review before launch (LAUNCH_CHECKLIST already flags its policy).
- **S-ADMIN1 Ph3a: stuck payments ✅ live + verified with sandbox money 2026-10-19/25**
  (`docs/S_ADMIN1_PH3A_VERIFICATION.md`). Queue at `/admin/stuck-payments`, Re-apply (support+), refund (admin+),
  10-minute sweep, one GitHub Issue per incident. Missed webhook → sweep applied (Issue #2); paid-then-cancelled →
  refunded (Issue #3); cron ticking. `chip_004` now owned by **test@**.
  - [ ] Re-apply not run live (unit tests + live SQL only).
  - [ ] Follow-ups (small): `token_fee_stuck` at ERROR for born-resolved incidents → WARN; close comment not
        recorded / `noteIncidentClosed` swallows errors silently.
  - [ ] Boss: rotate `GITHUB_ISSUES_TOKEN` before it expires (no Issues are filed after it lapses).
- **Admin search + token names ✅ and `trust proxy` ✅ live + verified 2026-10-24**
  (`docs/S_ADMIN1_SEARCH_TRUST_PROXY_VERIFICATION.md`). Search audit-logged first; rate limits now per client.
- **Admin console UX-1 ✅ 2026-10-26** (`docs/ADMIN_UX1_VERIFICATION.md`): wording pass (Token / Account / Staff role /
  Free transfers / Re-issue, plain labels, friendly sign-in errors), Needs attention + nav badges, console search,
  accounts as links, audit time filter, free transfers no longer re-audited. Rule: every task in 2 to 3 clicks (Locked).
  - [x] **UX-2 ✅ live on staging 2026-10-26** (`81cb95b`, `docs/ADMIN_UX2_VERIFICATION.md`): shared AdminTable,
        search on Enter + out of URL, chip combobox, role radios, price card buttons, re-issues open on Needs action,
        paging, stuck re-issue fee → its request. Security review: no blockers.
    - [x] Boss click-through done 2026-10-27. Token label two-line fix `442c047` (frontend only):
          - [ ] Boss: push `dev` + `scripts/deploy-frontend.sh staging`.
  - [ ] **UX-3**: nav sections + Settings page, audit-log links, phone polish, **dashboard growth** (Boss 2026-10-27):
        Tokens added today / active and Accounts new today / active as tiles, each with a chart (Month / Year presets
        + custom range), counts only, by permission.
  - [ ] **Support tickets (S29 + S30), in-house** (Decision 2026-10-26): customer tickets in the console, email from
        hello@, linked to account/token; GitHub stays engineering-only, support sees only issues escalated from
        their tickets.
  - [ ] Creator ID checks: `view_creator_ids` (super_admin, admin, support) + `manage_creator_ids` (super_admin, admin), migrations `20261026000002/3`: Boss `db push`, then live checks.
- **S-ADMIN1 Ph3b: admin pricing + vouchers** ✅ live + verified 2026-10-25 (`docs/S_ADMIN1_PH3B_VERIFICATION.md`).
  Price locked at transfer start; changes now or scheduled; voucher used by the fee payer. Console click-through
  verified against the audit log.
  - [ ] A voucher transfer on a real chip, the next time a transfer is tested anyway (do not spend a chip for it).
  - [ ] Passkey step-up for price changes: built in S-2FA Ph1, turns on with `FEATURE_REQUIRE_STEP_UP` (Ph4).
- **S-ADMIN2 Ph1: accounts, roles and permissions ✅ live + verified 2026-10-26** (`docs/S_ADMIN2_PH1_VERIFICATION.md`,
  migrations `20261025000002/3`, `20261026000001`). Users search/detail, Suspend / Retire → Delete (24 h window),
  staff roles super_admin / admin / support (super_admin only), one permission model, audit log filters. Revoking or
  changing a role signs the account out and the console re-checks access. Live: suspend test@ (sign-in refused,
  sessions ended, chip_004 still verified), support role grant/revoke, forced sign-out on revoke.
  - [ ] Admin 2FA (`FEATURE_REQUIRE_ADMIN_2FA`, off) turns on with S-2FA enrolment.
  - [ ] Accepted: an access token issued before a suspend still reads own-row data straight from Supabase (≤ 1 h);
        every backend action is refused. Revisit in S-SEC1.
  - [ ] Delete has not been run on a real account (dry-run checks only); no account is eligible today.

Locked decisions behind it: reset is **admin-only**; retired chips are **never reused** (now a DB trigger); token-admin
authz = admin_users + `manage_nfc` (2026-10-05).

## 🔵 HOUSEKEEPING

- [ ] **Hardware keys (Boss, 2026-10-25):** daily AWS console is now IAM user `chris-admin` (both YubiKey 5C NFC, tested).
      Both YubiKeys also on Google, GitHub, Stripe, 1Password, GoDaddy and Squarespace (Boss 2026-10-25). Supabase
      pending: its free plan caps MFA factors at two (check for an old factor; else TOTP on both keys). Still to do: move the am-encoder TOTP seed onto both keys and out of 1Password; buy the two
      Security Key C NFC break-glass keys (root + super_admin stay as-is until then); report `tccDev` permissions.
- [ ] **`backend/.env.op` is broken** (2026-10-25): it references 1Password item "NFC Local Root", which no longer exists,
      so `op run --env-file backend/.env.op` (and `cc-auctionx`) fails before starting. Remove or repoint that line.
- [ ] **The backend's local AWS key is the DEPLOY user's** (verified 2026-10-25 with sts get-caller-identity): both
      plain `backend/.env` and 1Password item "AWS AuctionX Media" (used by `backend/.env.op`) hold `auctionx-deploy`,
      which can write both site buckets incl. the public site. Fix: check "Last used" on `auctionx-s3-access`'s key
      (nothing known loads it); create a new key on that (now scoped) user, put it in "AWS AuctionX Media" and
      `backend/.env`, deactivate its old key; the deploy key then lives only in the `auctionx` CLI profile.
- [x] ~~IAM cleanup — PRIORITY~~ applied by Boss 2026-10-25 (scoped inline `AmS3DevScoped`, S3FullAccess detached,
      user out of `tccDev`, group deleted). Its key is not used by local dev (see above), so the scope-down is not yet
      exercised. Original note:
      **IAM cleanup — PRIORITY (pull ahead of S-SEC0):** machine user `auctionx-s3-access` (member of group
      `tccDev`) has `IAMUserChangePassword` + **`AmazonS3FullAccess`** attached to the user itself, AND group `tccDev` (its
      only member) also grants `AmazonS3FullAccess` (Boss 2026-10-25). Its long-lived key (local dev, via
      `backend/.env.op`) can overwrite the public site bucket `am-frontend-prod-904183418667` (phishing), the staging
      site, read re-issue evidence and delete buckets. Fix: scope to object read/write/delete on
      `auctionx-media-prod-cl` (+ `am-reissue-evidence-staging` for local re-issue tests) remove the user from `tccDev` (then delete the
      empty group) AND detach S3FullAccess + IAMUserChangePassword from the user; either alone leaves full access. Staging does not use that user (App Runner uses its instance role;
      the leftover `AWS_ACCESS_KEY_ID` on App Runner has no secret and can be removed). Local backend dev still loads its
      long-lived key + secret via `backend/.env.op`: replace with a short-lived role/profile, then deactivate the key and
      drop the unused `ReissueEvidenceStaging` inline policy. Keep humans out of `tccDev`.

- **Supabase staging stays on the free plan until launch** (Locked 2026-10-01). It auto-pauses after ~7 idle days, so if
  Supabase calls fail, run `supabase projects list` first and restore from the dashboard.

- [ ] **Route Registry is 6 months stale** (v1.1, 2026-03-07) yet an Every-Session lesson names it the
      authority for enum values. It predates S-NFC1.5, S-NFC2 and the pivot. Bump to v2.0.
- [ ] **`public.users` is world-readable** — `"Anyone can view users" FOR SELECT USING (true)`
      (`20260201042342_remote_schema.sql:1537`). A privacy problem under anonymous token ownership, though
      not key material. Needs a view-based replacement. **Tracked for S-SEC1.** Its `UPDATE` policy also
      self-references `users`, violating the "RLS must never self-reference" lesson.
- [ ] **Mobile hardcodes the Supabase publishable key** in `mobile/lib/core/constants/api_constants.dart`
      — in git history; should move to `--dart-define`.
- [ ] **AWS admin is done as the root account** (only IAM identities: `auctionx-deploy` + S3 access). Before launch,
      create a personal admin (IAM Identity Center or an IAM user with MFA), make it administrator of the
      `am-tag-*` KMS keys, and keep root for emergencies. Fold into S-SEC1.
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
