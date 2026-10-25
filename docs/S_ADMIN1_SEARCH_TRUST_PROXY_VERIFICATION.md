# S-ADMIN1 follow-up — Admin search, token names, trust proxy · Verification

**Date:** 2026-10-24
**Branches:** `feature/s-admin1-search` (`720e654`), `feature/trust-proxy` (`d4425a9`, `ac83b9b`), both merged to `dev`
**Backlog:** https://app.notion.com/p/4043baf6966481cab4a2d155428afa2e (Shipped)
**Decisions (Locked):** "Admin token console shows owner and creator by account email; every email search is
audit-logged first" (replaces S-ADMIN1 AC8) · "Express trust proxy = loopback + link-local + private hops"

Status: **✅ LIVE ON STAGING, verified 2026-10-24.** Backend deployed twice (22:34 and 22:46 EDT, both SUCCEEDED),
frontend deployed to staging. Boss ran the UI checks; Claude read the audit rows and backend logs back.

---

## 1. Admin search + emails (`720e654`)

- `GET /admin/tags?q=` (manage_nfc only): one term matching owner email (partial, case-insensitive), chip name,
  serial suffix or UID suffix. Term limited to `[A-Za-z0-9@._+'-]`, 2–254 chars, so it never carries PostgREST
  syntax; LIKE wildcards escaped (`escapeLike`). Email lookup capped at 50 accounts (`emailMatchesTruncated`).
- **Audit first:** each `q` search inserts an `audit_logs` row (`action tag_search`, `entity_type admin_search`,
  `entity_id` = admin id, `changes.query` = the term) **before** searching. If that insert fails, the search
  returns `unavailable` and does not run.
- `ownerEmail` / `creatorEmail` on list and detail (one batched `users` lookup). Emails never logged; the frontend
  keeps the search term in page state, not the URL (browser history).
- My Tokens / token detail / re-issue page: untitled token → chip name → `Token …<serial suffix>` → old tag-id
  fallback (`frontend/src/features/tokens/lib/tokenName.ts`). Backend `/nfc/mine` returns `chipName`, `serialSuffix`
  (never the full serial).

## 2. trust proxy (`d4425a9`, `ac83b9b`)

- Was unset since 2026-10-05: `req.ip` = App Runner's internal hop for everyone, so every express-rate-limit
  limiter shared one budget site-wide, and express-rate-limit logged `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
- Now `app.set('trust proxy', ['loopback','linklocal','uniquelocal'])` (`TRUSTED_PROXIES`, `backend/src/app.ts`).
- Security events used the **left-most** `X-Forwarded-For` entry (client-written, spoofable); they now use `req.ip`.

## Tests

| Suite | Result |
|---|---|
| Backend vitest | 659 passed, 21 skipped (was 642) |
| Frontend vitest | 153 passed (was 149) |
| tsc | 0 errors both sides |

New: `adminTags.test.ts` "search and emails" (12), `tokenReads.test.ts` fallback names, `trustProxy.test.ts` (5, real
Express + express-rate-limit), `adminTags.test.tsx` (3), `lib.test.ts` tokenDisplayName.
Mock (`supabaseMock.ts`): `ilike` contains form with Postgres `_` wildcard + backslash escapes, `or()` with `ilike` and
`in.(…)` terms, `failInsert` hook.
**Mutation-checked:** removing LIKE escaping, searching before the audit insert, trust proxy unset, trust proxy `true`,
and left-most-XFF logging each make a test fail.

## Live verification (staging, 2026-10-24)

| Check | Result |
|---|---|
| Search `test2` → `chip_001`; `chip_004` → `chip_004`; owner email on detail; My Tokens shows `chip_004` (Boss) | ✅ |
| `audit_logs` rows `tag_search` for each search, with the term | ✅ 02:38:25Z `test2`, 02:38:39Z `chip_004`, 02:52:58Z `chip_004` |
| Audit IP before fix | `::ffff:169.254.172.3` (proxy) |
| Audit IP after fix | `153.68.26.202` (public client IP) ✅ |
| Public request through `lookupLimit` after fix | `ratelimit-remaining: 59` of 60 (own budget) ✅ |
| `ERR_ERL` lines after the new instance started (22:48 EDT) | 0 ✅ (last one 22:39, old instance) |
| Email addresses in backend logs | 0 ✅ |

## Not verified / follow-ups

- The real PostgREST parse of the `or()` string was not tested before deploy (1Password locked); the live searches
  above are that test.
- Paging through results with a search re-audits each page (one row per page fetch). Acceptable.
- Backlog: "Admin console UX" (https://app.notion.com/p/4043baf6966481bc917cec65f2d7c899): resizable columns,
  whole-row click, emails throughout the token detail page (custody from/to, taps), audit-log filter dropdowns.
