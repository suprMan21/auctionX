# S-SEAL1 Ph1 — Tap page seal refresh (web) — Verification

Date: 2026-10-28 (Toronto). Branch `feature/s-seal1-ph1` (worktree `.claude/worktrees/s-seal1-ph1`), off local `dev` `29006fd`.
Brief v0.2 (Notion 4073baf6…e277), DR-22 v1.2, Decisions: seal_code (Locked 2026-10-26), gates G1–G4 (Locked 2026-10-28).
Plan: `docs/plans/2026-10-28-s-seal1-ph1.md`.

## Boss answers this session

- Q1: a valid tap of an on hold, released or retired seal shows **no seal**, text status only.

## Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | G1–G4 answered and recorded before the first code commit | ✅ Decisions DB 4073baf6…de2d0 (Locked 2026-10-28) |
| 2 | Migration applied to staging; live SQL: format, unique, write-once, backfill, anon cannot read | ⏳ Dry run on staging **16/16** (BEGIN … ROLLBACK). `db push` blocked for Claude (classifier) → Boss runs it, then `supabase/tests/seal_code_live.sql` |
| 3 | Encoder gets the seal code in the reserve step; unit-tested; next real encode recorded | ✅ unit tests (tag-encoder 253 passed). ⏳ next real encode: record its seal code here |
| 4 | Valid tap → Verified seal with its own code + live cues; after the window → Sealed; failed / unknown → no seal | ✅ tests + browser (mocked tap). ⏳ silicon (AC 8) |
| 5 | Reduced motion verified in a browser (no spin / glow; clock still updates) | ✅ Chromium 390×844, `reducedMotion: reduce`: badge + ring `animation-name: none`, "Checked by tap · 3 s ago" still counting |
| 6 | Homepage unchanged visually; `publicSite.test.ts` + `HomePage.test.tsx` green | ✅ 6 + 21 green; seals still 48 / 88 / 44 px; glow now 3.0 s (the Locked change) |
| 7 | No-private-fields tests; tsc 0; backend + frontend vitest green | ✅ tsc 0 both; backend 1109 passed / 23 skipped; frontend 427 passed |
| 8 | Live check on silicon with `chip_004` (no re-encode) | ⏳ after deploy |
| 9 | This report | ✅ |

## What changed

### Database — `20261028000003_seal_code.sql`

- `nfc_tags.seal_code` + `nfc_chip_names.seal_code`: optional, CHECK `^[0-9A-HJKMNP-TV-Z]{8}$` (stored without hyphen), unique.
- `gen_seal_code()` (pgcrypto random bytes, `& 31` → uniform), `new_unused_seal_code()` (collision retry, cap 20).
- `reserve_chip_identity(sig, name, actor) → (name, seal_code)`: wraps the unchanged `reserve_chip_name`; a re-run of the
  same chip gets the same code. The old function stays, so the backend still deployed keeps working in the deploy gap.
- `nfc_tags` BEFORE INSERT: takes the reserved code, else a fresh one (every new tag has a code).
- Write-once: `nfc_tags_identity_write_once` now covers `seal_code` (change and clear refused); reservations too.
- Backfill: every tag without a code (live chips and retired ones); bound reservations get the tag's code.
- All functions service_role only. anon reads no `nfc_tags` row (owner-read RLS), so no code.

### Backend

- `POST /nfc/enroll/reserve-name` → `{ name, auto, sealCode }`; fails closed without a well-formed code.
- `POST /nfc/tap` (valid) adds `sealCode` (XXXX-XXXX or null) and `checkedAt`. Failed taps unchanged.
- `GET /nfc/mine` adds `sealCode` (token detail reads this list).
- Tests: tap response keys pinned exactly; no chip name; malformed stored code never sent.

### Encoder

- `reserve_identity()` returns `Reservation(name, seal_code)`; `reserve_name()` kept. Code goes into the audit ledger
  (`seal_code`, allowlisted) and the encode printout; never written to the chip. Malformed code → refuse; missing (older
  backend) → encode continues, the database still assigns one at enroll.

### Web

- `components/seal/SealBadge.tsx` + `seal.css` (moved out of `.am-home`): glow 3.0 s, code in bundled IBM Plex Mono
  (600/700 latin woff2 + OFL licence in `components/seal/fonts/`, no CDN), new `state="sealed"` (still, muted, no glow).
- Tap page (`TokenVerifyPage` + `TapSealCard`, `tapPage.css`): Cinema theme on this page only.
  - **Verified**: only for a tap made on this page load, 90 s from when the server's answer arrived (phone clock), with
    "Checked by tap · N s ago" and the viewer's clock (not a live region; a status line announces once).
  - **Sealed** after the window ("Tap the seal again to check") or for a remembered tap ("Tap the seal to check"); heading
    Owned / Unclaimed / You own this, never Verified. No automatic re-check.
  - No seal on failed, unknown, error, on hold, released, retired, or when an older backend sends no code.
- My Tokens + token detail: small still seal; an untitled seal is named "Seal XXXX-XXXX" (before the chip name).
- Collector copy in seal language: `lib/copy.ts`, claim panel, transfer accept, story card. "My Tokens" link text kept
  until the My Seals rename (Decision 2026-10-28, sweep pending). Staff screens untouched.

## Deploy steps (Boss)

1. `supabase db push --linked` (applies only `20261028000003`; checked with `migration list`), then
   `supabase db query --linked -f supabase/tests/seal_code_live.sql` → expect `RESULTS {…}` all "ok".
2. Push `dev` → `scripts/verify-backend-deploy.sh` (backend must not deploy before step 1: the tap reads `seal_code`).
3. `scripts/deploy-frontend.sh staging` (grep `dist/assets` for `pk_test_` first).
4. Tap **chip_004** → Verified seal shows chip_004's code (compare: `select seal_code from nfc_tags where chip_name='chip_004'`)
   → wait 90 s → still seal with "Tap the seal again to check". Refresh → still seal, "Owned".

## Results to fill in

- Live SQL after push: _
- chip_004 seal code (DB) / shown on phone: _ / _
- Phone (iOS / Android) Verified → Sealed: _
- Next real encode: chip name _, seal code _
