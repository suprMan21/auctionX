# Admin console UX-1 — wording, needs attention, console search (2026-10-26)

Branch `feature/admin-console-ux`. First of three admin console UX sessions (Boss 2026-10-26). Rule (Decisions DB,
Locked 2026-10-26): every admin task done in 2 to 3 clicks from where the admin starts, and complete at the end.
Follow-ups: Feature Backlog "Admin console UX-2", "UX-3", "GitHub Issues in the admin console".

## Reviews (read-only subagents)

- **Click paths:** about 20 tasks traced; 8 took more than 3 clicks (staff role 6, reset 6, complete re-issue 6,
  token → owner no link, "what did X do yesterday" no date filter, nothing on the landing page about queues).
- **Wording:** tag / chip / token, users / accounts, voucher / free transfer and replacement / re-issue mixed; raw
  status codes and IDs on screen; em dashes as the empty marker; errors without a next step; raw "User is banned".

## What changed

- **Wording** (`lib/labels.ts`, `lib/display.ts`): Token / chip / Account / Staff role / Free transfers / Re-issue;
  plain labels for every status and audit action; "None" for empty values; one date and money format; sentence case;
  buttons name the action; errors say what to do next (server text shown only for 4xx). Server messages reworded the
  same way (`controllers/admin*.ts`, `adminAuth.ts`, `adminRateLimit.ts`). Sign-in errors mapped
  (`features/auth/lib/signInError.ts`): banned → "This account cannot sign in right now. Contact
  hello@authentic-materials.com…". Yoti page kept as **Creator ID checks** (reworded, behaviour unchanged).
- **Needs attention** on the dashboard: re-issues to review, ready for a new chip, open stuck payments, each one click
  from the filtered list; the same counts as nav badges (`components/WorkQueueProvider.tsx`; refreshed every minute
  while visible, on focus and after an action).
- **Console search** on every page (`components/ConsoleSearch.tsx`): accounts and tokens at once, by permission; runs
  on submit only (each submit writes the usual `user_search` / `tag_search` audit rows); one match opens it; the term
  never goes in the URL; a name with a space searches accounts only.
- **Accounts as links** (`components/AccountLink.tsx`): owner / creator on the token list and page, ownership history
  from/to, taps, re-issue requester. Backend adds `fromEmail` / `toEmail`, `accountEmail`, `requesterEmail`,
  `newTagLabel` (one batched lookup each, never logged).
- **Audit log time filter**: today, yesterday, last 7 / 30 days (local days → `from` / `to`, from inclusive, to
  exclusive; backend validates and refuses a reversed range).
- **Free transfers**: a grant / revoke updates an email-filtered list in place instead of looking the email up (and
  auditing it) again.
- **Phones**: dialogs scroll inside the panel (Confirm always reachable); 16px page gutter.

## Click counts after UX-1 (from /admin)

| Task | Before | After |
|------|--------|-------|
| Find an account or token and open it | 2–3 | 0–1 (search, one match opens) |
| Suspend / retire an account | 4 | 2–3 |
| Suspend a token | 4 | 2–3 |
| Token → owner's account | no link | 1 |
| See what needs attention | open each queue | 0 to see, 1 to act |
| What an admin did yesterday | 3 + paging | 3 |
| Change staff role, reset, complete re-issue | 6 | 4–5 (UX-2: combobox + radios → ≤ 3) |

## Tests

- Backend: tsc 0; vitest **777 passed / 21 skipped** (+4: token page emails, re-issue requester / new chip, audit
  range and its validation).
- Frontend: tsc 0; vitest **247 passed** (+28: labels, sign-in mapping, display helpers, console search, needs
  attention, account links, free transfers in place, audit time filter, time ranges); eslint 0 on changed files.
- Correctness review (subagent): no blocking defects; 5 small fixes applied (`47d6c3c`).

## Deploy

No migration. `git push` (backend), confirm App Runner, then `scripts/deploy-frontend.sh staging`. Either order is safe:
the new fields are optional on the frontend.

## Follow-up (2026-10-26): Creator ID checks access + system status on top

- Boss: Admin and Support may open Creator ID checks; only Admin and Super admin may change a status.
  `review_sellers` also allowed status changes and parked-marketplace seller approvals, so two narrower permissions
  replace it on the Yoti routes: `view_creator_ids` (super_admin, admin, support) and `manage_creator_ids`
  (super_admin, admin). Migrations `20261026000002` (enum values) and `20261026000003` (grants); `review_sellers`
  stays super_admin-only. Live checks `supabase/tests/creator_id_permissions_live.sql` (4).
- Opening a creator ID record writes a `creator_id_view` audit row first (fails closed, like viewing an account's
  tokens); the account ID is validated before anything runs.
- Console: nav, routes and the record page use the new permissions; "Change status" shows only with
  `manage_creator_ids`.
- Dashboard: system status moved to the top, beside the heading.
- Tests: backend 784 (+7 `creatorIdAccess.test.ts`), frontend 250 (+3). Enum migration dry-run (rolled back) OK;
  the grant migration is checked live right after `db push` (its enum values must be committed first, and adding
  them out of band was not allowed).

## Live check (Boss)

- [x] Click-through 2026-10-26: looks good (Boss).
- [ ] Dashboard shows Needs attention with counts; nav badges match.
- [ ] Console search: an email with one account opens it; "chip_004" opens the token; a partial email lists both.
- [ ] Token chip_004: owner, ownership history and taps show emails that open the account.
- [ ] Audit log → Yesterday.
- [ ] Sign in as a suspended account shows the new message (optional).
