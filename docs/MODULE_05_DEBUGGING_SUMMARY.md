# Module 05 - Listing Creation Debugging Summary

## Issues Resolved ✅
1. Category seed migration enum casting (brand_restriction vs brand)
2. Import path conflicts (auth pages, supabase client)
3. App.tsx default export
4. Auth store initialization race condition
5. Auto-save triggering too early (before required fields filled)
6. Category selection visual confirmation
7. Edge Function payload validation (clean payload construction)
8. Column name mismatches (location_country vs country, etc.)
9. User verification status (NONE → APPROVED)
10. CORS headers missing DELETE method
11. Edit route not defined in App.tsx
12. Creating new listings instead of updating existing ones
13. getDraft endpoint using wrong method

## Current Outstanding Issues ❌

### 1. Photo Upload Not Persisting to Database
**Symptom:** Photos upload to S3 successfully but `draft.media` remains empty `[]`
**Impact:** Cannot publish listing because validation requires at least 1 photo
**Root Cause:** MediaUploader calls `addMedia()` to update store, but doesn't trigger `saveDraft()` to persist to database
**Files Involved:**
- `frontend/src/components/listings/MediaUploader.tsx` (upload logic)
- `frontend/src/stores/listingCreationStore.ts` (addMedia action)
- `supabase/functions/listings/index.ts` (updateDraft saves media array)

**Debug Info Needed:**
- Does `addMedia()` update the Zustand store state?
- Does auto-save trigger after photo upload?
- Check console logs for media array before/after upload
- Check `listing_media` table in Supabase after upload

### 2. Upload-URL Function 400 Error
**Symptom:** `POST /functions/v1/upload-url 400 (Bad Request)`
**Impact:** Cannot upload photos
**Attempted Fix:** Deployed with `--no-verify-jwt` flag
**Status:** Still failing
**Files Involved:**
- `supabase/functions/upload-url/index.ts`

**Debug Info Needed:**
- Check Supabase Edge Function logs for upload-url
- Verify function is deployed correctly
- Check request payload being sent
- Verify S3 credentials in Supabase secrets

### 3. Edit Listing Errors
**Symptom:** Multiple errors when clicking Edit on existing listing
**Impact:** Cannot edit existing drafts
**Status:** Partially fixed (route exists, getDraft fixed), but still throwing errors

**Debug Info Needed:**
- Specific error messages when clicking Edit
- Does loadDraft() successfully fetch the listing?
- Does the form populate with existing data?

### 4. Old/Failed Photos Showing
**Symptom:** All previously uploaded photos (including failed ones) showing in MediaUploader
**Attempted Fix:** Added filter for `!m.error` in MediaUploader
**Status:** Unknown if effective

**Debug Info Needed:**
- Check `listing_media` table for orphaned records
- Verify filter is working in MediaUploader render

## Recommended Next Steps

### Phase 1: Fix Photo Upload (Priority 1)
1. Add comprehensive logging to MediaUploader:
   - Log before/after `addMedia()` call
   - Log `draft.media` state
   - Log S3 upload response
2. Verify `addMedia()` updates Zustand store
3. Add manual `saveDraft()` call after successful upload
4. Test with Network tab open to verify media array in PUT request

### Phase 2: Fix upload-url Function (Priority 1)
1. Check Supabase Edge Function logs
2. Add console.log to upload-url function
3. Verify request body structure
4. Test S3 credentials

### Phase 3: Better Error Handling (Priority 2)
Add to all API calls and Edge Functions:
```typescript
try {
  // operation
} catch (error: any) {
  console.error('Detailed error:', {
    message: error.message,
    stack: error.stack,
    response: error.response,
    data: error.data
  });
  // User-friendly error message
  throw new Error(`Failed to [operation]: ${error.message}`);
}
```

### Phase 4: Clean Up Database (Priority 3)
1. Delete orphaned `listing_media` records
2. Delete duplicate draft listings
3. Add database constraints to prevent orphans

## Files Requiring Attention

### Frontend
- `frontend/src/components/listings/MediaUploader.tsx` - Add saveDraft() after upload
- `frontend/src/stores/listingCreationStore.ts` - Verify addMedia() logic
- `frontend/src/lib/api/listings.ts` - Add better error logging

### Backend
- `supabase/functions/upload-url/index.ts` - Add logging, verify credentials
- `supabase/functions/listings/index.ts` - Add logging to all endpoints

### Database
- Clean up `listings` table (duplicate drafts)
- Clean up `listing_media` table (orphaned records)

## Testing Checklist for Next Session
- [ ] Create new listing from scratch
- [ ] Upload single photo - verify in DB
- [ ] Upload multiple photos - verify in DB
- [ ] Save draft - verify media persisted
- [ ] Exit and return - verify media loads
- [ ] Edit existing listing - verify loads correctly
- [ ] Delete photo - verify removed from DB
- [ ] Publish listing - verify succeeds with photos
- [ ] Delete listing - verify cascade deletes media

## Environment Info
- Project: pmlofthmobglcfkqjtru
- Database: Supabase PostgreSQL
- Storage: AWS S3 (bucket: auctionx-media-prod-cl)
- Auth: Supabase Auth
- User ID: 9b9e99f1-1006-460c-b823-91a58c92f1c7
- Seller Status: APPROVED
