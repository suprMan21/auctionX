# S-SEAL1 Ph2a — seal spec + pattern v1 — verification

Plan: `docs/plans/2026-10-28-s-seal1-ph2.md` (Ph2a). Branch `feature/s-seal1-ph2a`, worktree `.claude/worktrees/s-seal1-ph2a`, off `dev` `0c38e41`.
Date: 2026-10-28 (Toronto). Status: **code done, tests green; migration, backfill, deploys and phone check pending Boss.**

## What shipped

| Part | Where | Notes |
|---|---|---|
| Migration | `supabase/migrations/20261028000004_seal_spec.sql` | `nfc_tags.seal_spec JSONB` (object with `v` + `code`, code must equal the tag's `seal_code`), `seal_design_version_id UUID` (no FK until S-SEAL2). `seal_spec` joins the write-once trigger. No grant change. Retired seals can still get their spec once (freeze trigger does not list it). |
| Live SQL | `supabase/tests/seal_spec_live.sql` | 12 checks (shape, wrong code, first write, change / clear refused, same value OK, retired first write, seal_code still write-once, grants same as seal_code, anon reads nothing). Rolls back. |
| Store helper | `backend/src/lib/seal/ensureSealSpec.ts` | Builds the spec from the seal code and stores it when the column is empty (`.is('seal_spec', null)`); never throws, never overwrites. Stored specs are re-validated (only `M` / `l` / `Z` path commands). |
| API | tap (`POST /nfc/tap`), `GET /nfc/mine`, enroll | `sealSpec: { v, colors, pattern }` (no code inside; the code is `sealCode`). Enroll stores it right after insert, never blocking. Tap key list pinned (`tokenReads.test.ts`). |
| Backfill | `backend/scripts/backfill-seal-specs.ts` | Dry run by default; `--write` stores. Counts only in the output. Safe to re-run. |
| Geometry | `backend/src/lib/seal/geometry.ts`, `frontend/src/components/seal/geometry.ts` | Same constants; both tests pin SHA-256 `f7796b2b…57434`. |
| Badge | `frontend/src/components/seal/SealBadge.tsx` + `seal.css` | Optional `spec`. Pattern v1 as Locked: rings clipped at r 30.5, stroke .35, opacity .20 / .14. **Verified only:** outer ring turns the other way every 48 s, inner with the words every 30 s, two outer electrons (30 s, half a lap apart) and one inner going the other way (20 s), 4-dot tail + halo. **Sealed:** pattern still, no electrons. **Reduce Motion:** electrons are left out of the page and rings stop. No spec (homepage, older backend): unchanged. |
| Call sites | tap page, My Seals, token page | Pass `sealSpec`. Frontend schema drops a malformed spec instead of failing the page. |

Electrons use SMIL `animateMotion` but exist in the page only while Verified, so the 90 s end and Reduce Motion stop them by removing them.

## Tests

- Backend: tsc 0; vitest **1145 passed / 23 skipped** (new: `ensureSealSpec.test.ts` 9, `geometry.test.ts` 1, 3 tap + 1 My Seals spec tests).
- Frontend: tsc 0; vitest **463 passed** (new: 7 pattern tests in `sealBadge.test.tsx`, `sealGeometry.test.ts`). Homepage tests unchanged and green.
- ESLint: one existing error in `TokenVerifyPage.tsx:51` (`react-hooks/set-state-in-effect`), already on `dev`, not from this work.
- `database.types.ts` (both copies) hand-edited with the two columns; regenerate after `db push`.

## Boss steps (in order)

1. Dry run (rolls back): `supabase db query --linked -f <scratchpad>/seal_spec_dryrun.sql` → expect `RESULTS {...}` with 12 × `ok`.
2. Apply: `supabase db push --linked`, then `supabase db query --linked -f supabase/tests/seal_spec_live.sql` → 12 × `ok`.
3. Push `dev`; run `scripts/verify-backend-deploy.sh`.
4. Backfill: `cd backend && op run --env-file .env.op -- npx tsx scripts/backfill-seal-specs.ts` (dry run), then with `--write`. Expect "still without a spec: 0".
5. Frontend staging deploy: `scripts/deploy-frontend.sh staging`.
6. iPhone: tap `chip_004` (WAV4-F6TT): rings visible, rings turn, electrons move for ~90 s, then the seal goes still with the rings still drawn. With Settings → Accessibility → Reduce Motion on: rings drawn, nothing moves. My Seals: still pattern on the small seal.

## Live results

- 2026-10-28: dry run (BEGIN … ROLLBACK) 12/12 ok.
- 2026-10-28: `supabase db push --linked` applied `20261028000004_seal_spec.sql` only; live SQL `seal_spec_live.sql` **12/12 ok**.
- Backfill, backend deploy, frontend deploy, iPhone check: pending.
