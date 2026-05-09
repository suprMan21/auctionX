# Session D Close-Out Plan

**Date:** 2026-05-08  
**Branch:** `dev`  
**Objective:** Apply the waitlist migration, regenerate types, clean up the type cast, commit all in-flight landing page work, and deploy to staging.

---

## Context

Session D built four landing pages (Collector, Creator, AM Sealed, AM Proof), the ComingSoonPage, LandingNav, ProductToggle, SealPhaseAnimation, AMWordmark components, and a waitlist signup flow. All code is complete and wired. The only gap: the `waitlist_signups` migration hasn't been pushed to Supabase, so the generated types don't include that table — hence the `unknown` cast in `waitlist.ts`. Once the migration is applied and types are regenerated, that cast can be cleaned up and everything can be committed and deployed.

---

## Files Modified (already done — commit pending)

| File | Status |
|------|--------|
| `frontend/src/App.tsx` | Routes wired for all 4 landing pages + ComingSoonPage |
| `frontend/src/components/landing/LandingNav.tsx` | Landing-specific nav (no app shell) |
| `frontend/src/components/landing/WaitlistCapture.tsx` | Form → `joinWaitlist()`, WCAG-compliant |
| `frontend/src/pages/AMProofPage.tsx` | AM Proof explainer with SealPhaseAnimation |
| `frontend/src/pages/AMSealedPage.tsx` | AM Sealed explainer |
| `frontend/src/pages/CollectorLandingPage.tsx` | Root `/` + `/collector` |
| `frontend/src/pages/CreatorLandingPage.tsx` | `/creator` |

## Files to Create (untracked — commit pending)

| File | Purpose |
|------|---------|
| `frontend/src/lib/waitlist.ts` | Supabase insert for waitlist_signups table |
| `frontend/src/pages/ComingSoonPage.tsx` | Placeholder for `/login` and `/register` pre-launch |
| `supabase/migrations/20260401000001_waitlist_signups.sql` | DB table + RLS |

---

## Steps

### 1. Apply migration
```bash
cd /Volumes/myDev_Drive/Dev/dev/projectClaude/unmentionables/Unmen
npx supabase db push --project-id pmlofthmobglcfkqjtru
```

### 2. Regenerate types (both targets)
```bash
npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
```

### 3. Clean up type cast in waitlist.ts
After types are regenerated, `waitlist_signups` will appear in `Database['public']['Tables']`.
Update `frontend/src/lib/waitlist.ts` to use the typed client directly.

### 4. TypeScript check
```bash
cd frontend && npx tsc --noEmit
cd ../backend && npx tsc --noEmit
```

### 5. Commit
```bash
git add frontend/src/ supabase/migrations/
git commit -m "feat(session-d): landing pages, waitlist capture, AM sealed/proof pages"
```

### 6. Build + Deploy to staging
```bash
cd frontend && npm run build
aws s3 sync dist/ s3://auctionx-frontend-staging --delete --profile auctionx
aws cloudfront create-invalidation --distribution-id E3JOPXHI8DB4BE --paths "/*" --profile auctionx
```

---

## Database Changes

**New table:** `waitlist_signups`
- `id` UUID PK
- `email` text NOT NULL UNIQUE
- `source` text DEFAULT 'collector'
- `created_at` timestamptz DEFAULT now()
- RLS: anonymous INSERT allowed; SELECT restricted to admin/super_admin

---

## API Endpoints

None. Waitlist writes directly to Supabase via the typed client (anon key). No Express route needed.

---

## Test Plan

1. Load `/collector` → page renders, hero + waitlist form visible
2. Load `/creator` → page renders
3. Load `/am-sealed` → page renders with SealPhaseAnimation (sealed variant)
4. Load `/am-proof` → page renders with SealPhaseAnimation (proof variant)
5. Load `/login` or `/register` → ComingSoonPage renders
6. Submit waitlist form → success state shown; row appears in Supabase `waitlist_signups`
7. Submit same email twice → "You're already on the list." shown (duplicate handling)
8. Submit invalid email → browser native validation fires (type="email" required)
9. `npx tsc --noEmit` passes in both frontend/ and backend/
10. Staging URL loads without JS errors
11. WCAG axe scan (deferred — use axe extension on staging after deploy)

---

## Dependencies

- Module 07 (Design System) — `glass` utility class, Button component, dark color tokens ✅
- Supabase anon key configured in `.env` ✅
- `profiles` table with `user_role` column exists (used in admin RLS policy) ✅

---

## Estimated Effort

Single session. All code is written; execution is migration + type regen + cleanup + deploy.
