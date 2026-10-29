# S-SEAL1 Ph2b — public seal page, seal pictures, Share — verification

Plan: `docs/plans/2026-10-28-s-seal1-ph2.md` (Ph2b + "Ph2b infra check"). Branch `feature/s-seal1-ph2b`, worktree
`.claude/worktrees/s-seal1-ph2b`, off `dev` `4e04d9b`.
Date: 2026-10-29 (Toronto). Status: **code done, merged to local `dev`; not yet live** (Boss steps below).

## What shipped

| Part | Where | Notes |
|---|---|---|
| Server seal | `backend/src/lib/seal/sealSvg.ts`, `colorPairs.ts` | The still **Sealed** seal as SVG from the stored spec (same geometry, white rings, muted with the website's `saturate(.6) brightness(.82)` as an SVG filter). Never the Verified look. `null` spec = generic seal (no code, no pattern). Path strings re-checked (`M` / `l` / `Z` only). |
| Pictures | `backend/src/lib/seal/sealImages.ts` | resvg-js **2.6.2** + qrcode **1.5.4** (exact pins), fonts bundled in `backend/assets/fonts/` (Plus Jakarta Sans 600/800, IBM Plex Mono 600/700, OFL licences alongside; no system fonts, so Mac and Linux draw the same). Preview 1200×630 (~240 KB, budget 300 KB), generic 1200×630 (no code), share 1080×1920 (~465 KB) with QR → `/s/<code>`, link and the band "Picture only. Tap the seal to check it." ~20 ms / ~60 ms to draw. |
| S3 | `backend/src/lib/seal/sealImageStore.ts` | Bucket `SEAL_IMAGES_BUCKET` (default AWS chain = instance role; static keys not used). Keys `seal-img/<XXXX-XXXX>/preview-v1.png` and `seal-img/generic-v1.png` (previews `public, max-age=600`, generic 1 day), `share/<XXXX-XXXX>/share-v1-<base-url hash>.png` (`private, no-store`, never public; a new base URL draws fresh QR pictures). S3 client: 2 s connect / 5 s request timeout, 2 attempts, so enroll can never hang on S3. No bucket set: every call is a no-op. The role cannot read `seal-img/*`, so the generic picture is stored once per process instead of checked. |
| Migration | `supabase/migrations/20261029000001_seal_images.sql` | `nfc_tags.seal_images_at TIMESTAMPTZ` (when the preview was stored; NULL = none) + two partial indexes + pg_cron `seal-images-tick` at `3-59/10` → `POST /api/v1/internal/seal-images` with `x-tick-secret` from Vault `seal_images_tick_secret` (sends nothing until the secret exists). No grant change. |
| Tick | `backend/src/routes/sealImagesTick.ts`, `backend/src/lib/seal/sealImageSync.ts` | Shared secret `SEAL_IMAGES_TICK_SECRET` (constant time; unset / < 24 chars → 503). Removes pictures of seals on hold / released / retired first (clears the mark), then draws a random 40 of up to 200 live seals (ENROLLED / ACTIVE) without one (failing rows cannot hold the batch) (stores the spec too). If a seal stops being live while it is drawn, the guarded mark matches nothing and the picture is removed at once. First tick = the backfill. |
| Enroll | `tagManagementController.ts` | Draws the preview right after the spec; never blocks the enroll (the tick retries). |
| Seal page | `backend/src/routes/sealPage.ts`, `backend/src/lib/seal/sealPage.ts`, mounted in `app.ts` at `/s` **before** CORS / version gate / body parsers | Server HTML, **no JavaScript**. Any case, spaces, hyphens, I/L → 1, O → 0; a valid code not in `XXXX-XXXX` form → **301** to `/s/XXXX-XXXX`. Live seal: still Sealed seal (text as outlines, so no font loads), code, status line, reliance sentence (P5), how to check, and the public story from `public_tag_provenance` only (creator, origin, origin date, claimed, https origin video). Never owner, tag id, serial, UID, chip name, Ownership ID. Unknown / malformed / on hold / released / retired: **one identical page, 200**, noindex (the distribution rewrites 404s). Headers: CSP `default-src 'none'; style-src 'sha256-…'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `Cache-Control: public, max-age=60, stale-if-error=3600`, `X-Robots-Tag: noindex` (until `SEAL_PAGE_ALLOW_INDEX=true`), nosniff, no-referrer, DENY. DB or render failure → 503 no-store (CloudFront serves the last good copy for up to 1 h). Rate limit 3000 / min per `req.ip`, a backstop for direct origin calls only (behind CloudFront `req.ip` is a shield address shared by all viewers); no RateLimit headers (they would be cached). `og:image` = the seal's preview once drawn, else the generic picture. `x-powered-by` now off app-wide. |
| Share picture API | `GET /api/v1/nfc/:tagId/share-image` (`sealShareController.ts`) | `requireAuth` + read limit, no step-up (DR-22). Current owner only (earlier owner / stranger / released → 403, owned seal on hold → 409, bad id → 404). PNG `no-store`. Served from S3 when stored, else drawn and stored; works with S3 down. |
| Web | `frontend/src/features/tokens/components/SealShare.tsx`, token page **Share** card, My Seals cards (row moved outside the card link) | **Share link** (share sheet with the URL, else copy, "Link copied.") and **Share picture** (PNG as a file, else download). Never link and file together. Safari refusing the sheet after the fetch (`NotAllowedError`) keeps the picture and says "Tap Share picture again." Live seals only. Link = this site's origin + `/s/<code>`. |

## Tests

- Backend: tsc 0; vitest **1206 passed / 23 skipped** (new: `sealImages.test.ts` 13 in `lib/seal`, `__tests__/sealPage.test.ts` 31, `__tests__/sealImages.test.ts` 17; allowlist test now lists the seal-images tick; supabase mock gained `not(col, 'in', '(…)')`).
- Frontend: tsc 0; vitest **481 passed** (new: `SealShare.test.tsx` 18, incl. axe and copy rules).
- `database.types.ts` (both copies) hand-edited with `seal_images_at`; regenerate after `db push`.
- Linux x64 (Docker `node:22`, `--platform linux/amd64`) 2026-10-29: `npm ci` installs `@resvg/resvg-js-linux-x64-gnu`; `npm run build`, then render from `dist/`: preview 239 KB at 1200 px, share 459 KB, outlined seal has no `<text>` ✅.
- Live SQL `supabase/tests/seal_images_live.sql` (9 checks, rolls back).

## Boss steps (in order)

The code is safe to deploy before any setting exists: no bucket → no pictures (page uses the generic image URL), no secret → tick answers 503, no Vault secret → cron sends nothing.

1. Apply: `supabase db push --linked` (applies `20261029000001_seal_images.sql` only), then
   `supabase db query --linked -f supabase/tests/seal_images_live.sql` → `RESULTS {...}` with 9 × `ok`.
2. Push `dev`; run `scripts/verify-backend-deploy.sh` (wait for SUCCEEDED).
3. Make one secret: `openssl rand -hex 32` (no trailing newline anywhere).
   - App Runner `auctionX_backend_staging` → Configuration → environment variables, add:
     `SEAL_IMAGES_BUCKET=am-seal-images-staging`, `PUBLIC_SEAL_BASE_URL=https://d1bwev65w7rqzl.cloudfront.net`,
     `SEAL_IMAGES_TICK_SECRET=<secret>` → Save (starts a deploy; wait for SUCCEEDED).
   - Supabase SQL editor: `SELECT vault.create_secret('<secret>', 'seal_images_tick_secret');`
4. First tick runs at the next :03 / :13 / … minute. CloudWatch: `seal_images_tick` with `generic: "stored"`, `drawn` = number of live seals.
5. Probes (Claude can run these):
   - `curl -sI https://d1bwev65w7rqzl.cloudfront.net/s/WAV4-F6TT` → 200, `content-security-policy`, `x-cache: Miss|Hit from cloudfront` (not `Error`).
   - `curl -sI https://d1bwev65w7rqzl.cloudfront.net/s/wav4f6tt` → 301 to `/s/WAV4-F6TT`.
   - `curl -sI https://d1bwev65w7rqzl.cloudfront.net/seal-img/WAV4-F6TT/preview-v1.png` → 200 `image/png`.
   - `curl -s https://d1bwev65w7rqzl.cloudfront.net/s/ZZZZ-ZZZZ | grep "can't show"` → the shared page.
6. Frontend staging deploy: `scripts/deploy-frontend.sh staging`.
7. iPhone: paste `https://d1bwev65w7rqzl.cloudfront.net/s/WAV4-F6TT` into iMessage and WhatsApp → preview shows the seal picture and title. Signed in as test@: token page → Share → **Share link** (share sheet) and **Share picture** (share sheet with the PNG; save it, scan the QR, it opens the seal page). Open an unknown code → "We can't show this seal."

## Security review (independent agent, 2026-10-29)

No High. Fixed: shared-shield rate limit (now a high backstop; per-viewer limit → CloudFront / WAF follow-up), S3 timeouts on the enroll path, preview cache 1 day → 10 min, stale-if-error 1 day → 1 h, render errors → generic 503 (not JSON), stuck draw batch, share key tied to the base URL, RateLimit headers off. Open: (a) WAF / CloudFront rate rule for `/s/*` (Boss, before launch); (b) the web Share link uses the page's own origin while pictures print `PUBLIC_SEAL_BASE_URL` (same host on staging; align at the ECS / domain cutover); (c) **Boss to confirm**: story fields an owner chose to show on the tap page are now visible to anyone with the code, without a tap. That matches the Share copy ("Anyone with the link sees the seal and the story you chose to show"), but the disclosure settings' wording should say so too.

## Known behaviour

- A removed preview can stay in CloudFront's cache up to 10 min after the tick removes it (tick every 10 min), so up to ~20 min after a hold / release / retire. The page stops pointing at it within ~60 s of the tick.
- The share picture prints `PUBLIC_SEAL_BASE_URL`; stored copies keep the host they were drawn with (production uses its own bucket).
- Link previewers cache on their side too (iMessage especially).

## Live results

- 2026-10-29: dry run on staging (BEGIN … migration … `seal_images_live.sql` … ROLLBACK): **9/9 ok**.
