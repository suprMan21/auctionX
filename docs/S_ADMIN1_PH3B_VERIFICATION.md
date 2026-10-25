# S-ADMIN1 Ph3b — Admin-set prices + free-transfer vouchers · Verification

**Branch:** `feature/s-admin1-ph3b` (from `dev` @ `9fb90f7`)
**Date:** 2026-10-24
**Backlog:** https://app.notion.com/p/3ee3baf696648174b35cc098afb083a6
**Decisions:** "Token prices become admin-set … with free-transfer vouchers; admin + super_admin only" (Locked
2026-10-03) and "Free-transfer vouchers are granted to an account, not issued as redeemable codes" (Locked 2026-10-11)

Status: **Migration applied to staging; live DB checks 23/23. Backend + frontend built, tested and merged to `dev` locally; NOT yet deployed (Boss pushes).**
See §Deploy and §Not verified live.

---

## Decisions with Boss (2026-10-24)

1. **A transfer's price is locked when the sender starts it** (the amount they saw), as re-issue already locks it
   when the request is made. A later price change never reaches a transfer or request already under way.
2. **Price changes take effect now or from a chosen future date.** A scheduled change can be cancelled before it
   starts. No backdating. History is never rewritten: to undo a price in effect, set a new one.
3. **A voucher is used by whoever pays the fee**: sender-pays uses the sender's voucher, recipient-pays the
   recipient's. (The current UI always has the recipient pay.)

## What was built

**Prices** (`token_prices`, effective-dated). The price in effect is the newest uncancelled row whose
`effective_from` has passed; with no row, the env defaults in `tokenFees.ts` apply. Seeded with the launch defaults
($2.50 transfer, $10 token, $10 re-issue). Amounts must be $0.50–$1,000 (Stripe's USD floor; a free transfer is a
voucher, not a $0 price). `admin_set_token_price` / `admin_cancel_token_price` re-check admin+ in the database
(`payment_admin_actor_email(…, true)`) and write the audit row (`token_price_set` / `token_price_cancel`, with the
previous price) in the same transaction. The backend price lookup **fails closed**: no guessed price in a payment path.

**Vouchers** (`transfer_voucher_grants`, `transfer_voucher_redemptions`). An admin grants N (1–100) free transfers to an
account by email, with a reason and optional expiry; revoke keeps the row and stops its unused vouchers. Both audited
(`voucher_grant` / `voucher_revoke`). The email lookup itself is audit-logged **before** it runs (`voucher_search`,
`entity_type admin_search`), as admin tag search is; no audit row, no lookup.

**One completion path.** `redeem_transfer_voucher` locks the transfer, decides the payer from the row
(`fee_payer` SELLER → sender, else recipient), takes the payer's soonest-expiring live voucher, records the redemption
(`payment_method = 'voucher'`, charged 0) and completes through `apply_transfer_fee` with the new `'voucher'` source,
all in one transaction. `apply_transfer_fee` refuses a `'voucher'` completion unless a redemption row for that
transfer exists in the same transaction, and refuses it if a card PaymentIntent was ever started. Any non-applied
outcome rolls the voucher use back.

**Transfer flow** (`completeTransfer`): after the recipient's fresh tap and recipient resolution, if no card payment
has been started and the payer has a usable voucher, redeem it and return `status COMPLETED, voucherApplied true,
clientSecret null`. A failed redeem never falls through to a card charge. Otherwise charge the **locked** price. The
PaymentIntent is now stored only on a still-PENDING transfer and the write is checked; if it fails the intent is
cancelled (previously the write's error was ignored).

**Security log:** `transfer.state_change` trigger `voucher` added; legitimate only with a matching
`transfer_voucher_redemptions` row (same transaction). Any other non-payment trigger to COMPLETED stays Critical.

**API**

| Route | Who | What |
|---|---|---|
| `GET /api/v1/nfc/prices` | signed in | prices in effect (display only) |
| `GET /api/v1/nfc/vouchers/mine` | signed in | `freeTransfers` usable now |
| `GET/POST /api/v1/admin/pricing`, `POST …/:id/cancel` | admin, super_admin | prices, history, set, cancel scheduled |
| `GET/POST /api/v1/admin/vouchers`, `POST …/:id/revoke` | admin, super_admin | grants (exact-email filter), grant, revoke |

Support gets 403 on every pricing/voucher route (middleware) and `admin_forbidden` from every function (database).

## Tests

- Backend: tsc 0 errors; vitest **698 passed / 21 skipped** (was 659). New: `adminPricing.test.ts` (27: role gate,
  validation, error mapping without DB text, audit-before-lookup, statuses) and 12 Ph3b cases in
  `tagLifecycle.test.ts` (price lock at start, fallback, fail-closed, locked price after a raise, voucher instead of
  Stripe, payer = sender, expired/revoked ignored, `no_voucher` → card, failed redeem never charges, no voucher once a
  card payment started, PaymentIntent cancelled when the transfer left PENDING). Rules proven to fire by breaking
  them on purpose (cancelled-row filter, expiry filter, voucher role gate): each break failed its test.
- Live DB (`supabase/tests/s_admin1_ph3b_live.sql`, rolled back): **23/23** on staging after apply (also 23/23 as a
  dry run in a rolled-back transaction before apply). Includes atomicity (apply forced to fail at its last write →
  voucher, redemption and transfer all roll back), payer selection, expiry order, revoke, no client grants, and the
  card path unchanged. Existing suites re-run after apply: Ph3a 26/26, Ph2 19/19, chip names 17/17.
- Frontend: tsc 0 errors; vitest **187 passed** (was 153). Covers: pricing page (current prices, history statuses,
  set-price validation incl. $0.50 floor and reason length, `effectiveFrom: null` for Now, cancel only on scheduled),
  vouchers page (grant posts trimmed lowercase email, revoke dialog), support sees neither nav item nor page (no API
  call), transfer dialog shows the server price (300 → "$3.00", never a hard-coded $2.50), voucher-completed transfer
  shows success and never mounts Stripe. eslint: 3 pre-existing `setState`-in-effect errors (AdminProtectedRoute:30,
  TokenVerifyPage, AdminAuditLogPage), none introduced.
- Frontend role gating is display only: `AdminProtectedRoute` reads the admin's role (`admin_users → admin_roles`) into
  `AdminRoleContext`; nav items and `AdminRoleGate` hide Pricing / Free transfers from support. The server is the gate.

## Deploy

1. ✅ DB: `20261024000001_s_admin1_ph3b_pricing_vouchers.sql` applied 2026-10-24; types regenerated.
2. Backend: Boss pushes `dev`; then `scripts/verify-backend-deploy.sh` and probe `GET /api/v1/nfc/prices` (401
   without a token = route exists).
3. Frontend: `scripts/deploy-frontend.sh staging` (Boss). The public site is unaffected.

Order matters only one way: the old frontend cannot render a voucher-completed response, but no voucher can exist
until an admin grants one from the new console.

## Not verified live (yet)

- A voucher-completed transfer on a real chip (needs a tap; Boss is conserving sample chips: do it the next time a
  transfer is tested anyway).
- Setting and cancelling a price, and granting/revoking a voucher, through the deployed console.
- Passkey step-up for price changes: waits for S-2FA (decision implication), not built.
