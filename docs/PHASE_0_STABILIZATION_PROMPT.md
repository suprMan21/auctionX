# Phase 0: Stabilization Prompt

## Instructions
Copy everything below the line and paste it into Claude Code. This is a multi-step stabilization pass to get both builds to zero TypeScript errors and fix the critical security issue.

---

We just completed a full codebase audit (see `docs/AUDIT_REPORT.md`). Both frontend and backend fail to compile. There's also a critical security issue in a deployed Edge Function. I need you to fix everything in this exact order. Do NOT skip steps or reorder.

**Important:** The actual project root is `unmentionables/Unmen/` — all paths are relative to there.

## Step 1: Regenerate Backend Database Types

The backend `database.ts` has 9 tables but production has 19. This causes ~10 of the 12 backend TS errors.

```bash
cd unmentionables/Unmen/
npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
cp frontend/src/types/database.types.ts backend/src/types/database.ts
```

After running this, verify both files have the same content and include tables like `payment_attempts`, `processor_health`, `admin_roles`, `transactions`, etc.

If `npx supabase` is not available, check if the Supabase CLI is installed. If not, run `npm install -g supabase` first.

## Step 2: Fix Frontend Enum Case Mismatches

Three files use lowercase enum values that don't match the PostgreSQL UPPERCASE enums:

1. **`frontend/src/pages/CreateListing.tsx`** — Change `"draft"` to `"DRAFT"` (around line 91)
2. **`frontend/src/pages/Dashboard.tsx`** — Change `"active"` to `"ACTIVE"` (around line 30)
3. **`frontend/src/pages/MyListings.tsx`** — If it has lowercase enums, fix those too

Search for: any `.eq('status', 'draft')` or `.eq('status', 'active')` patterns and uppercase them.

## Step 3: Fix ProfilePage.tsx — Nonexistent Table

`frontend/src/features/profile/pages/ProfilePage.tsx` queries a `user_profiles` table that doesn't exist. The actual table is `users`.

**Option A (preferred):** Rewrite the Supabase queries to use the `users` table. The `users` table has: `id`, `email`, `display_name`, `seller_tier`, `is_banned`, `is_suspended`, `created_at`, `updated_at`. It does NOT have `bio` or `profile_photo_url`.

For `bio` and `profile_photo_url`, create a migration to add them as optional columns:

```sql
-- File: supabase/migrations/YYYYMMDDHHMMSS_add_profile_fields.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
```

Then regenerate types (repeat Step 1) and update `ProfilePage.tsx` to query `users` instead of `user_profiles`.

**Option B (if you want to skip the migration for now):** Remove `bio` and `profile_photo_url` references from ProfilePage and just use what exists on `users`. We can add them later.

Go with Option A unless the migration fails.

## Step 4: Fix Dashboard.tsx and MyListings.tsx — Wrong Column

Both pages query `current_price` on the `listings` table. This column doesn't exist — `current_price_cents` is on the `auctions` table.

Fix by either:
- Joining to `auctions` table: `.select('*, auctions(current_price_cents)')` 
- Or removing the `current_price` reference if it's just for display and can be deferred

## Step 5: Fix listingCreationStore.ts Type Errors

Three issues in `frontend/src/stores/listingCreationStore.ts` (or wherever the canonical version lives):
1. `string | undefined` not assignable to `string` — Add null guards (`?? ''` or similar)
2. `type: string` not assignable to `"IMAGE" | "VIDEO"` — Cast: `as "IMAGE" | "VIDEO"` after DB fetch
3. Another `string | undefined` — Same fix as #1

## Step 6: Fix lib/api/listings.ts

1. Remove unused `result` variable (line ~82)
2. Fix `listing_status` enum mismatch — ensure status filter passes the correct type

## Step 7: Fix Backend Express 5 Typing

`backend/src/server.ts` line 16 — the `requestIdMiddleware` doesn't match Express 5's stricter `app.use()` signature.

Fix: Cast the middleware:
```typescript
app.use(requestIdMiddleware as express.RequestHandler);
```

## Step 8: Fix Backend Payment Service Enum

After Step 1 regenerates types, check if `backend/src/services/payment/CascadeOrchestrator.ts` still references `SEGPAY`. If so, update to `SIGNATURE` to match the actual DB enum.

Also check if `StripeProcessor.ts` line 71 has a type mismatch on `"card"` — fix the Stripe SDK type if needed.

## Step 9: Fix Button Component (Optional)

`frontend/src/components/Button.tsx` — ProfilePage tries to use an `as` prop for polymorphic rendering. Either:
- Add `as` prop support to Button (using `React.ElementType`)
- Or change ProfilePage to use `<Link>` directly instead of `<Button as={Link}>`

## Step 10: Verify Both Builds

```bash
cd unmentionables/Unmen/frontend && npx tsc --noEmit
cd ../backend && npx tsc --noEmit
```

**Target: ZERO errors in both.** If any remain, fix them before proceeding.

## Step 11: Fix Security — process-payment Edge Function

**CRITICAL:** `supabase/functions/process-payment/index.ts` has:
```typescript
const mockUserId = '2e6c5e9d-5fd4-4c14-8b3f-909e21986b72';
// TEMP: Skip auth for local testing
```

Fix:
1. Remove the mockUserId constant
2. Implement proper auth: extract JWT from `Authorization` header, verify with Supabase
3. Fix table name: `payment_transactions` → `transactions`
4. Fix column references: `listings.content_flags` doesn't exist (content flags may need a migration or different lookup)
5. Fix `listings.current_price` → join to `auctions.current_price_cents`

**Do NOT deploy this until all fixes are verified locally.**

## Step 12: Delete Dead Files

```bash
cd unmentionables/Unmen/
rm -f backend/src/controllers/auctionControllers.ts          # Orphaned duplicate
rm -f frontend/src/stores/authStore.ts                       # Unused copy
rm -f frontend/src/features/auth/components/authStore.ts     # Misplaced unused copy
rm -rf supabase/functions/supabase/                          # Accidental nested directory
```

## Step 13: Fix frontend/.env Formatting

The `.env` file has a missing newline:
```
VITE_AWS_REGION=us-east-1VITE_API_URL=http://localhost:3001/api/v1
```
Should be:
```
VITE_AWS_REGION=us-east-1
VITE_API_URL=http://localhost:3001/api/v1
```

## Step 14: Clean Firebase Artifacts

```bash
cd unmentionables/Unmen/
rm -f .firebaserc firebase.json firebase-debug.log firestore-debug.log
```

Update `.gitignore` — remove any Firebase-specific entries and add:
```
# Legacy
firebase-debug.log
firestore-debug.log
```

## Step 15: Final Verification

Run the full check:
```bash
cd unmentionables/Unmen/
echo "=== Frontend Type Check ===" && cd frontend && npx tsc --noEmit && echo "✅ PASS" || echo "❌ FAIL"
cd ..
echo "=== Backend Type Check ===" && cd backend && npx tsc --noEmit && echo "✅ PASS" || echo "❌ FAIL"
cd ..
echo "=== Frontend Build ===" && cd frontend && npm run build && echo "✅ PASS" || echo "❌ FAIL"
```

**Commit when all three pass:**
```bash
git add -A
git commit -m "fix: Phase 0 stabilization — zero TS errors, security fix, dead code cleanup"
```

Save a summary of everything you changed to `docs/PHASE_0_CHANGES.md`.
