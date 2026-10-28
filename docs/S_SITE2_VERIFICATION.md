# S-SITE2 — Story-first public homepage + early-access signup: verification

Brief: Notion "S-SITE2 — Story-First Public Homepage (Draft 2.4 build)". Branches
`feature/s-site2-homepage` (merged `db4c4fa`) and `feature/s-site2-early-access`.

## Gates (all Locked, Decisions DB, 2026-10-28)

| Gate | Answer |
|---|---|
| G1 copy | Story-first lines Locked; LOOK FOR IT / WORK WITH US retired |
| G2 placeholders | Generic: "Sealed by the captain / artist / painter"; every canvas placeholder replaced |
| G3 early access | One backend route saves + sends; DB webhook retired; staging until S-REL1 |
| G4 footer | Contact only until legal pages pass counsel |
| G5 claim | Launch seal frangible; wording held to BPL-9 until S-SEC1 (see Claims) |
| Claims | "Built to resist copies", "Made to stay put", "designed to break", "shows where it came from" |

## Acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Gates answered before code | ✅ | Decisions DB entries above |
| 2 | Matches Draft 2.4 at 1440 / 390 | ✅ | Playwright full-page captures at 1280 / 375 / 1440, section order checked |
| 3 | Landing-only: one call, no app routes | ✅ | `publicSite.test.ts`: exactly one network call (the signup), one backend host, no app code, no env reads |
| 4 | Unreleased seal names absent from `dist/` | ✅ | grep of `dist-public`: 0 seal-name hits (only React `crossOrigin` / CSS `transform-origin`) |
| 5 | SealBadge spins + pulses; stops under reduced motion | ✅ | Browser: `animationName` `am-sealspin` → `none` with reduced motion; CSS test |
| 6 | tsc 0, vitest green, eslint 0 (new files) | ✅ | backend 1126 passed / 23 skipped; frontend 412; repo-wide eslint has the same 47 pre-existing problems as `dev` |
| 7 | 1280 / 375 screenshots, nothing over the headline | ✅ | Overlap check: no element intersects the h1; no sideways scroll |
| 8 | Signup writes one row, one welcome email, consent stored, unsubscribe works | ✅ | Live on staging 2026-10-28 06:06 (deploy SUCCEEDED 02:06 ET): signup from origin authentic-materials.com → 202, CORS ok; repeat → identical 202, no second email; one row, source `home`, consent wording matches, `welcome_sent_at` set, log `early_access_welcome sent:true`. Boss signed up on the live public site 06:30 (welcome delivered, Gmail Promotions); unsubscribed from the email link 06:41:23 (`changed:true`), second press `changed:false` |
| 9 | This report | ✅ | |

## Early-access signup (G3)

- `POST /api/v1/early-access` (`backend/src/routes/earlyAccess.ts`): Zod (strict), honeypot, ≥2.5 s fill
  time, proof-of-work (16 bits, bound to email + timestamp), MX / A fallback + throwaway-domain list
  (fails open on DNS errors), 5 per IP per 10 min, 300 per hour overall, identical 202 for new / repeat /
  dropped. Writes with the service role; email after the reply, never blocks.
- Welcome email: table layout from `Email-welcome.dc.html`, 2x PNG art in `frontend/public/email/`
  (served from authentic-materials.com/email after the public deploy), CASL sender + address,
  `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058). No unsubscribe secret → no email (logged).
- Unsubscribe: HMAC link; GET shows a confirm button (link scanners can't unsubscribe anyone),
  POST unsubscribes; mail-app one-click honoured. Re-signing up after unsubscribing restores consent
  and sends one fresh welcome.
- Alerts (GitHub Issue, counts only): spike at `EARLY_ACCESS_SPIKE_PER_HOUR` (50); database failing
  (usually the staging auto-pause).
- Migration `20261028000002` (applied to staging 2026-10-28, live `early_access_live.sql` 9/9):
  consent / unsubscribe / welcome columns, open INSERT policy dropped, anon + authenticated writes
  revoked, `waitlist_welcome` trigger dropped.
- Parked pages' `WaitlistCapture` now links to `/#access`; `lib/waitlist.ts` deleted.
- Local browser run: the public build reached the route with CORS passing; proof-of-work took
  ~0.3 s on desktop and ~1.4 s with CPU slowed 6×. Database leg not run locally (stale local
  service key; 1Password not signed in): covered by the staging run below.

## Deploy (Boss)

1. Create the secret: `openssl rand -hex 32` → 1Password `AM_Development/Early access/unsubscribe-secret`
   → App Runner env `EARLY_ACCESS_UNSUBSCRIBE_SECRET`. Never rotate (old links break).
2. Push `dev`; run `scripts/verify-backend-deploy.sh` (App Runner SUCCEEDED, new route answers).
3. Claude runs the live signup against staging (one email to `hello+ea-test@authentic-materials.com`),
   checks the row, consent, `welcome_sent_at`, then unsubscribes via the link.
4. `scripts/deploy-frontend.sh public --dry-run`, then without the flag; confirm `/robots.txt`, then
   `/email/hero.png`, then the page on a phone.

## Live on the public site

Public deploy 2026-10-28 (bundle `index-Cc1yfG5V.js`). Note: an earlier public deploy shipped the
pre-signup homepage build (`index-BfLLNTOt.js`, form always failing) for a short time; fixed by this deploy.

## Follow-ups

- ~~Delete the unused `waitlist-welcome` edge function~~ Done 2026-10-28 (404). Its secret `WAITLIST_WEBHOOK_SECRET` is still set in Supabase: Boss to unset.
- Regenerate `database.types.ts` (new columns); the store uses an untyped client meanwhile.
- Restore the canvas claims when S-SEC1 exits clean ("proves it's real" never returns).
- Add Privacy / Terms links when counsel passes the pages (G4).
- Move signups to prod at S-REL1 (no webhook, so the copy sends nothing).
