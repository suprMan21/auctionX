# AuctionX Module Status (Post-Audit)

**Last Updated:** March 1, 2026 (Pass 4 — cleanup complete)
**Audit Date:** February 28, 2026
**Phase 0 Completed:** March 1, 2026 — 0 TS errors frontend/backend, critical security fix, dead code purge, route wiring, rate limiting, docs consolidation
**Honest Progress:** 9/18 modules production-ready

---

## Module Health Summary

| Module | Claimed | Audit Reality | Blocking Issues |
|--------|---------|---------------|-----------------|
| 01 Core Domain Models | ✅ LOCKED | ⚠️ Reference only | Firebase dependency, can't validate at runtime |
| 02 Auction Mechanics | ✅ LOCKED | ✅ Valid | Pure functions work, needs porting from Firebase |
| 03 Authentication | ✅ Ready | ✅ Ready | ✅ Fixed: /forgot-password route wired (Pass 4) |
| 04 User Profiles | ✅ Ready | ✅ Ready | ✅ Fixed: ProfilePage rewritten for users table (Pass 2) |
| 05 Listing Management | ✅ Ready | ✅ Ready | ✅ Fixed: enum case mismatches resolved (Pass 2) |
| 06 Browse & Search | ✅ Ready | ❌ Not built | No routes, no pages, no search UI exists |
| 07 Design System | ✅ Ready | ✅ Ready | ✅ Fixed: Header wired into authenticated layout (Pass 4) |
| 08 Auction Frontend+Backend | ✅ Ready | ✅ Ready | ✅ Fixed: bid rate limiting added (Pass 4) |
| 09 Payment Cascade | ⚠️ Deployed | ⚠️ Security fixed | ✅ Fixed: mockUserId removed, table names corrected (Pass 3). Awaiting API keys |
| 10 Admin Dashboard | Backend ✅ | Backend ✅ | Frontend not started (as documented) |

---

## ✅ ACTUALLY PRODUCTION-READY

### Module 02: Auction Mechanics — LOCKED
- Pure functions: `auction.mechanics.ts`, `auction.proxy.ts`, `auction.invariants.ts`
- No Firebase dependency in the logic itself (only in Zod schema wrappers)
- Deterministic, well-tested
- **Needs:** Porting out of `functions/` directory to standalone TS module

### Module 03: Authentication
- Login, Signup, ForgotPassword, auth store, ProtectedRoute, Supabase Auth integration
- `/forgot-password` route wired in Pass 4
- `/signup` links corrected to `/register` across LoginPage and Header
- **Status:** PRODUCTION READY

### Module 04: User Profiles
- ProfilePage rewritten in Pass 2 to query `users` table with migration for `bio`/`avatar_url`
- Components exist: ProfileHeader, ProfileEditForm, ShippingAddressForm
- **Status:** PRODUCTION READY

### Module 05: Listing Management
- 7-step creation wizard functional
- Enum casing (`DRAFT`, `ACTIVE`, etc.) fixed in Pass 2
- Type errors in listingCreationStore resolved in Pass 2
- **Status:** PRODUCTION READY

### Module 07: Design System
- Components: Button, Input, Modal, ErrorBoundary, SellerTierBadge
- WCAG 2.2 AA (36/36 accessibility tests)
- Header component wired into authenticated layout in Pass 4
- **Status:** PRODUCTION READY

### Module 08: Auction Mechanics Frontend + Backend
- Full auction detail page with real-time bids
- Express backend with user-scoped Supabase clients
- Proxy bidding via PostgreSQL triggers
- Rate limiting on bid endpoint (10 bids/min/IP) added in Pass 4
- **Known gap:** bid history not paginated
- **Status:** PRODUCTION READY (pending settlement)

### Module 10: Admin Dashboard — Backend Only
- Zero trust auth, session versioning, tiered rate limiting
- 8 admin API endpoints, audit logging
- **Frontend:** NOT STARTED
- **Status:** BACKEND PRODUCTION READY

---

## ⚠️ NEEDS WORK

### Module 01: Core Domain Models — LOCKED
- Zod schemas import `firebase-admin/firestore` — can't instantiate at runtime
- Enum values have DIVERGED from SQL (ListingStatus, AuctionStatus, PaymentProcessor)
- **Useful as:** Type reference documentation (README added in Pass 4)
- **Needs:** Port valuable schemas to Supabase-compatible versions (Phase 1)

### Module 09: Payment Cascade
- All 5 processor implementations exist in Edge Functions
- Cascade orchestrator with retry logic and correlation IDs
- ✅ Fixed: `mockUserId` removed, correct auth from JWT (Pass 3)
- ✅ Fixed: table names corrected (`transactions` not `payment_transactions`)
- ✅ Fixed: removed nonexistent column references
- **Remaining:** API keys for PaymentCloud, CCBill, Signature, NOWPayments still pending
- **Remaining:** Content flags come from client request body (needs server-side validation)
- **Remaining:** Edge Function not yet deployed (pending env vars + QA)
- **Status:** CODE READY, AWAITING API KEYS AND DEPLOYMENT

---

## ❌ NOT BUILT / INCOMPLETE

### Module 06: Browse & Search
- `CategoryBrowser.tsx` exists as a listing creation wizard step only
- **No browse page, no search results page, no search bar, no routes**
- **Status:** NEEDS FULL BUILD

### Module 10 Frontend: Admin Dashboard UI
- No components, no routes, no pages
- **Status:** NOT STARTED

### Module 11: Auction Settlement
- Escrow, winner notification, cascade to next bidder
- **Note:** Pure auction mechanics in `functions/src/v1/services/auctions/` can be ported here
- **Status:** NOT STARTED

### Module 12: Seller Payouts
- Auto-release after escrow period
- **Status:** NOT STARTED

### Module 13: NFC Verification System — CRITICAL PATH
- Token generation, video proof, NFC programming, public verification pages
- **Status:** NOT STARTED

### Module 14: Enhanced Search
- Full-text search, advanced filters, saved searches
- **Status:** NOT STARTED

### Module 15: Messaging System
- Buyer-seller communication
- **Status:** NOT STARTED

### Module 16: Notifications
- Email, push, in-app
- **Status:** NOT STARTED

### Module 17: E2E Testing & Security
- Playwright tests, security audit
- **Status:** NOT STARTED

### Module 18: Launch Prep
- Production environment, monitoring, backups
- **Status:** NOT STARTED

---

## Technical Debt (from Audit)

### Resolved in Phase 0 (Passes 1–4)
- ✅ Backend DB types regenerated (19 tables)
- ✅ Frontend .env formatting error fixed
- ✅ Three copies of authStore.ts — orphaned copies deleted
- ✅ Orphaned auctionControllers.ts deleted
- ✅ Accidental nested supabase/ directory deleted
- ✅ Express payment services deleted (payments live in Edge Functions)
- ✅ Fee percentages wrong in paymentController.ts — file deleted
- ✅ ProfilePage rewritten for correct tables
- ✅ Enum case mismatches resolved
- ✅ mockUserId security issue removed from Edge Function
- ✅ Header wired into authenticated layout
- ✅ `/signup` links corrected to `/register`
- ✅ Docs consolidated to single location (unmentionables/Unmen/docs/)
- ✅ Bid rate limiting added (10/min/IP)
- ✅ /forgot-password route wired

### Remaining Structural
- Firebase config files still present (.firebaserc, firebase.json, debug logs) — non-blocking
- `functions/` directory contains Firebase-dependent schemas — documented as reference-only
- Fee tier lookup in Edge Function defaults to TIER_1 on failure (acceptable fallback)
- Content flags sourced from client request in process-payment (needs server-side validation)

---

## Recommended Build Order (Post-Stabilization)

1. **Phase 0:** ✅ COMPLETE — zero TS errors, security fix, dead code cleanup, housekeeping
2. **Phase 1:** Module 06 (Browse/Search), Module 09 deployment (API keys), Module 10 frontend
3. **Phase 2:** Module 11 (settlement), Module 12 (payouts)
4. **Phase 3:** Module 13 (NFC), Module 14 (search), Module 15 (messaging)
5. **Phase 4:** Module 16 (notifications), Module 17 (testing), Module 18 (launch)
