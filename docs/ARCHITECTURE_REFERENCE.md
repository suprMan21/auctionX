# AuctionX Architecture Reference

**Purpose:** Deep technical reference. Claude Code should read this when working on specific subsystems.

---

## Database Schema (Supabase PostgreSQL)

### Core Tables
| Table | Purpose | RLS |
|-------|---------|-----|
| users | User accounts, seller tiers, verification | Yes |
| shipping_addresses | User shipping addresses with default tracking | Yes |
| categories | Hierarchical categories with NSFW flags | Yes |
| listings | Item listings with media references | Yes |
| listing_media | S3 URLs for listing images/videos | Yes |
| auctions | Active auctions with proxy bidding state | Yes |
| bids | Bid history with auto-bid indicators | Yes |

### Payment Tables (Module 09)
| Table | Purpose | RLS |
|-------|---------|-----|
| payment_transactions | Transaction records with cascade tracking | Yes |
| payment_attempts | Individual processor attempt logs | Yes |
| processor_health | Real-time processor status monitoring | Yes (public read) |
| processor_config | Admin-configurable cascade settings | Yes (admin only) |

### Admin Tables (Module 10)
| Table | Purpose | RLS |
|-------|---------|-----|
| admin_roles | Role definitions with permission arrays | Yes |
| admin_users | Admin user assignments with brand scoping | Yes |
| moderation_queue | Content review queue | Yes |
| audit_logs | Admin action audit trail | Yes |

### Messaging Tables (Module 15)
| Table | Purpose | RLS |
|-------|---------|-----|
| conversations | Conversation thread between buyer and seller on a listing; UNIQUE(listing_id, participant_1_id, participant_2_id) | Yes — participants only |
| messages | Individual messages within a conversation; body TEXT NOT NULL, read_at for receipts, flagged for moderation | Yes — participants only |

**Trigger:** `update_conversation_on_message()` — SECURITY DEFINER, updates `conversations.last_message_at` and `last_message_preview` on every message INSERT.
**Realtime:** Both tables added to `supabase_realtime` publication for live updates.

### Key Enums (PostgreSQL)
```sql
auction_status: DRAFT, SCHEDULED, ACTIVE, ENDED, CANCELLED, SETTLED
brand_type: AUCTIONX, UNMENTIONABLES
listing_status: DRAFT, ACTIVE, SUSPENDED, ARCHIVED, SOLD, CANCELLED
tier_level: TIER_1, TIER_2, TIER_3
user_role: user, moderator, admin, super_admin, support, finance
payment_processor: STRIPE, PAYMENTCLOUD, SIGNATURE, CCBILL, NOWPAYMENTS
payment_status: PENDING, PROCESSING, AWAITING_CRYPTO, COMPLETED, FAILED, EXPIRED, REFUNDED, DISPUTED
content_risk_level: LOW, MEDIUM, HIGH
currency_code: CAD, USD
```

### Database Triggers
- `handle_proxy_bid()` — SECURITY DEFINER, auto-bids for proxy bidding
- `prevent_self_bid()` — Blocks sellers from bidding on own auctions
- `update_updated_at_column()` — Auto-timestamps on UPDATE
- `auto_create_user()` — Creates public.users row on Supabase Auth signup

### Key Indexes
- `idx_auctions_status_end_time` — Active auction queries
- `idx_bids_auction_id` — Bid history lookups
- `idx_listings_seller_id` — Seller listing queries
- `idx_payment_transactions_auction` — Payment by auction
- `idx_payment_transactions_status` — Payment status queries

---

## Payment Cascade Architecture

### Content Flag → Risk Level Mapping
```
LOW (Score 0-2):  CONCERT_GEAR, MEMORABILIA, AUTOGRAPHED, SPORTS_EQUIPMENT, FAN_MERCHANDISE
MEDIUM (Score 3-5): CREATOR_MERCH, COSPLAY, GAMING, SWIMWEAR, LINGERIE, PERSONAL_ITEM
HIGH (Score 6+):  ADULT_CONTENT, EXPLICIT, FETISH, NSFW, 18_PLUS, INTIMATE_ITEMS
```

### Cascade Order by Risk
| Risk | Order | Max Retries/Processor | Cascade Delay |
|------|-------|----------------------|---------------|
| LOW | Stripe → PaymentCloud → Signature → CCBill | 2 | 5s |
| MEDIUM | PaymentCloud → Signature → CCBill | 2 | 5s |
| HIGH | Signature → CCBill | 2 | 5s |

### Processor Fee Comparison
| Processor | Rate | Per-Txn | Best For |
|-----------|------|---------|----------|
| Stripe | 2.9% | $0.30 | Low risk mainstream |
| PaymentCloud | 3.5% | $0.30 | Medium risk creator |
| Signature | 4-6% | $0.30 | High risk content |
| CCBill | 8-10% | $0.00 | Universal fallback (adult) |
| NOWPayments | ~1% | Network | Crypto (user opt-in only) |

### Non-Payment Penalties
| Offense | Window | Penalty |
|---------|--------|---------|
| 1st | Any time | 7-day bidding suspension |
| 2nd | 90 days of 1st | 30-day suspension |
| 3rd | 180 days of 2nd | Permanent ban |

### Escrow Rules
- Platform holds funds 72 hours after payment
- Buyer dispute window during hold
- Auto-release to seller after 3 days (no dispute)
- Manual early release for Tier 2+ verified sellers

---

## Admin Security Architecture (Module 10)

### Zero Trust Principles
- Enhanced auth middleware with explicit token expiry (distinguishable error codes)
- Session versioning: `session_version` column on admin_users enables revocation
- Tiered rate limiting: 10/min destructive ops, 30/min writes, 120/min reads
- Dual audit logging: DB functions AND middleware (redundancy)
- Service role key ONLY for admin lookups (bypasses RLS chicken-egg problem)

### Admin Endpoints (Backend :3001)
```
GET    /api/v1/admin/users          — List/search users
GET    /api/v1/admin/users/:id      — Get user details
POST   /api/v1/admin/users/:id/suspend — Suspend user
POST   /api/v1/admin/users/:id/ban    — Ban user
POST   /api/v1/admin/users/:id/unban  — Unban user
GET    /api/v1/admin/moderation      — Moderation queue
GET    /api/v1/admin/audit-logs      — Audit log viewer
GET    /api/v1/admin/health          — System health check
POST   /api/v1/admin/disputes/:settlementId/approve — Approve dispute (DISPUTED→REFUNDED)
POST   /api/v1/admin/disputes/:settlementId/reject  — Reject dispute (DISPUTED→ESCROW_HOLD)
```

---

## Frontend Architecture

### Route Structure
```
/                    — Home/Landing
/login               — Login page
/signup              — Signup page
/profile             — User profile (protected)
/seller/:id          — Public seller profile
/listings/create     — Create listing wizard (protected)
/listings/:id/edit   — Edit listing (protected, owner only)
/browse              — Browse/search listings
/auctions/:id        — Auction detail page (auth required to bid)
/admin/*             — Admin dashboard (admin role required)
/verify/:tokenName   — NFC verification page (public, Module 13)
```

### State Management (Zustand)
- `useAuthStore` — Auth state, session, user info
- `useProfileStore` — Profile data, shipping addresses
- `useListingStore` — Listing creation/edit state
- Feature-specific hooks: `useAuction`, `useBidHistory`, `usePlaceBid`, `useCountdown`

### API Client Pattern
```typescript
// Frontend calls Express backend via fetch
const response = await fetch(`${API_URL}/auctions/${id}/bids`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ amount_cents, max_bid_cents })
});

// Frontend calls Supabase Edge Functions
const { data, error } = await supabase.functions.invoke('process-payment', {
  body: { auctionId, paymentMethod }
});

// Frontend uses Supabase client directly (auth, realtime)
const { data } = await supabase.from('listings').select('*').eq('status', 'ACTIVE');
```

---

## S3 Media Storage

### Bucket: auctionx-media-prod-cl (us-east-1)
- Profile photos: `{user_id}/profile/{uuid}.{ext}`
- Listing media: `{user_id}/listings/{listing_id}/{uuid}.{ext}`
- Verification videos: `verifications/{verification_id}/creation.webm`
- Presigned URLs: 5-minute expiry, authenticated users only
- Limits: Images 5MB (JPEG, PNG, WebP, GIF), Videos 50MB (MP4), Max 10 per listing

---

## Environment Variables

### Frontend (.env)
```
VITE_SUPABASE_URL=https://pmlofthmobglcfkqjtru.supabase.co
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=<anon_key>
VITE_API_URL=http://localhost:3001/api/v1
VITE_S3_BUCKET=auctionx-media-prod-cl
VITE_S3_REGION=us-east-1
```

### Backend (.env)
```
PORT=3001
NODE_ENV=development
SUPABASE_URL=https://pmlofthmobglcfkqjtru.supabase.co
SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_KEY=<service_role_key>
FRONTEND_URL=http://localhost:5173
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Edge Functions (supabase/.env.local)
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Pending: PAYMENTCLOUD_*, SIGNATURE_*, CCBILL_*, NOWPAYMENTS_*
```

---

## Performance Targets
- First Contentful Paint: <1.5s
- Time to Interactive: <3s
- Lighthouse Score: >90
- API Response Time: <200ms (p95)
- Bid Placement: <100ms (p95)
- Database Queries: <50ms (p95)

## Accessibility Requirements (WCAG 2.2 AA)
- Color contrast: 4.5:1 minimum
- Focus indicators: Visible on all interactive elements
- Keyboard navigation: Tab, Enter, Escape
- Screen reader: VoiceOver/NVDA tested
- Alt text: All images
- Form labels: Associated with inputs
- Error messages: Announced to assistive tech
- Skip links: On all pages
