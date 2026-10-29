# S-SEAL1 Ph2a — seal spec + pattern v1 — verification

Plan: `docs/plans/2026-10-28-s-seal1-ph2.md` (Ph2a). Branch `feature/s-seal1-ph2a`, worktree `.claude/worktrees/s-seal1-ph2a`, off `dev` `0c38e41`.
Date: 2026-10-28 (Toronto). Status: **✅ live on staging + verified on iPhone 2026-10-28.**

## What shipped

| Part | Where | Notes |
|---|---|---|
| Migration | `supabase/migrations/20261028000004_seal_spec.sql` | `nfc_tags.seal_spec JSONB` (object with `v` + `code`, code must equal the tag's `seal_code`), `seal_design_version_id UUID` (no FK until S-SEAL2). `seal_spec` joins the write-once trigger. No grant change. Retired seals can still get their spec once (freeze trigger does not list it). |
| Live SQL | `supabase/tests/seal_spec_live.sql` | 12 checks (shape, wrong code, first write, change / clear refused, same value OK, retired first write, seal_code still write-once, grants same as seal_code, anon reads nothing). Rolls back. |
| Store helper | `backend/src/lib/seal/ensureSealSpec.ts` | Builds the spec from the seal code and stores it when the column is empty (`.is('seal_spec', null)`); never throws, never overwrites. Stored specs are re-validated (only `M` / `l` / `Z` path commands). |
| API | tap (`POST /nfc/tap`), `GET /nfc/mine`, enroll | `sealSpec: { v, colors, pattern }` (no code inside; the code is `sealCode`). Enroll stores it right after insert, never blocking. Tap key list pinned (`tokenReads.test.ts`). |
| Backfill | `backend/scripts/backfill-seal-specs.ts` | Dry run by default; `--write` stores. Counts only in the output. Safe to re-run. |
| Geometry | `backend/src/lib/seal/geometry.ts`, `frontend/src/components/seal/geometry.ts` | Same constants; both tests pin SHA-256 `f7796b2b…57434`. |
| Badge | `frontend/src/components/seal/SealBadge.tsx` + `seal.css` | Optional `spec`. Pattern v1 rings clipped at r 30.5. **Verified: Shimmer** (Boss 2026-10-28, replaces the electrons): rings turn (48 s other way / 30 s), holographic ring lines, faint rainbow sheen, rainbow glint sweeping every 30 s (first 1 s after the seal appears; started with `beginElement()` on mount, not page load). **Sealed:** white still rings, no sheen. **Reduce Motion:** holographic look, nothing animated in the page. No spec (homepage, older backend): unchanged. |
| Call sites | tap page, My Seals, token page | Pass `sealSpec`. Frontend schema drops a malformed spec instead of failing the page. |

SMIL parts (colour turn, glint) exist in the page only while Verified with motion allowed, so the 90 s end and Reduce Motion stop them by removing them.

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
6. iPhone: tap `chip_004` (WAV4-F6TT): rainbow rings turn, sheen visible, a glint sweeps ~1 s after the tap and again at ~31 s and ~61 s; after ~90 s the seal goes still with white rings. With Settings → Accessibility → Reduce Motion on: rainbow rings, nothing moves. My Seals: still pattern on the small seal.

## Live results

- 2026-10-28: dry run (BEGIN … ROLLBACK) 12/12 ok.
- 2026-10-28: `supabase db push --linked` applied `20261028000004_seal_spec.sql` only; live SQL `seal_spec_live.sql` **12/12 ok**.
- 2026-10-28: backfill `--write` done; read-only check: 8/8 tags have a spec, 0 missing.
- 2026-10-28: backend deploy SUCCEEDED 22:20 (health 200). `backend/.env.op` fixed (`30e5d3a`).
- 2026-10-28: Shimmer (`62d12ff`, sweep fix `b960c89`) pushed; frontend staging deployed.
- 2026-10-28: iPhone tap of `chip_004` (WAV4-F6TT): Shimmer works, the sweep crosses the whole badge (Boss: "yup works").
- 2026-10-28: Reduce Motion and My Seals small seal checked on iPhone (Boss: "looks great"). Android not tested.

## Side finding: frangible sticker on plastic (Boss, 2026-10-28)

Boss tested the frangible antenna on plastic. It tore as intended, **but only after the sticker had sat on the item for at least 10 minutes**. Before that it can be lifted whole.

This matches the adhesive. The sticker is believed to use 3M 467MP (DR-14 §4; part not confirmed with Shunxin). Pressure-sensitive acrylics like this keep building their bond for days. From 3M's general guidance (not checked against the 467MP data sheet this session), that is roughly half the final bond after about 20 minutes, about 90% after 24 hours and full bond after 72 hours at room temperature. DR-14 also found 467MP grips about four times less on ABS plastic than on steel.

What it means for sealing:
- A freshly applied seal is not yet tamper-evident. Someone could lift it and move it in the first minutes.
- The sealing flow (S-MOB2) should tell the creator to press it down firmly and **not ship or hand over the item until it has set** (24 h recommended; confirm with the peel test).
- Still open: the DR-14 peel test at 10 min / 1 h / 24 h / 72 h on the real seal-flag plastic, and Shunxin's part number and peel data.

### Metal items (Boss, 2026-10-28)

The current sticker **does not work on metal**: it doesn't read once it's stuck to a metal surface. This is expected for a plain NFC inlay. Metal under the antenna detunes it and soaks up the reader's field. The usual fix is an **on-metal tag**, which has a ferrite layer between the antenna and the surface, but that makes the tag thicker and stiffer. A thicker, stiffer layer may work against a frangible design, which needs the sticker to tear. The research so far (DR-9, DR-14) does not cover on-metal at all.

For now:
- Seals go on non-metal surfaces only: plastic, card, wood, fabric tags. Medals, coins, metal figures and metal cases need a non-metal flag or tag, or a separate on-metal seal.
- Creator guidance (S-MOB2 sealing flow, creator help) must say "not on metal", and should tell the creator to tap-test after applying.
- Open question for the supplier (Shunxin) and a possible research item: is there a 424 DNA on-metal frangible label, and how does it hold up against peeling?

