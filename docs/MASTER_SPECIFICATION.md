# AuctionX Platform - Master Specification
**Version:** 1.0.0  
**Date:** January 21, 2026  
**Status:** FROZEN

---

## Quick Reference

**Firebase Project:** unmentionables-4ef02  
**S3 Bucket:** auctionx-media-prod-cl  
**Region:** us-east-2  
**Payment:** Stripe (SFW), Segpay (NSFW)  

---

## Database Schema Summary

### Collections
- users/{uid}
- categories/{categoryId}
- listings/{listingId}
  - auctions/{auctionId}
    - state/current
    - bids/{bidId}
- settlements/{settlementId}
- payouts/{payoutId}
- disputes/{disputeId}
- adminActions/{actionId}

---

## Key Business Rules

**Seller Tiers:**
- TIER_1: 0-$10K → 20% fee
- TIER_2: $10K-$100K/12mo → 17.5% fee
- TIER_3: $100K+/12mo → 15% fee

**Auction Mechanics:**
- Proxy bidding (eBay-style)
- Max 2 relists
- 20-min payment window
- Cascade to top 3 bidders

**Media Limits:**
- Images: 5MB max
- Videos: 50MB max
- Max 10 per listing

---

## API Endpoints

**Base:** `/v1`

**Public:**
- GET /health
- GET /listings

**Authenticated:**
- POST /listings
- POST /auctions/:id/bids
- GET /users/me

**Admin:**
- GET /admin/users
- POST /admin/verify-seller

---

## Type Definitions

See: `functions/src/v1/schemas/domain/`

**Key Enums:**
- Currency: "CAD" | "USD"
- Brand: "AUCTIONX" | "UNMENTIONABLES"
- PaymentProcessor: "STRIPE" | "SEGPAY"
- SellerTier: "TIER_1" | "TIER_2" | "TIER_3"

---

**For complete specification, see individual schema files and MODULE_* docs.**
