# Content Flag Guidelines — Payment Routing

## How Content Flags Work

Every listing has one or more `content_flags` that determine which payment processors are eligible to handle the transaction. This is the core mechanism that keeps **Authentic Materials** (and the age-gated **Unmentionables** stream) compliant with processor terms of service.

Flags map to two brand-aligned buckets (presentation layer) and to an underlying `content_risk_level` enum (persistence + cascade layer). The buckets are how the product reasons about content; the enum is how the backend selects processors.

## Brand Buckets

### SFW — Authentic Materials (Stripe-first target state)

> **Status: Provisional.** "Uniformly Stripe-first" is the target for the SFW bucket but depends on the not-yet-built **Context-Aware Listing Pre-Screen** (see Ideas DB). Until that ships, listings flagged with the rows below continue to route via the existing LOW/MEDIUM cascade lines listed in the "Underlying enum" section.

| Flag | Description | Brand |
|------|-------------|-------|
| CONCERT_GEAR | Concert merchandise, band tees | AuctionX |
| MEMORABILIA | Sports memorabilia, signed items | AuctionX |
| AUTOGRAPHED | Authenticated autographs | AuctionX |
| SPORTS_EQUIPMENT | Used sports equipment | AuctionX |
| FAN_MERCHANDISE | General fan merchandise | AuctionX |
| CREATOR_MERCH | Creator/influencer merchandise | Either |
| COSPLAY | Cosplay items and costumes | Either |
| GAMING | Gaming merchandise | Either |
| SWIMWEAR | Swimwear, bikinis | Either |

> **Note on the `Brand` column:** `AuctionX` here is the locked legacy DB enum value (`brand_type = 'AUCTIONX'`) for the Authentic Materials stream — schema-locked, not user-facing. `Either` means the flag is acceptable in either the SFW or NSFW listing flow; today it routes through MEDIUM cascade. See CLAUDE.md → Locked brand identifiers.

### NSFW — Unmentionables (adult-eligible processors only)

| Flag | Description | Brand |
|------|-------------|-------|
| LINGERIE | Lingerie items | Unmentionables |
| PERSONAL_ITEM | Personal/worn items (non-explicit) | Unmentionables |
| ADULT_CONTENT | Adult-themed content | Unmentionables |
| EXPLICIT | Explicit content | Unmentionables |
| FETISH | Fetish items | Unmentionables |
| NSFW | General NSFW items | Unmentionables |
| 18_PLUS | Age-gated content | Unmentionables |
| INTIMATE_ITEMS | Intimate personal items | Unmentionables |

NSFW listings are routed through adult-eligible processors only. Stripe and PaymentCloud are never used for this bucket regardless of risk score.

## Underlying `content_risk_level` enum (persisted, unchanged)

The two-bucket presentation above sits on top of the DB-persisted `content_risk_level` enum and its cascade rules. The backend consumes the enum directly; the bucket grouping is product-surface taxonomy only. Removing or renaming an enum value is out of scope (schema-locked).

### LOW Risk (Score 0-2) — Full Cascade Available
| Flag | Description | Brand |
|------|-------------|-------|
| CONCERT_GEAR | Concert merchandise, band tees | AuctionX |
| MEMORABILIA | Sports memorabilia, signed items | AuctionX |
| AUTOGRAPHED | Authenticated autographs | AuctionX |
| SPORTS_EQUIPMENT | Used sports equipment | AuctionX |
| FAN_MERCHANDISE | General fan merchandise | AuctionX |

**Cascade:** Stripe → PaymentCloud → Signature → CCBill

### MEDIUM Risk (Score 3-5) — Skip Stripe
| Flag | Description | Brand |
|------|-------------|-------|
| CREATOR_MERCH | Creator/influencer merchandise | Either |
| COSPLAY | Cosplay items and costumes | Either |
| GAMING | Gaming merchandise | Either |
| SWIMWEAR | Swimwear, bikinis | Either |
| LINGERIE | Lingerie items | Unmentionables |
| PERSONAL_ITEM | Personal/worn items (non-explicit) | Unmentionables |

**Cascade:** PaymentCloud → Signature → CCBill

### HIGH Risk (Score 6+) — Adult Processors Only
| Flag | Description | Brand |
|------|-------------|-------|
| ADULT_CONTENT | Adult-themed content | Unmentionables |
| EXPLICIT | Explicit content | Unmentionables |
| FETISH | Fetish items | Unmentionables |
| NSFW | General NSFW items | Unmentionables |
| 18_PLUS | Age-gated content | Unmentionables |
| INTIMATE_ITEMS | Intimate personal items | Unmentionables |

**Cascade:** Signature → CCBill

## Crypto Handling (NOWPayments)
- **NEVER** part of the automatic cascade
- User must explicitly select "Pay with Crypto" at checkout
- Available for ALL risk levels
- 72-hour payment window (vs 20 min for card)
- Supports: BTC, ETH, USDT, USDC, SOL

## Billing Descriptor Rules
- Stripe: `"AUCTIONX"` (clean, no adult references — descriptor string preserved to keep the locked enum value visible on statements; Authentic Materials is the public brand name)
- PaymentCloud: `"AX MARKETPLACE"` (generic)
- Signature: `"AUTHENTIC MATERIALS"` (brand-safe)
- CCBill: Uses their own descriptor system
- NOWPayments: N/A (crypto has no descriptors)

## Multiple Flags
When a listing has multiple flags, use the HIGHEST risk score to determine the cascade. For example, a listing flagged as both `CREATOR_MERCH` (MEDIUM) and `LINGERIE` (MEDIUM) stays MEDIUM. But `CREATOR_MERCH` (MEDIUM) + `EXPLICIT` (HIGH) = HIGH risk.

Bucket assignment follows the same precedence: any NSFW-bucket flag forces NSFW routing regardless of other SFW flags on the listing.

## Category Auto-Flagging
Categories in the database have a `default_content_flag` that auto-applies when a seller picks that category. Sellers can add additional flags but cannot remove the category default.
