# S-MOB2 Ph A — seal commit backend: verification

Date: 2026-10-29 · Branch `feature/s-mob2-a` · Plan `docs/plans/2026-10-29-s-mob2.md`
Boss decisions 2026-10-29: D1 counter ledger · D2 gap = take void, Redo · D3 any Creator with an unclaimed chip ·
D4 App Attest / Play Integrity deferred to S-SEC1.

## What changed

- Migration `20261029000002_s_mob2_seal_commit.sql`:
  - `nfc_counter_ledger` (every accepted counter; public burns recorded by a trigger on `nfc_tags.sun_counter`).
  - `nfc_tags.seal_baseline_counter` (write-once; backfilled from `sun_counter`; new rows take their counter at insert).
  - `seal_sessions` (optional, online at tap 1, server time; creator + serial bound, single use, 24 h).
  - `nfc_seals` (one per chip; c2 = c1 + 1 enforced by CHECK; video SHA-256; `video_status` starts `pending_upload`).
  - `commit_seal()` SECURITY DEFINER, row lock, service role only. Same state change as an origin claim.
  - `step_up_grants` action `seal`.
- Backend: `POST /api/v1/nfc/seal/session`, `POST /api/v1/nfc/seal` (`controllers/sealController.ts`).
  Commit = auth → second factor → recovery freeze → **`seal` step-up bound to the chip serial, always on** →
  Creator only → same serial in both URLs → both MACs (`resolveSealTap`, no counter burn) → counters above the
  baseline → `commit_seal` → ownership proof.
  `seal` step-up: passkey or authenticator code, never a backup code, refused during a recovery freeze.
- Public taps, claims and transfers: unchanged (strict high-water rule).

## Results

| Check | Result |
|---|---|
| Migration dry run + live SQL `s_mob2_seal_live.sql` (BEGIN … ROLLBACK on staging) | ✅ 18/18 |
| Backend tsc | ✅ 0 errors |
| Backend vitest | ✅ 1228 passed / 23 skipped (`sealCommit.test.ts` 18 new, route probes +4) |
| Frontend tsc | ✅ 0 errors |
| Mutation check (baseline rule removed → its test fails) | ✅ fails as expected, restored |

One unrelated flake seen once: `mfa.test.ts` "accepts null authenticatorAttachment…" (supertest `Parse Error: Expected HTTP/`); passes 3/3 alone and in the rerun.

## Live on staging (2026-10-29)

- Migration applied; live SQL `s_mob2_seal_live.sql` 18/18 (Boss). `supabase migration list --linked` shows `20261029000002` remote.
- `dev` pushed (`206a6e2`); App Runner START_DEPLOYMENT SUCCEEDED 17:13 EDT; `POST /api/v1/nfc/seal` and `/seal/session` answer 401 unauthenticated (unknown route 404).
- `database.types.ts` regenerated (backend + frontend, additions only); tsc both sides 0, backend 1228 passed.

## Boss steps (done)

1. Apply the migration: `supabase db push --linked` (Claude can't write the staging DB).
2. Run `supabase db query --linked -f supabase/tests/s_mob2_seal_live.sql` → expect `RESULTS` with 18 × "ok".
3. Push `dev` and run `scripts/verify-backend-deploy.sh`.
4. Then Claude regenerates `database.types.ts` (new tables + `seal_baseline_counter`).

## Open / next

- Device risk: the bracket assumes one chip read per tap (counter +1). Confirm on iPhone in Ph B that the app's
  NDEF read raises the counter by exactly 1; if iOS reads twice, D2 voids every take.
- Abandoned takes are not uploaded yet (protocol says keep their taps as audit only): Ph B/C.
- Ph B: Flutter sealing flow. Ph C: video upload + review queue. Ph D: share + device tests.
