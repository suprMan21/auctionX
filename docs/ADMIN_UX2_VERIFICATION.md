# Admin console UX-2: one table style, fewer clicks in dialogs (2026-10-26)

Branch `feature/admin-ux2`. Second of three admin console UX sessions. Rule (Locked 2026-10-26): every admin task in
2 to 3 clicks, complete at the end. Click cuts come from navigation and pickers only, never from safety steps (Boss
2026-10-26). Feature Backlog card "Admin console UX-2" (AC 1 to 8).

## What changed

- **One table style** (`components/AdminTable.tsx`): whole-row click opens the record; the first cell stays a real
  link; a click on a link, button or field in the row, or finishing a text selection, does not navigate;
  cmd / ctrl / middle click opens a new tab (`noopener`). A row click only navigates. Columns resize by drag or by
  keyboard (focus the handle, arrow keys); widths are kept per browser in localStorage (best effort, try/catch).
  Emails wrap with the full text on hover. Used by Accounts, Tokens, Creator ID checks (replaces its
  mouse-only `<tr onClick>`), Free transfers and the Audit log (Details expands a row).
- **One paging, filter, search and loading style** (`components/AdminListParts.tsx`): Previous / Next with
  "Page x of y"; filter pills (Accounts' status dropdown became pills); search runs on Enter or the Search button,
  never per keystroke, and the term stays out of the URL. Applies to Tokens (as before), **Accounts** (was debounced and
  in `?q=`), **Free transfers** (was `?email=`) and **Creator ID checks** (was debounced and in `?search=`).
- **Re-issues** open on **Needs action** (waiting for review + ready for a chip; backend filter `NEEDS_ACTION`, oldest
  first). Re-issues and Stuck payments page through the queue (25 a page) instead of stopping silently at 50.
  `?request=<id>` shows one request (backend: optional `id` on `GET /admin/reissue-requests`, same manage_nfc gate).
- **Stuck re-issue fee → its request**: the Re-issue ID links to the request, and once the fee has gone through and
  the chip is still to do, **Move to new chip…** opens the usual dialog right there. Both only for staff with
  `manage_nfc`; support (who can Re-apply) sees neither. Backend adds `target.fulfilled` to the stuck payment list.
- **Replacement chip by typing its name** (`components/ChipCombobox.tsx`, WAI-ARIA combobox) in Move token to new
  chip and Complete re-issue. Picking only fills the form; Enter picks, never submits; editing the text after a pick
  clears it (Confirm locks again).
- **Staff role by radio buttons** (fieldset "Staff role"; current role marked).
- **Pricing**: a Change button on each price card opens the dialog for that price. No Now / Later radio: an empty
  date means now, a date means scheduled; the dialog always says "Starts now." or "Starts on …" before Confirm. A
  half-typed date blocks Confirm ("Finish the date and time, or clear it to start now.").

Re-issues and Stuck payments stay as cards rather than the shared table: each item carries photos, a reason, a fix
hint and up to three actions, which a table row cannot hold at 375px. They share the paging, filter and loading parts.

## Security unchanged

Every action keeps its confirmation dialog, typed reason (10+ characters), typed confirmation on destructive actions
(old chip's serial end for move token / complete re-issue; payment ID end for refund), super_admin-only stays
super_admin-only, server permission re-check and audit row, and buttons only for staff with the permission. API
request bodies unchanged. Tests prove row clicks, combobox picks and role radios never call an action endpoint and
that Confirm stays disabled until reason + confirmation are valid.

## Click counts (from the record or list)

| Task | Before | After |
|------|--------|-------|
| Move token to new chip (reset) | 4 | 3 (open, pick, Confirm) |
| Complete re-issue | 4 | 3 |
| Change staff role | 4 | 3 (open, radio, Save) |
| Change a price, now | 2 (transfer fee) / 4 (others) | 2 (Change on the card, Confirm) |
| Change a price, scheduled | 3 / 5 | 2 + typing the date |
| Open a record from any list | click the small link | click anywhere on the row |
| Stuck re-issue fee → new chip | leave page, find the request, 3+ | 3 (Move to new chip, pick, Confirm) |

## Tests

- Backend: tsc 0; vitest **791 passed / 21 skipped** (+2: NEEDS_ACTION filter, `id=` lookup and its validation).
- Frontend: tsc 0; vitest **270 passed** (+20: shared table 7, pickers 8, re-issue paging / one request 2, stuck
  re-issue fee link + permission + done 3); eslint 0 on `src/features/admin`.
- Security review (independent subagent, read-only, before merge): **no blockers**. One should-fix, fixed: a
  half-typed datetime-local keeps value `''` and fires no change event, so the price dialog could read "Starts now"
  and set the price at once. The field now re-reads `validity.badInput` on input, key-up and blur, and again at
  Confirm; Clear also wipes the half-typed segments (test added). One note, fixed: Move to new chip from a stuck
  payment re-checks the request is paid or waived before opening the dialog (the server enforces it anyway).
  Confirmed fine: constant `.or()` filter, `id` is a UUID through a `.strict()` schema behind manage_nfc,
  `target.fulfilled` is a boolean only (nothing new reaches support), `window.open` only gets `/admin/...` paths,
  rows are not focusable (Enter cannot act from a list), localStorage holds widths only, request bodies unchanged.

## Deploy

No migration. Backend first (the frontend sends `status=NEEDS_ACTION`, which the old backend refuses with 400), then
`scripts/deploy-frontend.sh staging`. After the push run `scripts/verify-backend-deploy.sh`.

## Follow-up after Boss click-through (2026-10-27)

- Boss click-through on staging: looks good.
- Token label was hard to read (`chip_004 · …936980 · sn …0351DE` on one line). New `components/ChipName.tsx`: name on
  line 1, "Serial … · Hardware ID …" small and grey on line 2; screen readers get one comma-separated phrase. Used on
  the Tokens list, token page title and re-issue cards (`442c047`, frontend only). Frontend vitest 270, tsc 0, eslint 0.
