# Session 19 — Notion Sync Drafts

Drafts for syncing to Notion DBs at session close. Notion MCP auth pending; once authorized, paste these into the relevant DBs.

---

## Lessons Learned DB (collection://dae3b391-3163-4fd0-9eee-586d923415d1)

### Lesson 1 — Supabase CLI `gen types` injects a `<claude-code-hint>` plugin tag that breaks TypeScript parsing

- **Category:** Build / Tooling
- **Severity:** Medium (breaks `tsc` until fixed; easy to miss)
- **Review Priority:** Every Session (any session that regenerates DB types)
- **Wrong Approach:** Pipe `npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru` straight to `database.types.ts`. The output includes a trailing `<claude-code-hint v="1" type="plugin" value="supabase@claude-plugins-official" />` line that `tsc` rejects as `error TS1005: ',' expected`.
- **Right Approach:** Always pipe through `sed '/^<claude-code-hint/d'` to strip the plugin tag. Canonical command:
  ```bash
  npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru 2>/dev/null \
    | sed '/^<claude-code-hint/d' > frontend/src/types/database.types.ts \
    && cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
  ```
- **Discovered:** Session 19, 2026-05-13 — frontend `tsc --noEmit` failed with 5 errors all on line 2636 col 19+ after regenerating types for `delivery_confirmed_at/by`. `od -c` revealed the trailing XML tag.

### Lesson 2 — Before building a new component for a stub UI, check related routes for an existing implementation

- **Category:** Process / Implementation Strategy
- **Severity:** Low (wastes implementation time, not a correctness bug)
- **Review Priority:** Module Start (before designing any new UI component)
- **Wrong Approach:** See a stub button at `/listings/:id` ("Place Bid" with no onClick), plan to build a new BidModal + BidForm + auction-state fetching. Was the original session 19 plan.
- **Right Approach:** Search for related routes and components first. `frontend/src/features/auctions/components/` already contained `AuctionDetailPage.tsx`, `BidPlacementForm.tsx`, `BidHistory.tsx`, `CurrentBidDisplay.tsx`, `CountdownTimer.tsx`, and `useAuction.ts` — a full bid flow at `/auctions/:id`. The stub Place Bid button just needed to navigate there. Building the modal would have duplicated a working flow and stripped context (bid history, countdown).
- **Why:** Multiple pages in a half-built marketplace can share conceptual entities (a listing has an auction) — a stub on one page may already have a complete implementation on the related page.
- **Discovered:** Session 19, 2026-05-13.

---

## Decisions DB (collection://83f2eb51-f6a0-49ee-9541-3a93ce857c24)

### Decision 1 — Stripe Elements / Payment Element deferred to Session 20

- **Status:** Locked
- **Category:** Technical / Product Roadmap
- **Impact:** Marketplace launch path
- **Review Priority:** Module Start (any session touching SettlementPage or Stripe integration)
- **Decision:** Defer wiring Stripe Elements / Payment Element on `SettlementPage.tsx` Pay Now button to Session 20, after Place Bid + Confirm Delivery + payment-webhook registration have shipped.
- **Rationale:** Stripe Elements has its own async surface area (3DS, network retries, async confirmPayment) that deserves dedicated session attention. Bundling with Place Bid + Confirm Delivery diluted both. Place Bid + Confirm Delivery are pure frontend wire-ups with low risk; Elements introduces a new dependency (`@stripe/stripe-js`, `@stripe/react-stripe-js`) and requires `op://AM_Development/Stripe/publishable-key` to be populated first.
- **Alternatives Considered:**
  - Test-mode `pm_card_visa` shortcut: rejected — throwaway code, hardcoded test card in production source is bad pattern.
  - All-in-one this session: rejected — too much surface area for one session; Elements deserves dedicated test coverage and time.
- **Implications:**
  - Pay Now button on SettlementPage stays as `alert()` stub through Session 19.
  - Real-buyer E2E test still requires curl with `pm_card_visa` for the payment step (session-18 pattern continues).
  - Boss must populate `op://AM_Development/Stripe/publishable-key` before Session 20.

### Decision 2 — Identity verification provider: Yoti

- **Status:** Locked
- **Category:** Technical / Trust & Safety / Compliance
- **Impact:** Cross-cutting — seller verification, age-gating for NSFW (Authentic Materials), KYC posture, user trust
- **Review Priority:** Every Session (any session touching seller verification, age gating, or NSFW listing routing)
- **Decision:** Identity verification across both storefronts (AuctionX SFW + Authentic Materials NSFW) will be powered by **Yoti**. Replaces the current manual document-upload + admin-review pipeline (`DocumentUploader` + `AdminSellerVerificationPage`).
- **Rationale:**
  - **Age estimation feature** directly serves the Authentic Materials NSFW age-gate requirement — single integration covers ID verification AND age verification, no separate provider for each gate.
  - **Reusable Yoti-app digital ID** matches the brand's privacy-forward positioning; users verify once and reuse across services.
  - **GDPR / privacy posture** is strongest in the industry — material differentiator for a personal-items marketplace.
  - **UK-based regulatory familiarity** with adult-content platforms (Yoti is already deployed on age-gated platforms like Pornhub via UK Online Safety Act compliance work).
  - Avoids the duplicate-source-of-truth issue with running both Stripe Identity (auto-triggered via Connect) and a manual document pipeline — Yoti becomes the single canonical identity record.
- **Alternatives Considered:**
  - **Stripe Identity** — natural fit since we're already on Stripe Connect; cheaper per verification (~$1.50 US); but lacks age-estimation, and ID data would be siloed in Stripe (no portable user-side identity).
  - **Persona** — best customization/UX, $0.50-5 tier pricing; lacks Yoti-app's reusable identity story.
  - **Plaid Identity Verification** — strong US coverage, ties to bank linking; not relevant for the dual-brand model and doesn't help age-gating.
  - **Onfido** — enterprise/AML focus, expensive (~$5+); overkill for marketplace KYC.
  - **Continue manual review** — won't scale, doesn't solve age-gating, no portable identity for users.
- **Implications:**
  - Seller verification flow must be rebuilt around Yoti's API (their hosted session URL or embedded SDK).
  - `users.seller_verification_status` becomes a derived flag from Yoti webhook events (`session.completed`, `session.failed`, etc.).
  - Age gate on Authentic Materials listing browse / detail pages should call Yoti's age-estimation endpoint at first visit (or piggyback on existing Yoti session).
  - 1Password secrets needed: `op://AM_Development/Yoti/sdk-id`, `op://AM_Development/Yoti/pem-key` (PEM private key for signing requests).
  - Stripe Connect onboarding still happens separately for payouts, but its ID-verification step now duplicates Yoti — investigate whether Yoti can satisfy Stripe Connect's KYC requirements directly (Stripe Connect Custom accounts support pre-collected KYC via API), or whether sellers need to verify in both.
  - New `AdminYotiSessionsPage` (or fold into existing AdminSellerVerificationPage) for admins to review session results, override approvals, and re-trigger verifications.

### Decision 3 — Place Bid button uses navigation, not a modal

- **Status:** Locked
- **Category:** Technical / UX
- **Impact:** Real-buyer bid UX
- **Review Priority:** As Needed (only if future work considers a modal-based bid flow)
- **Decision:** ViewListing's Place Bid button is a `Link` to `/auctions/:auctionId` (existing AuctionDetailPage with full BidPlacementForm). Did NOT build a new BidModal as originally planned.
- **Rationale:** AuctionDetailPage already had the full bid context (current price, bid history, countdown, proxy bidding). Replicating in a modal would have duplicated working components and stripped context the buyer needs to make a decision. Navigation reuses tested code paths.
- **Alternatives Considered:**
  - BidModal wrapping BidPlacementForm: rejected — buyer would lose bid history + countdown view.
  - Backend expansion to embed auction-state in listing-detail response: rejected — not needed once navigation was chosen.
- **Implications:**
  - `/listings/:id` and `/auctions/:id` remain separate pages. Future consolidation is a UX cleanup item, not a blocker.
  - `listingsApi.getById` was expanded to join `auctions(*)` so ViewListing can show current bid + countdown above the navigation button (decision summary needs the auction state, but full bidding lives on the destination page).
