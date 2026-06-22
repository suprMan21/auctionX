# S-NFC1.5 (Lane E) — NFC ⇄ Listing Schema Decoupling

**Status:** Migration authored, not yet pushed (`supabase db push` deferred to Boss auth).
**Migration:** `supabase/migrations/20260622000000_nfc_items_decoupling.sql`
**Branch:** `feature/s-nfc2-encoder`
**Date:** 2026-06-22

---

## 1. Why

Today NFC authentication is welded to marketplace listings:

- `item_verifications.listing_id` is `NOT NULL REFERENCES listings(id) ON DELETE CASCADE`
  — deleting a listing **destroys** its authentication record.
- `nfc_tags.item_id REFERENCES listings(id)` — a tag's "item" *is* a listing.

That means a physical, authenticatable object cannot exist in the system unless
it is also a live marketplace listing, and an authentication record is only as
durable as the listing it hangs off of. Lane E breaks that coupling **additively**:

1. Introduce a first-class **`items`** table. An item exists and is verifiable
   with **no listing**.
2. Add a structured **lifecycle** to tags (`nfc_lifecycle_status`).
3. Re-point verifications/tags at `items` via **new nullable columns** (the old
   listings pointers stay in place, deprecated).
4. Make authentication records **survive listing deletion**.
5. Allow **email-only ownership** + a **transfer-fee / reclaim** monetization model.

All changes obey the project Schema-Extension-Rules: additive only, new columns
nullable, no removed/renamed/retyped existing fields.

---

## 2. The `items` table (first-class object)

An item is the authenticatable thing. It may *later* gain a listing, but never
needs one.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id` | text default `'auctionx'` | |
| `creator_id` | uuid → `auth.users` (SET NULL) | the author/creator |
| `title`, `description` | text | |
| `origin_released` | bool default `false` | master gate for origin disclosure |
| `creator_name_visible` | bool default `false` | reveal creator identity to collectors |
| `location_visibility` | text default `'HIDDEN'` | `HIDDEN` \| `POI` \| `EXACT` |
| `origin_video_url` | text | |
| `origin_event` | text | POI label, e.g. `"John Summit · EDC Las Vegas 2026"` |
| `origin_date` | date | |
| `created_at`, `updated_at` | timestamptz | `updated_at` trigger |

### Owner-controlled disclosure (verification is owner-gated, NOT blanket public)

Verification reveals only what the **owner releases**:

- `origin_released = false` → the item row is invisible to collectors (RLS).
- `origin_released = true` → collectors may read the row; *which* origin columns
  are surfaced is governed by `creator_name_visible` and `location_visibility`
  (`HIDDEN` shows nothing, `POI` shows the `origin_event` point-of-interest label,
  `EXACT` shows precise location).

### PII rule (hard)

**Phone numbers and addresses MUST NEVER live on `items`.** This table is the
public-facing surface. PII stays on `auth.users` / user-profile / private tables
behind their own RLS. Because no PII column exists here, a `SELECT *` by a
collector physically cannot leak it. See §7 RLS.

---

## 3. Tag lifecycle state machine

New enum `nfc_lifecycle_status` and a **new nullable** column
`nfc_tags.lifecycle_status`. The legacy `nfc_tags.status TEXT` is left untouched
(additive); `lifecycle_status` is the structured successor.

```
ENROLLED ──claim──▶ CLAIMED ──link item──▶ ASSOCIATED ──authenticate──▶ ACTIVE
                                                                          │
                                          owner paid release ◀───────────┤
                                                   │                      │
                                                   ▼                      │
                                                RELEASED ──transfer──▶ TRANSFERRED
                                                                          │
                                                                          ▼
                                          (lost/destroyed/revoked) ──▶ RETIRED
```

| State | Meaning |
|-------|---------|
| `ENROLLED` | Tag manufactured + AES key registered; not yet claimed. |
| `CLAIMED` | An owner (email or user) has claimed the tag; no item linked yet. |
| `ASSOCIATED` | Tag linked to an `items` row; not yet authenticated. |
| `ACTIVE` | Item authenticated (video + on-chain); scans verify live. |
| `RELEASED` | **Owner-initiated paid release** that re-opens the tag for transfer. |
| `TRANSFERRED` | Ownership moved to a new holder; token may be re-issued. |
| `RETIRED` | Tag permanently decommissioned (lost / destroyed / revoked). |

`RELEASED` is the deliberate, paid "I'm selling/handing this on" act — it
distinguishes an intentional transfer from a silent re-scan, and is what gates
the transfer fee.

### Mapping from legacy `status TEXT`

| legacy `status` | seed `lifecycle_status` |
|-----------------|-------------------------|
| `active` | `ACTIVE` |
| `registered` + `activated_at` set | `ACTIVE` |
| `registered` | `ENROLLED` |
| anything else / NULL | `ENROLLED` (safe floor) |

Going forward both columns are written until the legacy `status` text field can
be deprecated in a later migration.

---

## 4. Decoupling the FKs

### `nfc_tags`

- Existing `item_id UUID REFERENCES listings(id)` — **DEPRECATED, left in place**
  (retyping it would violate the no-retype rule). Do not write new code against it.
- **NEW** `linked_item_id UUID REFERENCES items(id) ON DELETE SET NULL` — the
  decoupled pointer. All new reads/writes use this.

### `item_verifications`

- **NEW** `item_id UUID REFERENCES items(id) ON DELETE SET NULL`.
- `listing_id` relaxed `NOT NULL → NULLABLE` (a verification no longer requires a
  listing). Relaxing nullability does **not** retype the column → allowed.
- `listing_id` FK action changed `ON DELETE CASCADE → ON DELETE SET NULL`, so
  **deleting a listing never destroys an authentication record**. Same
  column/type — only the referential action changes (done by dropping and
  recreating the constraint, name-agnostic).

---

## 5. Email-only ownership flow

`item_verifications.current_owner_email TEXT` (new, nullable) lets ownership
attach to an **unregistered** email. `current_owner_id` stays nullable until that
person registers.

```
seller assigns owner email  ─▶  current_owner_email set, current_owner_id NULL
            │
recipient registers (matches email)
            ▼
   current_owner_id populated  ─▶  pay transfer fee  ─▶  ownership_transfers row,
                                                          transfer_fee_paid = true
```

Register → pay-fee → transfer. The email is the durable handle; the user id is
backfilled on registration. This supports gifting/selling to someone who is not
yet on the platform.

---

## 6. Transfer fee / payer matrix + reclaim model

New columns on `ownership_transfers` (all additive, nullable or defaulted):

| Column | Type | Default | Meaning |
|--------|------|---------|---------|
| `transfer_fee_cents` | int | NULL | fee charged for this transfer |
| `transfer_fee_paid` | bool | `false` | settled? |
| `fee_payer` | text | `'BUYER'` | `BUYER` \| `SELLER` |
| `source` | text | `'INTERNAL'` | `INTERNAL` \| `EXTERNAL_CASH` \| `PLUGIN` |
| `is_reclaim` | bool | `false` | reclaim path? |
| `requires_reverification` | bool | `false` | re-verify tag + product? |
| `reissued_token` | bool | `false` | new token encoded? |

### Fee / payer / source matrix

| Scenario | `source` | `fee_payer` | Notes |
|----------|----------|-------------|-------|
| In-app sale | `INTERNAL` | `BUYER` | standard marketplace transfer |
| Outside cash sale, app-mediated transfer | `EXTERNAL_CASH` | `SELLER` | seller absorbs the fee to cover a cash deal done off-platform |
| Plugin-mediated transfer | `PLUGIN` | `BUYER` (default) | 3rd-party plugin initiates |
| **Reclaim after skipped cash transfer** | `EXTERNAL_CASH` | `SELLER`/holder | full new-ticket fee, see below |

### Reclaim / re-issue path (Boss-decided)

If a cash transfer was **skipped** (item changed hands physically but no transfer
was logged) and the current holder later wants to reclaim/legitimize ownership,
it is **not** a cheap pointer flip. It requires:

- re-verification of **tag + product** (`requires_reverification = true`),
- a **new token** issued / re-encoded (`reissued_token = true`),
- charged at a **full new-ticket fee** (same as a fresh authentication).

Modelled as an `ownership_transfers` row with
`is_reclaim = true, requires_reverification = true, reissued_token = true`. The
tag passes through `RELEASED → TRANSFERRED` and the SUN counter / AES key are
rotated by the re-encode.

---

## 7. RLS

### `items`

- `items_creator_all` — `creator_id = auth.uid()` for ALL — owner reads/writes
  their full record.
- `items_public_read_released` — SELECT allowed only when `origin_released = TRUE`.
  Collectors/anon see released items only.
- Field-level gating (`creator_name_visible`, `location_visibility`) is enforced
  at the API/view layer today. **Hardening TODO:** expose collectors a restricted
  SQL VIEW that projects only the released columns, so the toggles are enforced in
  the database rather than the app. Noted inline in the migration.
- **No PII columns exist on `items`**, so `SELECT *` cannot leak phone/address.

### `item_verifications` / `ownership_transfers`

Existing policies (from `20260301100000_nfc_verification.sql`) are unchanged.
Owners see their own verifications; transfer participants see their transfers.

---

## 8. Backfill (idempotent)

Run inside the migration, safe to re-run:

1. **6a** — one `items` row per existing verification lacking an item
   (`creator_id = seller_id`, `title = token_name`).
2. **6b** — point `item_verifications.item_id` at the minted item (match on
   creator_id + title + created_at; `token_name` is UNIQUE so this is 1:1).
3. **6c** — propagate `items.id` onto `nfc_tags.linked_item_id` via the tag's
   `verification_id` link.
4. **6d** — seed `nfc_tags.lifecycle_status` from legacy `status` / `activated_at`
   per the §3 mapping.

Every step only fills NULLs / inserts where missing, so re-running is a no-op.

---

## 9. Deprecation plan for the old listings pointers

| Pointer | State now | Plan |
|---------|-----------|------|
| `nfc_tags.item_id → listings(id)` | retained, deprecated | stop new writes; backfill consumers onto `linked_item_id`; drop in a future major migration once no code reads it. |
| `item_verifications.listing_id → listings(id)` | retained, now NULLABLE + `SET NULL` | keep — it remains a *legitimate* optional link from a verification to a marketplace listing; no longer a hard dependency. |

The retype-collision that forced `linked_item_id` (rather than re-pointing
`item_id`) is the only reason two columns coexist; consolidation is a future,
explicitly-migrated step — never an in-place retype.

---

## 10. Schema-Extension-Rule judgment calls

- **New enum `nfc_lifecycle_status` used as nothing-yet but seeded via cast:**
  created whole with `CREATE TYPE ... AS ENUM(...)` (not `ALTER TYPE ADD VALUE`),
  so it is safe to reference in the same transaction. No `ADD VALUE` is used, so
  the "no ADD VALUE + reference in same txn" rule is not triggered.
- **`linked_item_id` instead of re-pointing `item_id`:** re-pointing
  `nfc_tags.item_id` from `listings` to `items` would be an FK retype → forbidden.
  Added a sibling column instead and deprecated the old one.
- **Relaxing `item_verifications.listing_id` `NOT NULL → NULL`:** allowed —
  relaxing nullability is not a retype and is explicitly permitted by Boss for
  this session.
- **Changing the `listing_id` FK action `CASCADE → SET NULL`:** allowed — same
  column/type, only the referential action changes. Done name-agnostically by
  querying `pg_constraint` so it works regardless of the auto-generated
  constraint name.
- **`NOT NULL DEFAULT` on new boolean/text columns** (`origin_released`,
  `transfer_fee_paid`, `fee_payer`, `source`, `is_reclaim`,
  `requires_reverification`, `reissued_token`): permitted because they carry a
  default, so existing rows are filled without a required-without-default break.
- **CHECK constraints** for `location_visibility`, `fee_payer`, `source`: added
  idempotently; they constrain only the new columns.
```
