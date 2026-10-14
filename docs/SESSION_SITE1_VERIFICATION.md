# Session S-SITE1 Verification — Public site split, real AM mark, icons

**Dates:** 2026-10-12 to 2026-10-14
**Commits on `dev`:** `827b599`, `9f6f3a2`, `1298b71`, `868b225` (split, merged `67c0b67`) · `a876600` (logo) · `d71229b` (icons)

---

## What changed

1. **authentic-materials.com is its own site.** `npm run build:public` builds a landing-only bundle
   (`frontend/src/main.public.tsx` → `PublicSite.tsx`: home page + not-found) into `dist-public`. It is served by
   CloudFront `E35K71RCQGYBAW` from the private bucket `am-frontend-prod-904183418667` (OAC). Staging keeps the whole
   app on `auctionx-frontend-staging` / `E3JOPXHI8DB4BE`, and a staging deploy no longer touches the domain.
2. **Deploy script** `scripts/deploy-frontend.sh staging|public [--dry-run]` (Boss runs it). Public runs fail if
   `supabase|pk_test_|pk_live_|awsapprunner|stripe` appears anywhere in `dist-public`.
3. **Guard test** `frontend/src/pages/publicSite.test.ts`: walks every import from `main.public.tsx` and fails on app code,
   Supabase/Stripe/zustand/axios, or any `import.meta.env.VITE_` read.
4. **Real AM mark** replaces the typed "AM" in `AMWordmark.tsx` and in `favicon.svg` (path from `design-assets/svg/am-mark.svg`).
5. **Icons:** 16/32 px tab PNGs, 180 px apple-touch-icon, 192/512 px Android icons, `site.webmanifest`, `theme-color`.
   Rendered by `frontend/scripts/make-icons.mjs` (Playwright).

Setup record, console steps and rollback: `infra/s3/am-frontend-prod-904183418667/README.md`.

## Checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` (frontend) | 0 errors |
| Frontend vitest | 136 passed (11 files), includes `publicSite.test.ts` |
| Public bundle leak scan (deploy script) | clean |
| authentic-materials.com + www | landing page; JS `index-DQADRBwi.js`; no Supabase/Stripe/backend strings |
| `/admin`, `/tokens`, `/login` on the domain | public "Page not found" (no app routes) |
| Domain `/robots.txt` | `text/plain`, real file (origin check before invalidating) |
| Domain icons + manifest | all `image/png` / `application/manifest+json`, byte sizes match the build |
| Staging (2026-10-14 08:33 build `index-B-BBM-3J.js`) | `/`, `/t`, `/tokens`, `/admin` 200; Stripe test key present; new mark and icons served |
| Backend health after the `dev` push | 200 (push contained no backend code) |

## What went wrong on the way

- `am-frontend-prod` was taken by another AWS account although S3 answered `NoSuchBucket`; renamed with the account-ID suffix.
- First origin switch pointed at the wrong origin; cached `index.html` hid it while real files returned the fallback.
  Caught by checking `/robots.txt` before invalidating; fixed by setting the bucket's regional domain + OAC.
- The deploy wait looked frozen; the script now prints progress every 10 s.
