# Authentic Materials — Master Project Context

**Use this prompt when starting the MAIN project management chat.**

---

## Project Overview

You are helping build **Authentic Materials**, the public-facing brand of The Craving Company Inc.'s dual-brand auction marketplace platform for parasocial commerce:
- **Authentic Materials:** Public-facing SFW collectibles — memorabilia, autographs, creator merch, fan collectibles. Domain: authentic-materials.com.
- **Unmentionables:** Age-gated NSFW property — personal items, intimate content. Owned but not yet built; never publicly marketed.

> Internal note: "AuctionX" is the retired prior name for the SFW marketplace; it persists only as the schema-locked DB enum value (`brand_type = 'AUCTIONX'`) and AWS resource prefixes — not user-facing.

**Tech Stack:**
- Backend: Firebase Functions (Node.js 20, TypeScript)
- Frontend: React 18, Tailwind, Zustand, React Router
- Database: Firestore
- Storage: AWS S3 (auctionx-media-prod-cl, us-east-2)
- Payment: Stripe (SFW), Segpay (NSFW)

**Firebase Project:** unmentionables-4ef02

---

## Repository Structure
```
auctionX-dev/
├── frontend/           # React app
├── functions/          # Firebase Functions backend
├── docs/              # All project documentation
│   ├── MASTER_SPECIFICATION.md
│   ├── SCHEMA_LOCK.md
│   ├── MODULE_WORKFLOW.md
│   └── DEVELOPMENT_CHECKLIST.md
├── firebase.json
└── .gitignore
```

---

## Critical Constraints

### LOCKED COMPONENTS (DO NOT MODIFY)

**Module 01 - Core Domain Models (LOCKED):**
- Location: `functions/src/v1/schemas/domain/`
- Files: All schema files
- Reference: `functions/docs/MODULE_01_REFERENCE.md`
- **Changes require schema migration**

**Module 02 - Auction Mechanics (LOCKED):**
- Location: `functions/src/v1/services/auctions/`
- Pure functions, deterministic
- Reference: `functions/docs/MODULE_02_REFERENCE.md`
- **Do not modify auction state logic**

### FROZEN SCHEMAS

See `docs/SCHEMA_LOCK.md` for complete list.

**Key schemas that MUST NOT break:**
- User
- Listing
- Auction
- AuctionState
- Bid
- Settlement
- Category

**Safe to extend:**
- Add optional fields only
- Never remove or rename existing fields
- Never change field types
- Use migration scripts for data changes

---

## Environment Configuration

**Backend (.env.local in functions/):**
```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-2
AWS_S3_BUCKET=auctionx-media-prod-cl
FIREBASE_PROJECT_ID=unmentionables-4ef02
```

**Frontend (.env.local in frontend/):**
```bash
VITE_API_URL=http://localhost:5001/unmentionables-4ef02/us-east-2/api/v1
VITE_BRAND=AUCTIONX
```

---

## Development Workflow

### Starting a New Module

1. **Check Development Checklist** (`docs/DEVELOPMENT_CHECKLIST.md`)
2. **Review Schema Lock** to understand constraints
3. **Create module-specific chat** using module prompt
4. **Reference Master Spec** for business rules
5. **Test against existing modules** before committing

### Module Completion Checklist

- [ ] All tests passing
- [ ] No breaking changes to locked schemas
- [ ] Documentation updated
- [ ] Module reference doc created
- [ ] Development checklist updated
- [ ] Code committed with descriptive message

---

## Key Business Rules

**Seller Tiers:**
- TIER_1: 0-$10K lifetime → 20% fee
- TIER_2: $10K-$100K/12mo → 17.5% fee  
- TIER_3: $100K+/12mo → 15% fee

**Auction Mechanics:**
- Proxy bidding (eBay-style)
- Max 2 relists per listing
- 20-minute payment window
- Cascade to top 3 bidders above reserve

**Media Limits:**
- Images: 5MB max (JPEG, PNG, WebP, GIF)
- Videos: 50MB max (MP4)
- Max 10 media items per listing

**Payment Routing:**
- Authentic Materials (SFW) → Stripe-first cascade (see CONTENT_FLAG_GUIDELINES.md)
- Unmentionables (NSFW) → Signature → CCBill (adult-eligible only)

---

## Testing Commands

**Backend:**
```bash
cd functions
npm run build        # TypeScript compilation
npm test            # Run all tests
npm run serve       # Local emulator
```

**Frontend:**
```bash
cd frontend
npm run dev         # Dev server (localhost:3000)
npm run build       # Production build
npm run lint        # ESLint
```

---

## Reference Documents

- **Master Spec:** `docs/MASTER_SPECIFICATION.md`
- **Schema Lock:** `docs/SCHEMA_LOCK.md`
- **Module Workflow:** `docs/MODULE_WORKFLOW.md`
- **Development Checklist:** `docs/DEVELOPMENT_CHECKLIST.md`
- **WCAG Reference:** `/mnt/project/wcag_accessibility_reference.md`

---

## Communication Style

Boss prefers:
- Token-optimized responses
- Code-first approach
- Minimal explanations (ask if needed)
- Command drop-ins without comments
- Comprehensive solutions over shortcuts

---

## Current Status

**Completed:**
- ✅ Backend foundation (Module 01, 02)
- ✅ Schema refactoring (9 improvements)
- ✅ S3 integration
- ✅ Frontend skeleton

**In Progress:**
- [ ] Authentication module
- [ ] User profiles
- [ ] Listing creation
- [ ] Auction bidding

**See `DEVELOPMENT_CHECKLIST.md` for complete status.**

---

## Emergency Contacts

**If something breaks:**
1. Check Schema Lock for compatibility
2. Review module reference docs
3. Run tests: `npm test`
4. Check git history: `git log --oneline`
5. Restore from backup branch if needed

---

**END OF MASTER PROJECT PROMPT**
