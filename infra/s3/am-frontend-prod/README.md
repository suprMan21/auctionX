# am-frontend-prod

Private bucket for the **public site**: what `authentic-materials.com` and `www` serve.

**Why a separate bucket:** until this split the public domain's CloudFront distribution
(`E35K71RCQGYBAW`) read the staging bucket `auctionx-frontend-staging`. Every staging
deploy changed the public site, and the public domain served the whole staging app
(`/admin`, `/tokens`, the Stripe test key). Now the two are separate sites:

| | Staging | Public |
|---|---|---|
| Serves | the whole app | landing pages only (`frontend/src/PublicSite.tsx`) |
| Build | `npm run build` → `dist/` | `npm run build:public` → `dist-public/` |
| Bucket | `auctionx-frontend-staging` | `am-frontend-prod` |
| CloudFront | `E3JOPXHI8DB4BE` | `E35K71RCQGYBAW` |
| Deploy | `scripts/deploy-frontend.sh staging` | `scripts/deploy-frontend.sh public` |

The public build holds no app code, backend URL or key (checked by
`frontend/src/pages/publicSite.test.ts` and again by the deploy script). Staging chips are
not affected: they are encoded with the staging CloudFront URL, not the domain.

## Console setup (Boss, once)

Do the steps in order. The public site keeps serving the old build until step 5, and
step 4 puts the new build in place first, so there is no gap.

1. **Create the bucket.** S3 → Create bucket.
   - Name `am-frontend-prod`, region **us-east-2**.
   - Object Ownership: **ACLs disabled**.
   - **Block all public access: ON** (all four boxes).
   - Default encryption: **SSE-S3**. Versioning: **Enable** (a bad deploy can be rolled back).
   - Do **not** turn on static website hosting. CloudFront reads the bucket directly.

2. **Bucket policy.** Bucket → Permissions → Bucket policy → paste `bucket-policy.json`.
   Only the `E35K71RCQGYBAW` distribution can read objects.

3. **Let the deploy user write to it.** IAM → Users → `auctionx-deploy` → Add permissions →
   Create inline policy → JSON → paste `deploy-access-policy.json`. Name: `PublicSiteDeploy`.
   (Skip the CloudFront statement if the user's existing policy already allows
   invalidations on `E35K71RCQGYBAW`; it did on 2026-10-09.)

4. **First upload, before switching the origin.** From the repo root:
   ```bash
   scripts/deploy-frontend.sh public --dry-run     # builds, checks, prints the commands
   scripts/deploy-frontend.sh public
   ```
   The upload succeeds; the final "waiting for authentic-materials.com" check **fails this
   one time**, because the domain still reads the staging bucket. That is expected.

5. **Point the distribution at the new bucket.** CloudFront → `E35K71RCQGYBAW`.
   - **Origins → Create origin.** Origin domain: pick
     `am-frontend-prod.s3.us-east-2.amazonaws.com` (the bucket itself, not a
     `s3-website` address). Origin access: **Origin access control settings** → Create new
     OAC (defaults: sign requests) → Create origin.
   - **Behaviors → Default (\*) → Edit.** Origin: the new `am-frontend-prod` origin.
     Viewer protocol policy: **Redirect HTTP to HTTPS**. Save.
   - **General → Settings → Edit.** Default root object: `index.html`.
   - **Error pages.** Make sure both exist (add them if missing). A private bucket answers
     403 for a path that is not a file, and the page handles its own "not found":
     | HTTP error | Response page path | Response code |
     |---|---|---|
     | 403 | `/index.html` | 200 |
     | 404 | `/index.html` | 200 |
   - Wait for the distribution status to leave **Deploying**, then delete the old staging
     origin from the **Origins** tab.

6. **Check.**
   ```bash
   scripts/deploy-frontend.sh public      # this time the wait passes
   ```
   In a browser: `https://authentic-materials.com/` shows the home page,
   `https://authentic-materials.com/admin` shows "Page not found" (not the sign-in page),
   and `https://d1bwev65w7rqzl.cloudfront.net/admin` still shows the staging sign-in.

## After the switch

- Staging deploys no longer touch the public site, and the public site is deployed only by
  `scripts/deploy-frontend.sh public`.
- At launch this bucket takes the production app build (live Stripe key, production
  `VITE_API_URL`); see `docs/LAUNCH_CHECKLIST.md` §6.
- Roll back a bad public deploy: S3 → `am-frontend-prod` → `index.html` → Versions →
  restore the previous one, then invalidate `E35K71RCQGYBAW`.
