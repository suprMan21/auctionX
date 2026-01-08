# Module 01 — Core Domain Models & Persistence (Firestore)

**Status:** COMPLETE & LOCKED

This document is the authoritative reference for Module 01 of the Unmentionables backend. It is intended for future developers, reviewers, and maintainers.

---

## 1. Purpose of Module 01

Module 01 defines the **core domain model** and **Firestore persistence layer** for the platform. It intentionally contains **no business logic**, **no auction mechanics**, and **no authorization enforcement**.

Its goal is to establish a stable, validated, type-safe foundation upon which all higher-order behavior is built.

---

## 2. Architectural Rules (Non‑Negotiable)

### 2.1 Zod Is the Single Source of Truth
- All domain shapes are defined in Zod schemas
- TypeScript types are derived from schemas
- Defaults and invariants live in schemas
- Firestore reads and writes are validated against schemas

If a field or invariant is not expressed in Zod, it is not guaranteed.

---

### 2.2 Validation at the Persistence Boundary
- All Firestore reads are validated
- All Firestore writes are validated
- Invalid data fails fast

This prevents silent corruption and keeps business logic simple and trustworthy.

---

### 2.3 Strict Module Boundaries
- Module 0: API foundation
- Module 0.5: OpenAPI / Swagger‑Lite
- Module 01: Domain + persistence only

Refactors of earlier modules are not permitted without explicit approval.

---

## 3. Repository Layout (Authoritative)

```
functions/src/v1/
├── schemas/
│   └── domain/
│       ├── common.schema.ts
│       ├── enums.schema.ts
│       ├── listing.schema.ts
│       ├── auction.schema.ts
│       ├── bid.schema.ts
│       ├── category.schema.ts
│       └── user.schema.ts
│
├── repos/
│   ├── listings.repo.ts
│   ├── auctions.repo.ts
│   ├── bids.repo.ts
│   ├── categories.repo.ts
│   ├── users.repo.ts
│   ├── paths.ts
│   └── repo.utils.ts
```

---

## 4. Domain Models

### 4.1 Listing
Represents a sellable item.

Key fields:
- `status`: DRAFT | ACTIVE | SUSPENDED | ARCHIVED (defaulted)
- `condition`: NEW | LIKE_NEW | GOOD | FAIR | POOR
- `sellerUid`: immutable owner
- `flags`: moderation metadata

Listings do not contain auction behavior.

---

### 4.2 Auction
Represents a time‑bounded sale instance.

Key fields:
- `status`: SCHEDULED | RUNNING | CLOSED | VOIDED (defaulted)
- `iteration`: relist counter
- `schedule`: startAt / endAt
- `snapshot`: immutable listing snapshot
- `close`: populated on completion

Relists create new auctions; auctions are append‑only.

---

### 4.3 Bid
Represents an offer to purchase.

Key fields:
- `status`: PLACED | OUTBID | WINNING | RETRACTED (defaulted)
- `amountCents`: integer
- `currency`: CAD (locked)
- `clientRequestId`: idempotency support

Bid mechanics are implemented in Module 02.

---

### 4.4 Category
Represents a hierarchical taxonomy.

Key fields:
- `path`: materialized ancestor path (required)
- `isAdult`: 18+ gating
- `isActive`: visibility
- `parentId`: optional

Categories are read‑heavy and relatively static.

---

### 4.5 User (Base Shape)
Represents a platform user.

Key fields:
- `uid`: Firebase Auth UID
- `roles`: coarse roles
- `isBanned`: safety enforcement

Authorization is handled in later modules.

---

## 5. Firestore Data Model

```
users/{uid}

categories/{categoryId}

listings/{listingId}
└── auctions/{auctionId}
    └── bids/{bidId}
```

Design goals:
- Predictable paths
- Scoped fan‑out
- Immutable snapshots

---

## 6. Repository Pattern

Repositories:
- Perform Firestore IO only
- Validate using Zod on read + write
- Manage timestamps
- Return domain‑typed objects

Repositories must not:
- Enforce business rules
- Perform state transitions
- Contain authorization logic

---

## 7. `parseOrThrow` Utility (Critical)

The `parseOrThrow` helper returns **Zod output types**, ensuring:
- Defaults are applied
- Transforms are applied
- TypeScript does not treat defaulted fields as optional

All persistence must pass through this utility.

---

## 8. OpenAPI Integration

- Zod schemas feed OpenAPI generation
- Request and response shapes remain aligned
- Runtime validation and documentation stay in sync

---

## 9. Lessons Learned

1. Zod output typing prevents subtle TS bugs
2. Defaults belong in schemas
3. Read‑time validation is essential
4. Module discipline avoids future refactors

---

## 10. Contract for Future Developers

- Do not bypass repositories
- Do not redefine domain types
- Do not mutate snapshots
- Do not add logic to repos
- Do not refactor locked modules casually

---

## 11. Module 02 Readiness Checklist

Before starting Module 02:
- Domain schemas finalized
- Persistence layer validated
- Typecheck passes cleanly
- Git history clean and scoped
- Documentation reviewed

Module 02 may safely introduce:
- Auction state transitions
- Bidding mechanics
- Time‑based orchestration

---

**End of Module 01 Reference**

