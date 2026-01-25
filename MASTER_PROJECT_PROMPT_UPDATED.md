# AuctionX Master Project Prompt
**Version:** 1.1  
**Last Updated:** January 25, 2026  
**Project:** AuctionX - Dual-Brand Auction Marketplace Platform

---

## Version History

- **v1.1** (Jan 25, 2026): Added Module 04 completion, terminal verification workflows, Supabase CLI integration, schema type generation best practices
- **v1.0** (Jan 25, 2026): Initial comprehensive project prompt with complete tech stack and module structure

---

## Project Overview

AuctionX is a dual-brand auction marketplace platform for parasocial commerce, consisting of two distinct marketplaces:
- **AuctionX:** Mainstream sports memorabilia and celebrity merchandise (SFW)
- **Unmentionables:** Creator merchandise including personal items and adult content (NSFW)

**Target Users:**
- Semi-professional athletes selling equipment
- Content creators selling merchandise to fans
- Buyers seeking authentic memorabilia and creator items

**Key Differentiators:**
- Dual-brand architecture with cross-promotion
- Robust multi-layer verification system
- Deferred payment with cascade failover
- Marketplace-native solutions over custom development

---

## Tech Stack

### Frontend
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **State Management:** Zustand
- **Routing:** React Router v6
- **HTTP Client:** Supabase client library
- **Location:** `/Users/chris/Desktop/unmentionables/unmen/frontend`

### Backend
- **Runtime:** Node.js 20
- **Language:** TypeScript
- **Database:** Supabase PostgreSQL
- **Auth:** Supabase Auth with RLS
- **Functions:** Firebase Functions (migrating away)
- **Location:** `/Users/chris/Desktop/unmentionables/unmen/functions`

### Infrastructure
- **Database:** Supabase PostgreSQL with Row Level Security
- **Storage:** AWS S3 (bucket: `auctionx-media-prod-cl`, region: `us-east-2`)
- **CDN:** AWS CloudFront (optional)
- **Payment Processing:**
  - Stripe (SFW content)
  - PaymentCloud (SFW categories)
  - Segpay (NSFW/adult content)
- **Age Verification:** Yoti
- **Chargeback Prevention:** Verifi, Riskified

### Development Tools
- **Package Manager:** npm
- **Version Control:** Git
- **Database Migrations:** Supabase CLI
- **Type Generation:** Supabase CLI (`supabase gen types`)
- **Environment:** `.env` files with `VITE_` prefix for frontend

---

## Project Structure
```
unmen/
├── frontend/                    # React + TypeScript + Vite
│   ├── src/
│   │   ├── features/           # Feature-based modules
│   │   │   ├── auth/           # Module 03: Authentication
│   │   │   │   ├── components/
│   │   │   │   ├── hooks/
│   │   │   │   ├── lib/
│   │   │   │   ├── pages/
│   │   │   │   └── store/
│   │   │   └── profile/        # Module 04: User Profiles
│   │   │       ├── components/
│   │   │       ├── hooks/
│   │   │       ├── lib/
│   │   │       ├── pages/
│   │   │       └── store/
│   │   ├── components/         # Shared UI components
│   │   │   └── ui/
│   │   ├── types/              # TypeScript types
│   │   │   └── database.types.ts  # Generated from Supabase
│   │   └── App.tsx
│   ├── .env                    # Environment variables (VITE_ prefix)
│   └── package.json
├── functions/                   # Firebase Functions (legacy, migrating)
│   ├── src/
│   │   ├── v1/
│   │   │   ├── lib/
│   │   │   │   └── s3.ts       # S3 upload utilities
│   │   │   └── routes/
│   │   │       └── media.ts    # Photo upload endpoint
│   │   └── index.ts
│   └── package.json
├── supabase/
│   └── migrations/             # Database migrations
└── docs/                       # Project documentation
```

---

## Completed Modules

### ✅ Module 01: Core Domain Models
- PostgreSQL schema with comprehensive tables
- Enums for status, tiers, roles
- Indexes for performance
- **Status:** Complete

### ✅ Module 02: Auction Mechanics
- Pure domain logic for auctions
- Bid validation and processing
- Reserve price logic
- **Status:** Complete

### ✅ Module 03: Authentication
- Supabase Auth with email/password
- Row Level Security (RLS) policies
- Zustand auth store
- Login/signup/forgot password pages
- Protected routes
- Session persistence
- Auto-create user trigger
- **Status:** Complete
- **Routes:** `/login`, `/signup`

### ✅ Module 04: User Profiles
- Profile viewing and editing
- Photo upload component (UI complete, endpoint pending)
- Shipping address CRUD
- Seller stats display with tier progress
- Public seller profiles
- Zustand profile store
- **Status:** 95% Complete (photo upload backend pending)
- **Routes:** `/profile`, `/seller/:id`
- **Database Tables:** `users`, `shipping_addresses`
- **Key Components:**
  - ProfileHeader, ProfileEditForm
  - PhotoUploadButton (needs backend endpoint)
  - SellerStats, SellerTierBadge
  - ShippingAddressList, ShippingAddressForm
  - SellerProfileCard

---

## Database Schema Overview

### Key Tables
- `users` - User accounts with seller tiers and verification status
- `shipping_addresses` - User shipping addresses with default tracking
- `listings` - Item listings with media and metadata
- `auctions` - Active auctions with bidding data
- `bids` - Bid history and tracking
- `transactions` - Payment and settlement records
- `verification_submissions` - User verification requests

### Key Enums
- `tier_level`: TIER_1, TIER_2, TIER_3
- `user_role`: user, moderator, admin, super_admin, support, finance
- `verification_status`: NONE, PENDING, APPROVED, REJECTED
- `brand_type`: AUCTIONX, UNMENTIONABLES
- `auction_status`: draft, scheduled, active, ended, cancelled, settled

### RLS Policies
- Users can view/update own profile
- Public can view all user profiles (for seller pages)
- Users can CRUD own shipping addresses
- Admins have elevated permissions

---

## Environment Variables

### Frontend (.env)
```bash
VITE_SUPABASE_URL=https://pmlofthmobglcfkqjtru.supabase.co
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_QOUABgX8WDKnr_OOaTKPTA__H_3ZPx7
VITE_API_URL=http://localhost:5001/auctionx-dev/us-central1  # Local dev
```

### Functions (.env.local)
```bash
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
AWS_S3_BUCKET=auctionx-media-prod-cl
AWS_REGION=us-east-2
AWS_CLOUDFRONT_DOMAIN=<optional>
```

---

## Development Workflows

### Terminal Verification Pattern
**When you need to verify paths, existing code, schemas, or project structure:**
1. Provide terminal commands for Boss to run
2. Be direct about what you need to see
3. Don't ask clarifying questions - give commands

**Example:**
```bash
# Instead of: "Where is your S3 upload code?"
# Provide:
cd /Users/chris/Desktop/unmentionables/unmen/functions && find src -type f -name "*s3*"
cat /path/to/s3.ts
```

### Database Schema Management

**Generating TypeScript Types:**
```bash
cd /Users/chris/Desktop/unmentionables/unmen
supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
```

**Always regenerate types after schema changes to ensure TypeScript accuracy**

### Migration Workflow
1. Create migration file in `supabase/migrations/`
2. Name format: `YYYYMMDDHHMMSS_description.sql`
3. Make migrations idempotent (DROP IF EXISTS, CREATE IF NOT EXISTS)
4. Apply: `supabase db push`
5. Verify: Check Supabase dashboard SQL Editor

### Frontend Development
```bash
cd frontend
npm run dev          # Start dev server
npm run build        # Production build
npm run preview      # Preview production build
```

### Functions Development
```bash
cd functions
npm run build        # Compile TypeScript
npm run serve        # Local emulator (if using Firebase)
```

---

## Module Development Guidelines

### File Organization
- **Feature-based structure:** Each module in `frontend/src/features/`
- **Component hierarchy:** pages → components → hooks → lib → store
- **Shared components:** In `frontend/src/components/ui/`
- **Type definitions:** Generated in `frontend/src/types/database.types.ts`

### Code Standards
- **TypeScript:** Strict mode enabled, no `any` types
- **Error handling:** Try/catch with detailed logging, user-friendly messages
- **Validation:** Client-side and database constraints
- **Accessibility:** WCAG 2.1 AA compliance
- **State management:** Zustand for complex state, React hooks for local state

### Database Constraints
- **Schema Lock:** Never modify locked modules (01, 02)
- **RLS Always:** Every table must have Row Level Security enabled
- **Migrations:** Always idempotent, always tested
- **Enums:** Use database enums for status fields, match TypeScript types exactly

### Component Patterns
- **Hooks first:** Custom hooks for data fetching and mutations
- **Error boundaries:** Graceful error handling in UI
- **Loading states:** Show spinners/skeletons during async operations
- **Optimistic updates:** Update UI before server confirmation where appropriate

---

## Authentication Flow

1. User signs up with email/password
2. Supabase sends confirmation email
3. User confirms email
4. Trigger creates user record in `public.users`
5. User logs in
6. Session stored in localStorage via Supabase SDK
7. Protected routes check `useAuth()` hook
8. RLS policies enforce data access

---

## Payment Architecture

### Three-Processor System
1. **Stripe:** Primary processor for SFW content
2. **PaymentCloud:** Backup for SFW categories
3. **Segpay:** Exclusive for NSFW/adult content

### Deferred Payment Window
- 20-minute window for payment after auction win
- Cascade system: Try Stripe → PaymentCloud → Segpay
- Automatic Pro tier promotion at $10K annual sales

### Fee Structure
- **TIER_1 (Bronze):** 15% platform fee
- **TIER_2 (Silver):** 10% platform fee  
- **TIER_3 (Gold):** 5% platform fee

**Tier Thresholds:**
- TIER_1: $0 - $9,999 trailing 12mo sales
- TIER_2: $10K - $99,999 trailing 12mo sales
- TIER_3: $100K+ trailing 12mo sales

---

## Verification System

### Multi-Layer Verification
1. **Government ID:** Front and back photo upload
2. **Video Challenge:** Random prompt verification
3. **Social Proof:** Link to social media accounts
4. **Age Verification:** Yoti integration (18+)

### Verification Status Flow
- NONE → User not verified
- PENDING → Submitted, awaiting review
- APPROVED → Verified seller
- REJECTED → Verification failed (with reason)

---

## S3 Media Storage

### Bucket Structure
```
auctionx-media-prod-cl/
├── profiles/{userId}/{timestamp}_{filename}
├── listings/{listingId}/{timestamp}_{filename}
└── verification/{userId}/{timestamp}_{type}.{ext}
```

### Upload Flow (Current - Firebase Functions)
1. Frontend requests pre-signed URL from `/v1/media/upload-url`
2. Backend generates S3 pre-signed URL (5min expiry)
3. Frontend uploads directly to S3
4. Frontend updates database with public URL

### File Constraints
- **Images:** JPEG, PNG, WebP, GIF (max 5MB)
- **Videos:** MP4 (max 50MB)
- **Profile photos:** Max 5MB

---

## Boss Communication Preferences

### Code Delivery
- Token-optimized responses (code first, minimal explanations)
- Command drop-ins without inline comments
- Direct terminal commands for verification
- No embedded comments in commands (except Claude Code context)

### Interaction Style
- **Sarcasm:** 6/10
- **Humor:** 7/10
- **Sass:** 7/10
- **Intelligence:** 10/10
- **Approach:** Challenge ideas, don't just agree
- **Questions:** Ask clarifying questions upfront, front-load verification

### Project Philosophy
- "Build solutions, not limits" when facing constraints
- Comprehensive foundations over shortcuts
- Rapid development without sacrificing quality
- Marketplace-native solutions preferred
- Canadian location provides regulatory advantages

---

## Development Checklist (Current State)

### Completed ✅
- [x] PostgreSQL schema with RLS
- [x] Supabase Auth integration
- [x] Frontend skeleton (React + TypeScript + Vite + Tailwind)
- [x] Authentication module (login, signup, protected routes)
- [x] User profile management (view, edit, shipping addresses)
- [x] Seller stats and tier display
- [x] Public seller profile pages
- [x] Session persistence
- [x] Database type generation workflow
- [x] Supabase CLI integration

### In Progress 🚧
- [ ] Photo upload backend endpoint (S3 integration)
- [ ] Migration away from Firebase Functions

### Pending ⏳
- [ ] Listing creation module
- [ ] Auction mechanics module
- [ ] Payment processing integration
- [ ] Verification submission flow
- [ ] Admin dashboard
- [ ] Seller analytics
- [ ] Buyer transaction history

---

## Known Issues & Technical Debt

### Photo Upload
- **Issue:** Backend endpoint `/v1/media/upload-url` needs implementation
- **Impact:** Users cannot upload profile photos
- **Solution:** Build Express endpoint or migrate to new backend
- **Priority:** Medium (UI complete, functionality pending)

### Firebase Migration
- **Issue:** Currently using Firebase Functions for backend
- **Plan:** Migrate to standalone Express/Node.js server
- **Reason:** Moving away from Firebase ecosystem
- **Priority:** High (blocking photo upload and future endpoints)

### Type Safety
- **Best Practice:** Always regenerate types after schema changes
- **Command:** `supabase gen types typescript --project-id pmlofthmobglcfkqjtru`
- **Lesson:** Manual type definitions cause drift and TypeScript errors

---

## Common Pitfalls & Solutions

### RLS Policy Recursion
**Problem:** Policies that check `auth.uid()` in subqueries cause infinite recursion  
**Solution:** Use simple `USING (true)` for public read access, restrict with UPDATE policies

### Schema Enum Case Mismatch
**Problem:** Database uses uppercase enums (TIER_1), code uses lowercase (tier_1)  
**Solution:** Always generate types from database, never manually define

### Missing User Records
**Problem:** Auth triggers may not fire for existing users  
**Solution:** Manually insert missing records, ensure triggers work for new signups

### Supabase Single/MaybeSingle
**Problem:** `.single()` fails if query returns 0 or 2+ rows  
**Solution:** Use `.maybeSingle()` when row may not exist

---

## Next Session Priorities

1. **Photo Upload Endpoint**
   - Build Express endpoint for S3 pre-signed URLs
   - Test photo upload flow end-to-end
   - Deploy to production

2. **Firebase Migration Planning**
   - Define new backend architecture
   - Plan migration strategy
   - Identify all Firebase dependencies

3. **Module 05: Listing Creation**
   - Photo upload for listing media
   - Category selection
   - Item condition tracking
   - Draft/publish workflow

---

## Git Workflow

### Commit Message Format
```
feat(module-XX): description

- Detail 1
- Detail 2

Tested:
- Test 1
- Test 2

Closes: Module XX
Next: Module YY
```

### Current Branch
- **Main:** `dev`
- **Feature branches:** Per module when needed

---

## Quick Reference Commands

### Frontend
```bash
cd /Users/chris/Desktop/unmentionables/unmen/frontend
npm run dev                    # Start dev server
npm run build                  # Production build
npm run preview                # Preview build
```

### Functions
```bash
cd /Users/chris/Desktop/unmentionables/unmen/functions
npm run build                  # Compile TypeScript
```

### Supabase
```bash
cd /Users/chris/Desktop/unmentionables/unmen
supabase login                 # Authenticate CLI
supabase link --project-ref pmlofthmobglcfkqjtru
supabase db push              # Apply migrations
supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
```

### Database
```sql
-- Check user exists
SELECT * FROM auth.users WHERE id = '<uuid>';
SELECT * FROM public.users WHERE id = '<uuid>';

-- Manually create user
INSERT INTO public.users (id, email, role, seller_tier)
VALUES ('<uuid>', '<email>', 'user', 'TIER_1');
```

---

## Resources

- **Supabase Docs:** https://supabase.com/docs
- **React Router:** https://reactrouter.com
- **Tailwind CSS:** https://tailwindcss.com
- **Zustand:** https://zustand-demo.pmnd.rs
- **AWS S3 SDK:** https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3

---

**END OF MASTER PROJECT PROMPT v1.1**
EOFcat > /Users/chris/Desktop/unmentionables/unmen/MASTER_PROJECT_PROMPT_UPDATED.md << 'EOF'
# AuctionX Master Project Prompt
**Version:** 1.1  
**Last Updated:** January 25, 2026  
**Project:** AuctionX - Dual-Brand Auction Marketplace Platform

---

## Version History

- **v1.1** (Jan 25, 2026): Added Module 04 completion, terminal verification workflows, Supabase CLI integration, schema type generation best practices
- **v1.0** (Jan 25, 2026): Initial comprehensive project prompt with complete tech stack and module structure

---

## Project Overview

AuctionX is a dual-brand auction marketplace platform for parasocial commerce, consisting of two distinct marketplaces:
- **AuctionX:** Mainstream sports memorabilia and celebrity merchandise (SFW)
- **Unmentionables:** Creator merchandise including personal items and adult content (NSFW)

**Target Users:**
- Semi-professional athletes selling equipment
- Content creators selling merchandise to fans
- Buyers seeking authentic memorabilia and creator items

**Key Differentiators:**
- Dual-brand architecture with cross-promotion
- Robust multi-layer verification system
- Deferred payment with cascade failover
- Marketplace-native solutions over custom development

---

## Tech Stack

### Frontend
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **State Management:** Zustand
- **Routing:** React Router v6
- **HTTP Client:** Supabase client library
- **Location:** `/Users/chris/Desktop/unmentionables/unmen/frontend`

### Backend
- **Runtime:** Node.js 20
- **Language:** TypeScript
- **Database:** Supabase PostgreSQL
- **Auth:** Supabase Auth with RLS
- **Functions:** Firebase Functions (migrating away)
- **Location:** `/Users/chris/Desktop/unmentionables/unmen/functions`

### Infrastructure
- **Database:** Supabase PostgreSQL with Row Level Security
- **Storage:** AWS S3 (bucket: `auctionx-media-prod-cl`, region: `us-east-2`)
- **CDN:** AWS CloudFront (optional)
- **Payment Processing:**
  - Stripe (SFW content)
  - PaymentCloud (SFW categories)
  - Segpay (NSFW/adult content)
- **Age Verification:** Yoti
- **Chargeback Prevention:** Verifi, Riskified

### Development Tools
- **Package Manager:** npm
- **Version Control:** Git
- **Database Migrations:** Supabase CLI
- **Type Generation:** Supabase CLI (`supabase gen types`)
- **Environment:** `.env` files with `VITE_` prefix for frontend

---

## Project Structure
```
unmen/
├── frontend/                    # React + TypeScript + Vite
│   ├── src/
│   │   ├── features/           # Feature-based modules
│   │   │   ├── auth/           # Module 03: Authentication
│   │   │   │   ├── components/
│   │   │   │   ├── hooks/
│   │   │   │   ├── lib/
│   │   │   │   ├── pages/
│   │   │   │   └── store/
│   │   │   └── profile/        # Module 04: User Profiles
│   │   │       ├── components/
│   │   │       ├── hooks/
│   │   │       ├── lib/
│   │   │       ├── pages/
│   │   │       └── store/
│   │   ├── components/         # Shared UI components
│   │   │   └── ui/
│   │   ├── types/              # TypeScript types
│   │   │   └── database.types.ts  # Generated from Supabase
│   │   └── App.tsx
│   ├── .env                    # Environment variables (VITE_ prefix)
│   └── package.json
├── functions/                   # Firebase Functions (legacy, migrating)
│   ├── src/
│   │   ├── v1/
│   │   │   ├── lib/
│   │   │   │   └── s3.ts       # S3 upload utilities
│   │   │   └── routes/
│   │   │       └── media.ts    # Photo upload endpoint
│   │   └── index.ts
│   └── package.json
├── supabase/
│   └── migrations/             # Database migrations
└── docs/                       # Project documentation
```

---

## Completed Modules

### ✅ Module 01: Core Domain Models
- PostgreSQL schema with comprehensive tables
- Enums for status, tiers, roles
- Indexes for performance
- **Status:** Complete

### ✅ Module 02: Auction Mechanics
- Pure domain logic for auctions
- Bid validation and processing
- Reserve price logic
- **Status:** Complete

### ✅ Module 03: Authentication
- Supabase Auth with email/password
- Row Level Security (RLS) policies
- Zustand auth store
- Login/signup/forgot password pages
- Protected routes
- Session persistence
- Auto-create user trigger
- **Status:** Complete
- **Routes:** `/login`, `/signup`

### ✅ Module 04: User Profiles
- Profile viewing and editing
- Photo upload component (UI complete, endpoint pending)
- Shipping address CRUD
- Seller stats display with tier progress
- Public seller profiles
- Zustand profile store
- **Status:** 95% Complete (photo upload backend pending)
- **Routes:** `/profile`, `/seller/:id`
- **Database Tables:** `users`, `shipping_addresses`
- **Key Components:**
  - ProfileHeader, ProfileEditForm
  - PhotoUploadButton (needs backend endpoint)
  - SellerStats, SellerTierBadge
  - ShippingAddressList, ShippingAddressForm
  - SellerProfileCard

---

## Database Schema Overview

### Key Tables
- `users` - User accounts with seller tiers and verification status
- `shipping_addresses` - User shipping addresses with default tracking
- `listings` - Item listings with media and metadata
- `auctions` - Active auctions with bidding data
- `bids` - Bid history and tracking
- `transactions` - Payment and settlement records
- `verification_submissions` - User verification requests

### Key Enums
- `tier_level`: TIER_1, TIER_2, TIER_3
- `user_role`: user, moderator, admin, super_admin, support, finance
- `verification_status`: NONE, PENDING, APPROVED, REJECTED
- `brand_type`: AUCTIONX, UNMENTIONABLES
- `auction_status`: draft, scheduled, active, ended, cancelled, settled

### RLS Policies
- Users can view/update own profile
- Public can view all user profiles (for seller pages)
- Users can CRUD own shipping addresses
- Admins have elevated permissions

---

## Environment Variables

### Frontend (.env)
```bash
VITE_SUPABASE_URL=https://pmlofthmobglcfkqjtru.supabase.co
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_QOUABgX8WDKnr_OOaTKPTA__H_3ZPx7
VITE_API_URL=http://localhost:5001/auctionx-dev/us-central1  # Local dev
```

### Functions (.env.local)
```bash
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
AWS_S3_BUCKET=auctionx-media-prod-cl
AWS_REGION=us-east-2
AWS_CLOUDFRONT_DOMAIN=<optional>
```

---

## Development Workflows

### Terminal Verification Pattern
**When you need to verify paths, existing code, schemas, or project structure:**
1. Provide terminal commands for Boss to run
2. Be direct about what you need to see
3. Don't ask clarifying questions - give commands

**Example:**
```bash
# Instead of: "Where is your S3 upload code?"
# Provide:
cd /Users/chris/Desktop/unmentionables/unmen/functions && find src -type f -name "*s3*"
cat /path/to/s3.ts
```

### Database Schema Management

**Generating TypeScript Types:**
```bash
cd /Users/chris/Desktop/unmentionables/unmen
supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
```

**Always regenerate types after schema changes to ensure TypeScript accuracy**

### Migration Workflow
1. Create migration file in `supabase/migrations/`
2. Name format: `YYYYMMDDHHMMSS_description.sql`
3. Make migrations idempotent (DROP IF EXISTS, CREATE IF NOT EXISTS)
4. Apply: `supabase db push`
5. Verify: Check Supabase dashboard SQL Editor

### Frontend Development
```bash
cd frontend
npm run dev          # Start dev server
npm run build        # Production build
npm run preview      # Preview production build
```

### Functions Development
```bash
cd functions
npm run build        # Compile TypeScript
npm run serve        # Local emulator (if using Firebase)
```

---

## Module Development Guidelines

### File Organization
- **Feature-based structure:** Each module in `frontend/src/features/`
- **Component hierarchy:** pages → components → hooks → lib → store
- **Shared components:** In `frontend/src/components/ui/`
- **Type definitions:** Generated in `frontend/src/types/database.types.ts`

### Code Standards
- **TypeScript:** Strict mode enabled, no `any` types
- **Error handling:** Try/catch with detailed logging, user-friendly messages
- **Validation:** Client-side and database constraints
- **Accessibility:** WCAG 2.1 AA compliance
- **State management:** Zustand for complex state, React hooks for local state

### Database Constraints
- **Schema Lock:** Never modify locked modules (01, 02)
- **RLS Always:** Every table must have Row Level Security enabled
- **Migrations:** Always idempotent, always tested
- **Enums:** Use database enums for status fields, match TypeScript types exactly

### Component Patterns
- **Hooks first:** Custom hooks for data fetching and mutations
- **Error boundaries:** Graceful error handling in UI
- **Loading states:** Show spinners/skeletons during async operations
- **Optimistic updates:** Update UI before server confirmation where appropriate

---

## Authentication Flow

1. User signs up with email/password
2. Supabase sends confirmation email
3. User confirms email
4. Trigger creates user record in `public.users`
5. User logs in
6. Session stored in localStorage via Supabase SDK
7. Protected routes check `useAuth()` hook
8. RLS policies enforce data access

---

## Payment Architecture

### Three-Processor System
1. **Stripe:** Primary processor for SFW content
2. **PaymentCloud:** Backup for SFW categories
3. **Segpay:** Exclusive for NSFW/adult content

### Deferred Payment Window
- 20-minute window for payment after auction win
- Cascade system: Try Stripe → PaymentCloud → Segpay
- Automatic Pro tier promotion at $10K annual sales

### Fee Structure
- **TIER_1 (Bronze):** 15% platform fee
- **TIER_2 (Silver):** 10% platform fee  
- **TIER_3 (Gold):** 5% platform fee

**Tier Thresholds:**
- TIER_1: $0 - $9,999 trailing 12mo sales
- TIER_2: $10K - $99,999 trailing 12mo sales
- TIER_3: $100K+ trailing 12mo sales

---

## Verification System

### Multi-Layer Verification
1. **Government ID:** Front and back photo upload
2. **Video Challenge:** Random prompt verification
3. **Social Proof:** Link to social media accounts
4. **Age Verification:** Yoti integration (18+)

### Verification Status Flow
- NONE → User not verified
- PENDING → Submitted, awaiting review
- APPROVED → Verified seller
- REJECTED → Verification failed (with reason)

---

## S3 Media Storage

### Bucket Structure
```
auctionx-media-prod-cl/
├── profiles/{userId}/{timestamp}_{filename}
├── listings/{listingId}/{timestamp}_{filename}
└── verification/{userId}/{timestamp}_{type}.{ext}
```

### Upload Flow (Current - Firebase Functions)
1. Frontend requests pre-signed URL from `/v1/media/upload-url`
2. Backend generates S3 pre-signed URL (5min expiry)
3. Frontend uploads directly to S3
4. Frontend updates database with public URL

### File Constraints
- **Images:** JPEG, PNG, WebP, GIF (max 5MB)
- **Videos:** MP4 (max 50MB)
- **Profile photos:** Max 5MB

---

## Boss Communication Preferences

### Code Delivery
- Token-optimized responses (code first, minimal explanations)
- Command drop-ins without inline comments
- Direct terminal commands for verification
- No embedded comments in commands (except Claude Code context)

### Interaction Style
- **Sarcasm:** 6/10
- **Humor:** 7/10
- **Sass:** 7/10
- **Intelligence:** 10/10
- **Approach:** Challenge ideas, don't just agree
- **Questions:** Ask clarifying questions upfront, front-load verification

### Project Philosophy
- "Build solutions, not limits" when facing constraints
- Comprehensive foundations over shortcuts
- Rapid development without sacrificing quality
- Marketplace-native solutions preferred
- Canadian location provides regulatory advantages

---

## Development Checklist (Current State)

### Completed ✅
- [x] PostgreSQL schema with RLS
- [x] Supabase Auth integration
- [x] Frontend skeleton (React + TypeScript + Vite + Tailwind)
- [x] Authentication module (login, signup, protected routes)
- [x] User profile management (view, edit, shipping addresses)
- [x] Seller stats and tier display
- [x] Public seller profile pages
- [x] Session persistence
- [x] Database type generation workflow
- [x] Supabase CLI integration

### In Progress 🚧
- [ ] Photo upload backend endpoint (S3 integration)
- [ ] Migration away from Firebase Functions

### Pending ⏳
- [ ] Listing creation module
- [ ] Auction mechanics module
- [ ] Payment processing integration
- [ ] Verification submission flow
- [ ] Admin dashboard
- [ ] Seller analytics
- [ ] Buyer transaction history

---

## Known Issues & Technical Debt

### Photo Upload
- **Issue:** Backend endpoint `/v1/media/upload-url` needs implementation
- **Impact:** Users cannot upload profile photos
- **Solution:** Build Express endpoint or migrate to new backend
- **Priority:** Medium (UI complete, functionality pending)

### Firebase Migration
- **Issue:** Currently using Firebase Functions for backend
- **Plan:** Migrate to standalone Express/Node.js server
- **Reason:** Moving away from Firebase ecosystem
- **Priority:** High (blocking photo upload and future endpoints)

### Type Safety
- **Best Practice:** Always regenerate types after schema changes
- **Command:** `supabase gen types typescript --project-id pmlofthmobglcfkqjtru`
- **Lesson:** Manual type definitions cause drift and TypeScript errors

---

## Common Pitfalls & Solutions

### RLS Policy Recursion
**Problem:** Policies that check `auth.uid()` in subqueries cause infinite recursion  
**Solution:** Use simple `USING (true)` for public read access, restrict with UPDATE policies

### Schema Enum Case Mismatch
**Problem:** Database uses uppercase enums (TIER_1), code uses lowercase (tier_1)  
**Solution:** Always generate types from database, never manually define

### Missing User Records
**Problem:** Auth triggers may not fire for existing users  
**Solution:** Manually insert missing records, ensure triggers work for new signups

### Supabase Single/MaybeSingle
**Problem:** `.single()` fails if query returns 0 or 2+ rows  
**Solution:** Use `.maybeSingle()` when row may not exist

---

## Next Session Priorities

1. **Photo Upload Endpoint**
   - Build Express endpoint for S3 pre-signed URLs
   - Test photo upload flow end-to-end
   - Deploy to production

2. **Firebase Migration Planning**
   - Define new backend architecture
   - Plan migration strategy
   - Identify all Firebase dependencies

3. **Module 05: Listing Creation**
   - Photo upload for listing media
   - Category selection
   - Item condition tracking
   - Draft/publish workflow

---

## Git Workflow

### Commit Message Format
```
feat(module-XX): description

- Detail 1
- Detail 2

Tested:
- Test 1
- Test 2

Closes: Module XX
Next: Module YY
```

### Current Branch
- **Main:** `dev`
- **Feature branches:** Per module when needed

---

## Quick Reference Commands

### Frontend
```bash
cd /Users/chris/Desktop/unmentionables/unmen/frontend
npm run dev                    # Start dev server
npm run build                  # Production build
npm run preview                # Preview build
```

### Functions
```bash
cd /Users/chris/Desktop/unmentionables/unmen/functions
npm run build                  # Compile TypeScript
```

### Supabase
```bash
cd /Users/chris/Desktop/unmentionables/unmen
supabase login                 # Authenticate CLI
supabase link --project-ref pmlofthmobglcfkqjtru
supabase db push              # Apply migrations
supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
```

### Database
```sql
-- Check user exists
SELECT * FROM auth.users WHERE id = '<uuid>';
SELECT * FROM public.users WHERE id = '<uuid>';

-- Manually create user
INSERT INTO public.users (id, email, role, seller_tier)
VALUES ('<uuid>', '<email>', 'user', 'TIER_1');
```

---

## Resources

- **Supabase Docs:** https://supabase.com/docs
- **React Router:** https://reactrouter.com
- **Tailwind CSS:** https://tailwindcss.com
- **Zustand:** https://zustand-demo.pmnd.rs
- **AWS S3 SDK:** https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3

---

**END OF MASTER PROJECT PROMPT v1.1**
