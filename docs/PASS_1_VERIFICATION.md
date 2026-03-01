# Pass 1 Verification — TypeScript Compiler Output

**Date:** 2026-02-28
**Pass:** 1 (Foundation Repair)
**Command:** `npx tsc --noEmit 2>&1`
**Note:** These errors are the Pass 2 target baseline. No fixes were applied here.

---

## Summary

| Target   | Error Count | Exit Code |
|----------|-------------|-----------|
| Frontend | 24          | 2         |
| Backend  | 31          | 2         |

---

## Frontend — `unmentionables/Unmen/frontend/`

**Error count: 24**

### Grouped by file

| File | Errors | Root cause |
|------|--------|------------|
| `src/components/listings/steps/MediaStep.tsx` | 1 | Unused import `ListingMedia` |
| `src/components/listings/steps/PricingStep.tsx` | 2 | Implicit `any` indexing tier fee map |
| `src/components/listings/steps/ReviewStep.tsx` | 1 | `err` typed `unknown` in catch |
| `src/features/auth/pages/LoginPage.tsx` | 1 | `string \| null` vs `string \| undefined` |
| `src/features/profile/pages/ProfilePage.tsx` | 8 | Queries non-existent `user_profiles` table; uses columns `bio`, `profile_photo_url`, `display_name` not on `users`; `Button` prop `as` doesn't exist |
| `src/lib/api/listings.ts` | 2 | Unused `result` var; `string` passed where enum literal expected |
| `src/pages/CreateListing.tsx` | 1 | `"draft"` passed where `"DRAFT"` enum required |
| `src/pages/Dashboard.tsx` | 2 | `"active"` vs `"ACTIVE"` enum; `current_price` column doesn't exist on `listings` |
| `src/pages/MyListings.tsx` | 1 | `current_price` column doesn't exist on `listings` |
| `src/pages/ViewListing.tsx` | 1 | `err` typed `unknown` in catch |
| `src/stores/listingCreationStore.ts` | 3 | `id: string \| undefined` vs `string`; `type: string` vs `"IMAGE" \| "VIDEO"` literal |
| `src/test/e2e/accessibility.spec.ts` | 1 | Unused variable `accessibilityScanResults` |

### Raw output

```
src/components/listings/steps/MediaStep.tsx(1,30): error TS6133: 'ListingMedia' is declared but its value is never read.
src/components/listings/steps/PricingStep.tsx(16,30): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type '{ TIER_1: number; TIER_2: number; TIER_3: number; }'.
src/components/listings/steps/PricingStep.tsx(17,52): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type '{ TIER_1: number; TIER_2: number; TIER_3: number; }'.
src/components/listings/steps/ReviewStep.tsx(19,16): error TS18046: 'err' is of type 'unknown'.
src/features/auth/pages/LoginPage.tsx(82,15): error TS2322: Type 'string | null' is not assignable to type 'string | undefined'.
  Type 'null' is not assignable to type 'string | undefined'.
src/features/profile/pages/ProfilePage.tsx(47,15): error TS2769: No overload matches this call.
  Overload 1 of 2, '(relation: "admin_users" | "admin_roles" | "users" | "listings" | "auctions" | "categories" | "transactions" | "payments" | "audit_logs" | "bids" | "crypto_payments" | "listing_media" | ... 6 more ... | "shipping_addresses"): PostgrestQueryBuilder<...>', gave the following error.
    Argument of type '"user_profiles"' is not assignable to parameter of type '"admin_users" | "admin_roles" | "users" | "listings" | "auctions" | "categories" | "transactions" | "payments" | "audit_logs" | "bids" | "crypto_payments" | "listing_media" | ... 6 more ... | "shipping_addresses"'.
  Overload 2 of 2, '(relation: never): PostgrestQueryBuilder<{ PostgrestVersion: "14.1"; }, { Tables: { admin_roles: { Row: { created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | ... 4 more ... | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; }; Insert: { ...; }; Update: { ...; }; Relationships: []; }; ... 17 more ...; users: { ...; }; }; Views: {}; Functions: { ...; }; Enums: { ...; }; CompositeTypes: {}; }, never, never, never>', gave the following error.
    Argument of type '"user_profiles"' is not assignable to parameter of type 'never'.
src/features/profile/pages/ProfilePage.tsx(55,20): error TS2345: Argument of type '{ created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; } | ... 17 more ... | { ...; }' is not assignable to parameter of type 'SetStateAction<Profile | null>'.
  Type '{ created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; }' is not assignable to type 'SetStateAction<Profile | null>'.
src/features/profile/pages/ProfilePage.tsx(56,29): error TS2339: Property 'display_name' does not exist on type '{ created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; } | ... 17 more ... | { ...; }'.
  Property 'display_name' does not exist on type '{ created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; }'.
src/features/profile/pages/ProfilePage.tsx(57,21): error TS2339: Property 'bio' does not exist on type '{ created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; } | ... 17 more ... | { ...; }'.
  Property 'bio' does not exist on type '{ created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; }'.
src/features/profile/pages/ProfilePage.tsx(58,30): error TS2339: Property 'profile_photo_url' does not exist on type '{ created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; } | ... 17 more ... | { ...; }'.
  Property 'profile_photo_url' does not exist on type '{ created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; }'.
src/features/profile/pages/ProfilePage.tsx(129,15): error TS2769: No overload matches this call.
  Overload 1 of 2, '(relation: "admin_users" | "admin_roles" | "users" | "listings" | "auctions" | "categories" | "transactions" | "payments" | "audit_logs" | "bids" | "crypto_payments" | "listing_media" | ... 6 more ... | "shipping_addresses"): PostgrestQueryBuilder<...>', gave the following error.
    Argument of type '"user_profiles"' is not assignable to parameter of type '"admin_users" | "admin_roles" | "users" | "listings" | "auctions" | "categories" | "transactions" | "payments" | "audit_logs" | "bids" | "crypto_payments" | "listing_media" | ... 6 more ... | "shipping_addresses"'.
  Overload 2 of 2, '(relation: never): PostgrestQueryBuilder<{ PostgrestVersion: "14.1"; }, { Tables: { admin_roles: { Row: { created_at: string | null; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | ... 4 more ... | "view_audit_logs")[]; role_id: string; role_name: string; updated_at: string | null; }; Insert: { ...; }; Update: { ...; }; Relationships: []; }; ... 17 more ...; users: { ...; }; }; Views: {}; Functions: { ...; }; Enums: { ...; }; CompositeTypes: {}; }, never, never, never>', gave the following error.
    Argument of type '"user_profiles"' is not assignable to parameter of type 'never'.
src/features/profile/pages/ProfilePage.tsx(130,10): error TS2769: No overload matches this call.
  Overload 1 of 2, '(values: { created_at?: string | null | undefined; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id?: string | undefined; role_name: string; updated_at?: string | ... 1 more ... | undefined; } | ... 17 more ... | { ...; }, options?: { ...; } | undefined): PostgrestFilterBuilder<...>', gave the following error.
    Object literal may only specify known properties, and 'bio' does not exist in type '{ created_at?: string | null | undefined; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id?: string | undefined; role_name: string; updated_at?: string | ... 1 more ... | unde...'.
  Overload 2 of 2, '(values: ({ created_at?: string | null | undefined; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id?: string | undefined; role_name: string; updated_at?: string | ... 1 more ... | undefined; } | ... 17 more ... | { ...; })[], options?: { ...; } | undefined): PostgrestFilterBuilder<...>', gave the following error.
    Object literal may only specify known properties, and 'user_id' does not exist in type '({ created_at?: string | null | undefined; permissions: ("view_users" | "manage_users" | "view_listings" | "moderate_listings" | "view_payments" | "process_refunds" | "view_analytics" | "manage_admins" | "view_audit_logs")[]; role_id?: string | undefined; role_name: string; updated_at?: string | ... 1 more ... | und...'.
src/features/profile/pages/ProfilePage.tsx(198,73): error TS2322: Type '{ children: string; type: "button"; variant: "secondary"; size: "md"; as: string; }' is not assignable to type 'IntrinsicAttributes & ButtonProps'.
  Property 'as' does not exist on type 'IntrinsicAttributes & ButtonProps'.
src/lib/api/listings.ts(82,19): error TS6133: 'result' is declared but its value is never read.
src/lib/api/listings.ts(174,34): error TS2345: Argument of type 'string' is not assignable to parameter of type 'NonNullable<"DRAFT" | "ACTIVE" | "CANCELLED" | "PENDING_REVIEW" | "SOLD" | "REMOVED">'.
src/pages/CreateListing.tsx(91,10): error TS2769: No overload matches this call.
  Overload 1 of 2, '(values: { brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at?: string | undefined; currency?: "CAD" | ... 1 more ... | undefined; ... 14 more ...; updated_at?: string | undefined; }, options?: { ...; } | undefined): PostgrestFilterBuilder<...>', gave the following error.
    Type '"draft"' is not assignable to type '"DRAFT" | "ACTIVE" | "CANCELLED" | "PENDING_REVIEW" | "SOLD" | "REMOVED" | undefined'. Did you mean '"DRAFT"'?
  Overload 2 of 2, '(values: { brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at?: string | undefined; currency?: "CAD" | ... 1 more ... | undefined; ... 14 more ...; updated_at?: string | undefined; }[], options?: { ...; } | undefined): PostgrestFilterBuilder<...>', gave the following error.
    Object literal may only specify known properties, and 'seller_id' does not exist in type '{ brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at?: string | undefined; currency?: "CAD" | "USD" | undefined; ... 14 more ...; updated_at?: string | undefined; }[]'.
src/pages/Dashboard.tsx(30,23): error TS2345: Argument of type '"active"' is not assignable to parameter of type 'NonNullable<"DRAFT" | "ACTIVE" | "CANCELLED" | "PENDING_REVIEW" | "SOLD" | "REMOVED">'.
src/pages/Dashboard.tsx(35,19): error TS2345: Argument of type 'SelectQueryError<"column 'current_price' does not exist on 'listings'.">[]' is not assignable to parameter of type 'SetStateAction<Listing[]>'.
  Type 'SelectQueryError<"column 'current_price' does not exist on 'listings'.">[]' is not assignable to type 'Listing[]'.
    Type '{ error: true; } & String' is missing the following properties from type 'Listing': id, title, current_price, ending_at, photo_url
src/pages/MyListings.tsx(42,19): error TS2345: Argument of type 'SelectQueryError<"column 'current_price' does not exist on 'listings'.">[]' is not assignable to parameter of type 'SetStateAction<Listing[]>'.
  Type 'SelectQueryError<"column 'current_price' does not exist on 'listings'.">[]' is not assignable to type 'Listing[]'.
    Type '{ error: true; } & String' is missing the following properties from type 'Listing': id, title, current_price, status, and 2 more.
src/pages/ViewListing.tsx(24,16): error TS18046: 'err' is of type 'unknown'.
src/stores/listingCreationStore.ts(148,45): error TS2345: Argument of type '{ id: string | undefined; title: string; description: string; category_id: string; condition: string; reserve_price_cents: number; currency: "CAD" | "USD"; country: string; region: string; city: string; postal_fsa: string; media: ListingMedia[]; }' is not assignable to parameter of type 'UpdateListingDraft'.
  Types of property 'id' are incompatible.
    Type 'string | undefined' is not assignable to type 'string'.
      Type 'undefined' is not assignable to type 'string'.
src/stores/listingCreationStore.ts(172,15): error TS2322: Type '{ duration_seconds: number | null; height: number | null; id: string; listing_id: string; s3_bucket: string; s3_key: string; size_bytes: number; sort_order: number; thumbnail_url: string | null; type: string; uploaded_at: string; url: string; width: number | null; }[]' is not assignable to type 'ListingMedia[]'.
  Type '{ duration_seconds: number | null; height: number | null; id: string; listing_id: string; s3_bucket: string; s3_key: string; size_bytes: number; sort_order: number; thumbnail_url: string | null; type: string; uploaded_at: string; url: string; width: number | null; }' is not assignable to type 'ListingMedia'.
    Types of property 'type' are incompatible.
      Type 'string' is not assignable to type '"IMAGE" | "VIDEO"'.
src/stores/listingCreationStore.ts(198,13): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
  Type 'undefined' is not assignable to type 'string'.
src/test/e2e/accessibility.spec.ts(80,11): error TS6133: 'accessibilityScanResults' is declared but its value is never read.
```

---

## Backend — `unmentionables/Unmen/backend/`

**Error count: 31**

### Grouped by file

| File | Errors | Root cause |
|------|--------|------------|
| `src/__tests__/auctions.test.ts` | 1 | Test fixture missing required `brand` field; `seller_id` not an Insert key |
| `src/controllers/auctionController.ts` | 2 | `req.params.id` typed `string \| string[]` (Express 5), needs `as string` |
| `src/controllers/bidController.ts` | 11 | `logger` not a named export from `../lib/logger`; `ErrorCode` is a type used as value; `req.params` Express 5 typing; `.warning()` should be `.warn()` |
| `src/controllers/paymentController.ts` | 4 | `req.params` Express 5 typing; `content_flags` doesn't exist on `listings` table; `Transaction` type mismatch (local type vs DB row) |
| `src/middleware/adminAuth.ts` | 4 | Array not narrowed to single item before property access; `.catch()` missing on `PromiseLike` (Express 5 async) |
| `src/middleware/auditLog.ts` | 2 | `.catch()` missing on `PromiseLike` (Express 5 async) |
| `src/middleware/auth.ts` | 1 | `AuthRequest` extends Express `Request` but `user` type is narrower than Supabase `User` |
| `src/routes/auctions.ts` | 2 | Handler typed against `AuctionRequest` but route expects Express 5 `RequestHandler` |
| `src/server.ts` | 1 | Middleware passed where `PathParams` expected (Express 5 overload change) |
| `src/services/payment/processors/StripeProcessor.ts` | 1 | `"card"` string not assignable to Stripe SDK `Type` enum |

### Raw output

```
src/__tests__/auctions.test.ts(38,8): error TS2769: No overload matches this call.
  Overload 1 of 2, '(values: { brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at?: string | undefined; currency?: "CAD" | ... 1 more ... | undefined; ... 14 more ...; updated_at?: string | undefined; }, options?: { ...; } | undefined): PostgrestFilterBuilder<...>', gave the following error.
    Argument of type '{ seller_id: string; title: string; description: string; category_id: string; condition: "NEW"; status: "ACTIVE"; }' is not assignable to parameter of type '{ brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at?: string | undefined; currency?: "CAD" | "USD" | undefined; ... 14 more ...; updated_at?: string | undefined; }'.
      Property 'brand' is missing in type '{ seller_id: string; title: string; description: string; category_id: string; condition: "NEW"; status: "ACTIVE"; }' but required in type '{ brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at?: string | undefined; currency?: "CAD" | "USD" | undefined; ... 14 more ...; updated_at?: string | undefined; }'.
  Overload 2 of 2, '(values: { brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at?: string | undefined; currency?: "CAD" | ... 1 more ... | undefined; ... 14 more ...; updated_at?: string | undefined; }[], options?: { ...; } | undefined): PostgrestFilterBuilder<...>', gave the following error.
    Object literal may only specify known properties, and 'seller_id' does not exist in type '{ brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at?: string | undefined; currency?: "CAD" | "USD" | undefined; ... 14 more ...; updated_at?: string | undefined; }[]'.
src/controllers/auctionController.ts(23,17): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
src/controllers/auctionController.ts(62,25): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
src/controllers/bidController.ts(3,10): error TS2305: Module '"../lib/logger"' has no exported member 'logger'.
src/controllers/bidController.ts(22,26): error TS2693: 'ErrorCode' only refers to a type, but is being used as a value here.
src/controllers/bidController.ts(36,17): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
src/controllers/bidController.ts(41,26): error TS2693: 'ErrorCode' only refers to a type, but is being used as a value here.
src/controllers/bidController.ts(46,26): error TS2693: 'ErrorCode' only refers to a type, but is being used as a value here.
src/controllers/bidController.ts(51,26): error TS2693: 'ErrorCode' only refers to a type, but is being used as a value here.
src/controllers/bidController.ts(56,26): error TS2693: 'ErrorCode' only refers to a type, but is being used as a value here.
src/controllers/bidController.ts(63,9): error TS2693: 'ErrorCode' only refers to a type, but is being used as a value here.
src/controllers/bidController.ts(73,9): error TS2769: No overload matches this call.
  Overload 1 of 2, '(values: { amount_cents: number; auction_id: string; bidder_id: string; created_at?: string | undefined; id?: string | undefined; is_auto_bid?: boolean | undefined; max_bid_cents?: number | null | undefined; }, options?: { ...; } | undefined): PostgrestFilterBuilder<...>', gave the following error.
    Type 'string | string[]' is not assignable to type 'string'.
      Type 'string[]' is not assignable to type 'string'.
  Overload 2 of 2, '(values: { amount_cents: number; auction_id: string; bidder_id: string; created_at?: string | undefined; id?: string | undefined; is_auto_bid?: boolean | undefined; max_bid_cents?: number | null | undefined; }[], options?: { ...; } | undefined): PostgrestFilterBuilder<...>', gave the following error.
    Object literal may only specify known properties, and 'auction_id' does not exist in type '{ amount_cents: number; auction_id: string; bidder_id: string; created_at?: string | undefined; id?: string | undefined; is_auto_bid?: boolean | undefined; max_bid_cents?: number | null | undefined; }[]'.
src/controllers/bidController.ts(83,26): error TS2693: 'ErrorCode' only refers to a type, but is being used as a value here.
src/controllers/bidController.ts(89,17): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
src/controllers/bidController.ts(109,9): error TS2339: Property 'warning' does not exist on type '{ debug: (message: string, fields?: LogFields | undefined) => void; info: (message: string, fields?: LogFields | undefined) => void; warn: (message: string, fields?: LogFields | undefined) => void; error: (message: string, fields?: LogFields | undefined) => void; }'.
src/controllers/paymentController.ts(20,17): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
src/controllers/paymentController.ts(38,25): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
src/controllers/paymentController.ts(68,43): error TS2339: Property 'content_flags' does not exist on type '{ brand: "AUCTIONX" | "UNMENTIONABLES"; category_id: string; condition: "NEW" | "LIKE_NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR"; created_at: string; currency: "CAD" | "USD"; deleted_at: string | null; ... 13 more ...; updated_at: string; }'.
src/controllers/paymentController.ts(73,11): error TS2322: Type '{ amount_cents: number; auction_id: string; buyer_id: string; cascade_correlation_id: string; content_flags: ("CONCERT_GEAR" | "MEMORABILIA" | "AUTOGRAPHED" | "SPORTS_EQUIPMENT" | ... 11 more ... | "INTIMATE_ITEMS")[]; ... 14 more ...; updated_at: string; } | { ...; }' is not assignable to type 'Transaction'.
  Type '{ amount_cents: number; auction_id: string; buyer_id: string; cascade_correlation_id: string; content_flags: ("CONCERT_GEAR" | "MEMORABILIA" | "AUTOGRAPHED" | "SPORTS_EQUIPMENT" | "VINTAGE_COLLECTIBLES" | ... 10 more ... | "INTIMATE_ITEMS")[]; ... 14 more ...; updated_at: string; }' is missing the following properties from type 'Transaction': auctionId, buyerId, sellerId, amountCents, and 6 more.
src/controllers/paymentController.ts(152,17): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
src/middleware/adminAuth.ts(109,35): error TS2339: Property 'role_name' does not exist on type '{ role_name: any; permissions: any; }[]'.
src/middleware/adminAuth.ts(110,42): error TS2339: Property 'permissions' does not exist on type '{ role_name: any; permissions: any; }[]'.
src/middleware/adminAuth.ts(121,8): error TS2339: Property 'catch' does not exist on type 'PromiseLike<void>'.
src/middleware/adminAuth.ts(121,15): error TS7006: Parameter 'err' implicitly has an 'any' type.
src/middleware/auditLog.ts(30,12): error TS2339: Property 'catch' does not exist on type 'PromiseLike<void>'.
src/middleware/auditLog.ts(30,19): error TS7006: Parameter 'err' implicitly has an 'any' type.
src/middleware/auth.ts(4,18): error TS2430: Interface 'AuthRequest' incorrectly extends interface 'Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>'.
  Types of property 'user' are incompatible.
    Type '{ id: string; email?: string | undefined; } | undefined' is not assignable to type 'User | undefined'.
      Type '{ id: string; email?: string | undefined; }' is missing the following properties from type 'User': app_metadata, user_metadata, aud, created_at
src/routes/auctions.ts(8,20): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type '(req: AuctionRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>' is not assignable to parameter of type 'Application<Record<string, any>>'.
      Type '(req: AuctionRequest, res: Response<any, Record<string, any>>) => Promise<Response<any, Record<string, any>> | undefined>' is missing the following properties from type 'Application<Record<string, any>>': init, defaultConfiguration, engine, set, and 63 more.
src/routes/auctions.ts(9,25): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type '(req: AuctionRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>' is not assignable to parameter of type 'Application<Record<string, any>>'.
      Type '(req: AuctionRequest, res: Response<any, Record<string, any>>) => Promise<Response<any, Record<string, any>> | undefined>' is missing the following properties from type 'Application<Record<string, any>>': init, defaultConfiguration, engine, set, and 63 more.
src/server.ts(16,9): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type '(req: RequestWithId, res: Response, next: NextFunction) => void' is not assignable to parameter of type 'PathParams'.
src/services/payment/processors/StripeProcessor.ts(71,11): error TS2322: Type '"card"' is not assignable to type 'Type'.
```
