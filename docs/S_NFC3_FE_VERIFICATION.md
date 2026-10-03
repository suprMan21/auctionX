# S-NFC3-FE Phase 1 Verification: tap, verify, claim, My Tokens

**Date:** 2026-10-03 · **Branch:** `feature/s-nfc3-fe` · **Plan:** `docs/plans/2026-10-03-s-nfc3-fe.md`
**Commits:** `eca93b8` plan · `7aae70f` backend · `a57544b` types regen · `51d0be2` frontend

## Results

| Gate | Result |
|---|---|
| Backend `tsc --noEmit` | 0 errors |
| Backend vitest | **416 passed / 21 skipped** (baseline 370 / 21; +46, no new skips) |
| Boundary lint | 0 violations (131 modules, was 121) |
| Frontend `tsc --noEmit` | 0 errors |
| Frontend vitest | **58 passed** (baseline 20; +38) |
| axe (Playwright, WCAG 2.2 AA) on token pages | 3 / 3 pass |
| Frontend production build | OK, staging API URL baked in, no localhost |
| Migration `20261003000001_nfc_tap_sessions` | Applied to staging; `migration list` local = remote |
| Types | Regenerated into both copies; diff = new table only; drift exemption removed |

**Mutation-checked.** Each was disabled on purpose and the named test failed, then restored:
- single-use guard (`.is('consumed_at', null)`): failed "is single use"
- chip binding on transfer completion: failed "rejects a session minted from a different chip"
- drift guard with a fake `public_tag_provenance.owner_email`: failed

## What shipped

### Decision D1: tap sessions

`POST /nfc/tap` verifies and burns a tap, then mints a tap session. `/claim` and `/transfer/:id/complete` accept `{ tapSession }` in place of `{ tagUid, sunMessage }`. The legacy body still works.

| Property | How it is enforced |
|---|---|
| Single use | One conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()` |
| 10-minute TTL | `expires_at`; the client also drops an expired session |
| Bound to one chip | Transfer completion rejects a session whose `tag_id` differs from the transfer's chip |
| A newer tap supersedes | Session counter must equal the chip's current `sun_counter`; the claim update uses `eq('sun_counter', n)` |
| No token at rest | Only SHA-256 is stored; table is service-role only, with RLS on and grants revoked |
| No oracle | Unknown, expired, used, wrong chip and superseded all return `tap_session_invalid` |
| Never minted for terminal tokens | Sessions only for `ENROLLED` or `ACTIVE` |

New security events (closed-schema, no token or hash): `nfc.tap_session` (issue/consume) and `ownership.receipt`. New result code: `tap_session_invalid`.

### New endpoints

| Route | Auth | Notes |
|---|---|---|
| `POST /nfc/tap` | public (optional auth), 30/min | Returns `valid`, `provenance` (view only), `tapSession`, `viewer` |
| `GET /nfc/mine` | user | Tokens I currently own, with Ownership ID, disclosure and any outgoing pending transfer |
| `GET /nfc/transfers/incoming` | user | Matches by account, or by **confirmed** email; never the sender |
| `GET /nfc/transfer/:id` | sender or recipient | For polling in Phase 2 |
| `GET /nfc/:tagId/receipt` | current owner | `no-store`; Receipt recomputes to the Ownership ID with an independent keccak256 (tested) |
| `GET /ownership/:id` | now `optionalAuth` | `youOwnThis` was always false before; now true for the signed-in owner only |

Lifecycle errors now carry a closed-set `reason` (`CLIENT_REASONS`), so the frontend never matches on message text.

`scanTag` and `tapTag` share `services/nfc/tapResolver.ts`, so there is one crypto path and no copy.

### Frontend

| Route | Notes |
|---|---|
| `/verify/:tokenName` | One `/tap` per physical tap: de-duplicated (StrictMode), cached per tab for 10 minutes, SUN params stripped. Claim with a confirmation step. Buyer warning on active tokens the viewer does not own. Plain-language copy for every failure reason |
| `/tokens` | My Tokens plus "Waiting for you" (incoming transfers) |
| `/tokens/:tagId` | Read-only: status, Ownership ID (copy, public lookup), disclosure state, provenance |
| `/ownership/:ownershipId` | Public; a stale ID says only "no longer current" |

- **Login:** honours a validated same-origin `?next=`, tested against `//evil`, `\`, `javascript:` and absolute URLs. It defaults to `/tokens` while the marketplace is parked; before, every login landed on the parked `/my-listings`, a 404.
- **D3, parked behind `VITE_FEATURE_MARKETPLACE`:** `/nfc`, `/nfc/:tagId`, `/nfc/scan` and `/verify/create/:id`. `/nfc` redirects to `/tokens`. `aesKey` is removed from the form, schema, store and API client.

## Found and fixed en route

1. **Claim errors were hidden by "tap expired".** A failed claim spends the session, and the no-session branch rendered first. A 2FA refusal would have read as an expired tap. Caught by the frontend tests.
2. **Mobile header drawer.**
   - It widened every page on phones: layout viewport 709px on a 390px device.
   - It was keyboard-reachable while closed.
   - Once open, it was only as tall as the header, because the header's `glass` backdrop-filter is the containing block for `fixed` children.
   - Fix: the drawer is now portalled to `<body>`, clipped, and `invisible` while closed. It was broken before this session.
3. **Low contrast.** axe flagged `text-gray-500` on `dark-800` at 3.82:1 (AA needs 4.5:1); now `gray-400`.
4. **`playwright.config.ts` couldn't load.** It used `__dirname` in an ES module, so no e2e test could start.
5. **Drift guard checked constants against the wrong table.** It checked every column constant against `nfc_tags`. It now resolves `.select(CONST)` to the chain's own table, and covers the three new modules.

## Live staging (2026-10-03)

1. **First tap: "not a registered token".** App Runner was still deploying, so `/nfc/tap` returned Express's bare 404, and the page treated any 404 as an unknown chip. Fixed (`6732e86`): "unregistered" now appears only for the tap handler's own `code: not_found`. About 70 seconds later the route was live.
2. **Second tap: genuine, unclaimed.** This was the first live end-to-end tap through `/nfc/tap` (KMS-derived SDM keys, counter burn, tap session issued).
3. **Claim failed and left `chip_001` half-claimed.** `OWNERSHIP_SALT_KEY` is not set in App Runner. The claim set the tag `ACTIVE` with test@ as owner, then threw while minting, so no Ownership ID was created. The raw error message also reached the browser.
   - **Root cause:** claim, `/replace` and the token-fee webhook all wrote state first and minted after.
   - **Fix (`9ecb422`):** mint before any write in all three; the webhook returns 500 on an apply failure so Stripe retries (it used to be 200, no retry); token routes never echo a non-`AppError` message. Four regression tests; the wrapper test is mutation-checked.
   - **Repair (Boss approved):** `chip_001` (`253ed5ca…`) was reset to `ENROLLED` with no owner and no claim date, using a conditional REST `PATCH`. It had no proofs. `sun_counter` stays at 5.
4. **Claim succeeded** after the key was set in App Runner. Checked in the database: `chip_001` is `ACTIVE` and owned by test@ (`0b211aed…`). It has exactly one `current` proof (`0xcbfa9f6e18975e21871e8010249aad22664985900be0893d0143edfe3425b9b5`, `claim`, salt envelope `v1.`). The tap session was consumed for `claim` at counter 13. `GET /ownership/<id>` resolves to `current` with provenance and no owner identity.
5. **One intermittent backend test failure.** Seen once in about 45 full runs (the run right after a mutation check); 0 of 30 on re-run. The test name was not captured. Watch for it.

## Deviations from the plan

- **No Zustand store.** Pages hold local state; nothing is shared across routes yet. Phase 2 can add one if transfer polling needs it.
- **API mocks.** Frontend tests mock the `tokenApi` module rather than using msw: fewer moving parts, same coverage.
- **Partial Playwright run.** The new token a11y specs ran against a local Vite server with the API intercepted. The full e2e suite still needs the backend and `op`, and was not run.

## Outstanding

### Deploy (Boss)

1. `git push origin dev` deploys the backend to App Runner.
2. Claude smokes `POST /api/v1/nfc/tap` (expect 400 on an empty body, not 404).
3. Frontend:

   ```bash
   cd frontend && npm run build && aws s3 sync dist/ s3://auctionx-frontend-staging --profile auctionx --delete \
     && aws cloudfront create-invalidation --profile auctionx --distribution-id E3JOPXHI8DB4BE --paths '/*'
   ```

4. Live smoke: tap `chip_001` with a phone. The verify page should show "Genuine" with a status that matches the DB.

   ⚠️ Claiming is permanent. Claim with the `test@` account, not super_admin, if you want to keep the admin account clean.

### Other

- **Recipient email on transfer initiate:** not built. Log it in the Feature Backlog.
- **Mobile drawer leftovers:** it still shows "Search listings" (search is parked) and empty dividers. Small cleanup for a later session.

## Next: Phase 2 (frontend only)

- Transfer: initiate, complete with Stripe, cancel.
- Release (double confirm).
- Disclosure settings.
- Ownership panel and Receipt download.

**Blocked on Boss for live payment:** register the token-fee webhook, and resolve the duplicate "Stripe" 1Password items.
