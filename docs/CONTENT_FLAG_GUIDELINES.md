# Content Flag Guidelines — Payment Routing

## How Content Flags Work

Every listing has one or more `content_flags` that determine which payment processors are eligible to handle the transaction. This is the core mechanism that keeps AuctionX compliant with processor terms of service.

## Flag → Risk Score Mapping

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
- Stripe: "AUCTIONX" (clean, no adult references)
- PaymentCloud: "AX MARKETPLACE" (generic)
- Signature: "AUTHENTIC MATERIALS" (brand-safe)
- CCBill: Uses their own descriptor system
- NOWPayments: N/A (crypto has no descriptors)

## Multiple Flags
When a listing has multiple flags, use the HIGHEST risk score to determine the cascade. For example, a listing flagged as both `CREATOR_MERCH` (MEDIUM) and `LINGERIE` (MEDIUM) stays MEDIUM. But `CREATOR_MERCH` (MEDIUM) + `EXPLICIT` (HIGH) = HIGH risk.

## Category Auto-Flagging
Categories in the database have a `default_content_flag` that auto-applies when a seller picks that category. Sellers can add additional flags but cannot remove the category default.
