# Schema Lock - AuctionX

**Version:** 1.0.0  
**Date:** January 21, 2026  
**Status:** FROZEN

These schemas are LOCKED and cannot be modified without migration.

---

## Locked Schemas

### User Schema
**Location:** `functions/src/v1/schemas/domain/user.schema.ts`

**Fields (FROZEN):**
```typescript
{
  uid: string;
  displayName?: string;
  photoURL?: string;
  email?: string;
  phoneNumber?: string;
  
  shippingAddresses: ShippingAddress[];
  verification?: VerificationStatus;
  sellerTier?: SellerTier;
  moderation?: ModerationStatus;
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Safe Changes:**
- ✅ Add new optional fields
- ✅ Add new nested optional fields in existing objects
- ❌ Remove fields
- ❌ Rename fields
- ❌ Change field types
- ❌ Make optional fields required

---

### Listing Schema
**Location:** `functions/src/v1/schemas/domain/listing.schema.ts`

**Fields (FROZEN):**
```typescript
{
  id: string;
  sellerUid: string;
  title: string;
  description?: string;
  categoryId: string;
  condition: ItemCondition;
  
  media: ListingMedia[];  // RENAMED from photos
  
  location: ListingLocation;
  pricing: ListingPricing;
  flags?: ListingFlags;
  brand: Brand;
  status: ListingStatus;
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Breaking Change Log:**
- v1.0.0: Renamed `photos` → `media` (supports images + videos)

---

### Auction Schema
**Location:** `functions/src/v1/schemas/domain/auction.schema.ts`

**Fields (FROZEN):**
```typescript
{
  id: string;
  listingId: string;
  iteration: number;
  status: AuctionStatus;
  
  schedule: {
    startAt: Timestamp;
    endAt: Timestamp;
  };
  
  close?: {
    closedAt?: Timestamp;
    reason?: string;
  };
  
  snapshot: {
    title: string;
    categoryId: string;
    sellerUid: string;
  };
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

### AuctionState Schema
**Location:** `functions/src/v1/schemas/domain/auctionState.schema.ts`

**Fields (FROZEN):**
```typescript
{
  proxy: {
    highBidderUid: string | null;
    highBidderMaxCents: number | null;
    secondHighestMaxCents: number | null;
  };
  
  pricing: {
    startPriceCents: number;
    currentPriceCents: number;
  };
  
  version: number;
  updatedAtMs: number;
}
```

**CRITICAL:** Do not modify auction state logic in Module 02.

---

### Bid Schema
**Location:** `functions/src/v1/schemas/domain/bid.schema.ts`

**Fields (FROZEN):**
```typescript
{
  id: string;
  auctionId: string;
  listingId: string;
  bidderUid: string;
  
  maxCents: number;
  amountCents: number;
  currency: Currency;
  status: BidStatus;
  
  clientRequestId?: string;
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

### Settlement Schema
**Location:** `functions/src/v1/schemas/domain/settlement.schema.ts`

**Fields (FROZEN):**
```typescript
{
  id: string;
  listingId: string;
  auctionId: string;
  status: SettlementStatus;
  version: number;
  
  createdAtMs: number;
  updatedAtMs: number;
  
  outcomeKind: SettlementOutcomeKind;
  buyerUid: string | null;
  sellerUid: string | null;
  amountCents: number | null;
  currency: string | null;
  
  close: SettlementCloseSnapshot;
  actions: SettlementAction[];
  lastRequest: SettlementLastRequest | null;
  lastFailure: SettlementLastFailure | null;
  
  // NEW in v1.0.0 (optional, backward compatible)
  processor?: PaymentProcessor;
  processorFeePercent?: number;
  processorFeeCents?: number;
  processorTransactionId?: string;
  processorCustomerId?: string;
}
```

---

### Category Schema
**Location:** `functions/src/v1/schemas/domain/category.schema.ts`

**Fields (FROZEN):**
```typescript
{
  id: string;
  name: string;
  brand: Brand;
  isActive: boolean;
  parentId?: string;
  path: string;
  sortOrder: number;
}
```

---

## Enums (FROZEN)

**Location:** `functions/src/v1/schemas/domain/enums.schema.ts`
```typescript
Currency: "CAD" | "USD"
PaymentProcessor: "STRIPE" | "SEGPAY"
Brand: "AUCTIONX" | "UNMENTIONABLES"
ListingStatus: "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED"
AuctionStatus: "SCHEDULED" | "RUNNING" | "CLOSED" | "VOIDED"
BidStatus: "PLACED" | "OUTBID" | "WINNING" | "RETRACTED"
ItemCondition: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "POOR"
SellerTier: "TIER_1" | "TIER_2" | "TIER_3"
```

**Safe Changes:**
- ✅ Add new enum values at the end
- ❌ Remove enum values
- ❌ Rename enum values
- ❌ Reorder enum values

---

## Migration Guidelines

If you MUST modify a locked schema:

1. **Create migration script** in `functions/scripts/migrations/`
2. **Version bump** the schema
3. **Update SCHEMA_LOCK.md**
4. **Document breaking changes**
5. **Test migration on dev data**
6. **Get explicit approval** before deploying

---

## Schema Extension Rules

**ALWAYS SAFE:**
- Add optional fields with `?` or `.optional()`
- Add new nested objects that are optional
- Add new enum values (append only)

**REQUIRES MIGRATION:**
- Remove any field
- Rename any field
- Change field type
- Make optional field required
- Remove enum value

**EXAMPLE - Safe Extension:**
```typescript
// BEFORE
export const UserSchema = z.object({
  uid: z.string(),
  email: z.string().optional(),
});

// AFTER - SAFE
export const UserSchema = z.object({
  uid: z.string(),
  email: z.string().optional(),
  phoneNumber: z.string().optional(),  // NEW, OPTIONAL
});
```

**EXAMPLE - Requires Migration:**
```typescript
// BEFORE
export const UserSchema = z.object({
  uid: z.string(),
  email: z.string().optional(),
});

// AFTER - BREAKING (requires migration)
export const UserSchema = z.object({
  uid: z.string(),
  emailAddress: z.string().optional(),  // RENAMED - BREAKS EXISTING DATA
});
```

---

## Backward Compatibility Checklist

Before committing schema changes:

- [ ] All existing fields preserved
- [ ] New fields are optional
- [ ] No type changes to existing fields
- [ ] Enum values only appended
- [ ] Tests pass with existing data
- [ ] No changes to locked modules (01, 02)

---

**END OF SCHEMA LOCK**
