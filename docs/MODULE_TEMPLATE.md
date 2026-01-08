# MODULE 01 — Core Domain Models & Persistence (Firestore)

## Status
- **In Progress / Modeling Complete**
- Module 0 + 0.5 assumed locked and stable (no refactors).

## Goal
Define core domain models and Firestore persistence for:
- listings
- auctions
- bids
- users (base shape)
- categories (including 18+)

## Scope
### In
- Zod schemas (single source of truth)
- Firestore collection layout
- Status/state enums
- Read/write patterns (no business logic)

### Out
- Auction mechanics
- Bidding logic
- Payments
- Auth enforcement
- UI concerns

## Repo Placement (Locked)
- Zod domain schemas: `functions/src/v1/schemas/domain/*`
- Firestore repos: `functions/src/v1/repos/*`

## Firestore Collection Structure
### Users
- `users/{uid}`

### Categories
- `categories/{categoryId}`

### Listings
- `listings/{listingId}`

### Auctions (subcollection under listing)
- `listings/{listingId}/auctions/{auctionId}`

### Bids (subcollection under auction)
- `listings/{listingId}/auctions/{auctionId}/bids/{bidId}`

## Domain Models (Zod)
### Enums
- `ListingStatus`: `DRAFT | ACTIVE | SUSPENDED | ARCHIVED`
- `AuctionStatus`: `SCHEDULED | RUNNING | CLOSED | VOIDED`
- `BidStatus`: `PLACED | OUTBID | WINNING | RETRACTED`
- `ItemCondition`: `NEW | LIKE_NEW | GOOD | FAIR | POOR`
- Currency: `CAD`

### Users (base)
- Persisted profile fields + roles (admin/moderator) only.

### Categories
- Hierarchy supported via `parentId` + `path[]`
- **18+** is encoded via `isAdult: boolean`

### Listings
- Enduring listing document across relists.
- Holds seller, category, condition, photos, location, pricing, flags, status.

### Auctions
- Stored under listing.
- Contains `iteration` (0..2), schedule timestamps, status, and a small denormalized snapshot.

### Bids
- Stored under auction.
- Contains bidder uid, amount, status, placedAt, optional idempotency key.

## Read/Write Patterns (Persistence Only)
- Repos validate **reads and writes** using Zod.
- Update pattern: read -> merge -> validate -> overwrite (merge: false).
- No business logic (winner selection, bidding rules, payments) is implemented here.

## Indexing Notes (Planning Only)
- Common queries expected:
  - listings by `status`, `categoryId`, `flags.adult`
  - auctions under listing ordered by `schedule.startAt`
  - bids under auction ordered by `placedAt`
- Composite indexes will be added when query patterns are implemented in later modules.

## Lessons Learned
- **Folder hygiene matters:** `schemas/domain/` prevents `schemas/` from becoming a dumping ground as modules grow.
- **Zod-first discipline:** validate at persistence boundaries (read + write) to keep models consistent across services.
- **Build artifact hygiene (observed):** compiled output includes duplicate-named artifacts (e.g., `index 2.js`). Not changed in this module due to locked decisions, but worth addressing later with a clean build output strategy.
