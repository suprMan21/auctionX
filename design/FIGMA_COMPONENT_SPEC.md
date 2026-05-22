# Authentic Materials — Figma Component Spec

> **Handoff document for UX designers.** Import `design-tokens.json` via Tokens Studio, then build components following this spec.

---

## 1. Setup Instructions

### Tokens Studio Import
1. Install **Tokens Studio** plugin in Figma
2. Create a new token set → Import JSON → select `design-tokens.json`
3. Apply the token set to your Figma file
4. Tokens will appear as Figma Variables under the `AuctionX` collection (legacy identifier kept to match the schema-locked `brand_type = 'AUCTIONX'` DB enum that drives the Authentic Materials SFW stream — do not rename in Figma without coordinating a token-set migration)

### Typography
- Install **Plus Jakarta Sans** from Google Fonts (weights: 400, 500, 600, 700)
- Set as the default font in your Figma file's text styles

---

## 2. Figma File Structure

Recommended pages:

| Page | Contents |
|------|----------|
| **Cover** | Project title, version, last updated |
| **Tokens** | Color swatches, type scale, spacing grid, radius samples |
| **Components** | All reusable components (auto-layout) |
| **Templates** | Full page compositions |
| **Flows** | User journey wireflows |
| **Handoff** | Developer annotations, redlines |

---

## 3. Core Components

### 3.1 Card
- **Background:** `glass.level1.background` — `rgba(255,255,255,0.04)`
- **Border:** 1px solid `glass.level1.border` — `rgba(255,255,255,0.08)`
- **Border radius:** `borderRadius.card` — `20px`
- **Backdrop blur:** `24px` (Figma: Layer blur → Background blur)
- **Padding:** `spacing.6` — `24px`
- **Hover state:** bg → `rgba(255,255,255,0.06)`, border → `rgba(255,255,255,0.14)`

### 3.2 Button — Primary
- **Background:** Gradient fill `135deg` → `#7c3aed` → `#6366f1` → `#3b82f6`
- **Text:** `#ffffff`, weight 600, size 14px
- **Border radius:** `borderRadius.btn` — `12px`
- **Padding:** `12px` vertical, `24px` horizontal
- **Shadow:** `0 4px 24px rgba(124, 58, 237, 0.25)`
- **Hover:** shadow intensifies to `0 8px 32px rgba(124, 58, 237, 0.35)`
- **Min height:** `44px` (touch target)

### 3.3 Button — Secondary
- **Background:** `glass.level1.background`
- **Border:** 1px solid `glass.level1.border`
- **Text:** `#ffffff`, weight 600, size 14px
- **Border radius:** `12px`
- **Padding:** same as primary
- **Hover:** bg/border transition to level2 values

### 3.4 Input
- **Background:** `dark.700` — `#1a1a24`
- **Border:** 1px solid `rgba(255,255,255,0.08)`
- **Border radius:** `12px`
- **Text:** `#ffffff`, size 14px
- **Placeholder:** `rgba(255,255,255,0.50)`
- **Focus:** border → `#7c3aed`, ring → `rgba(124, 58, 237, 0.25)` 3px
- **Padding:** `12px` vertical, `16px` horizontal

### 3.5 Badge
- **Background:** `rgba(124, 58, 237, 0.15)`
- **Text:** `#9333ea` (primary-400), weight 500, size 12px
- **Border radius:** `9999px` (pill)
- **Padding:** `4px` vertical, `12px` horizontal

### 3.6 Text Gradient
- Text fill: gradient `135deg` → `#7c3aed` → `#6366f1` → `#3b82f6`
- Used for hero headings and emphasis text

---

## 4. Domain Components

### 4.1 Bid Modal
- Glass level3 container (`rgba(255,255,255,0.10)`, blur `32px`)
- Scrim overlay: `rgba(0,0,0,0.60)`
- Current bid display: `text-gradient` large number
- Increment buttons: secondary button style
- Submit: primary button, full width
- Close: icon button top-right, `44px` touch target

### 4.2 Sticky Bid Bar
- Fixed bottom bar, glass level2
- Shows current bid, time remaining, "Place Bid" primary button
- Height: `64px`, padding `16px`
- Safe area inset aware (mobile)

### 4.3 Age Gate
- Full-screen overlay, `dark.900` background
- Brand logo centered
- "I am 18+" / "I am not 18+" buttons stacked
- Uses Unmentionables gradient for the confirm button

### 4.4 Trust Badges
- Row of icon + label badges
- Icons: shield (NFC verified), checkmark (authenticated), lock (secure payment)
- Glass level1 background, pill shape
- Size: compact — 12px text, 16px icon

### 4.5 Skeleton Loading
- Animated pulse: `dark.600` → `dark.500` → `dark.600`
- Match exact dimensions of content being loaded
- Border radius matches target component

### 4.6 Content Blur / Reveal
- Blurred state: `blur(20px)` on image, glass overlay with lock icon
- Revealed: smooth transition, blur → 0
- Age-gated badge in corner

### 4.7 Countdown Timer
- Segmented display: `DD : HH : MM : SS`
- Each segment in a glass-level1 pill
- Label below each: "days", "hours", "min", "sec" in `text-tertiary`
- Urgent state (<1hr): text turns `error.500`

### 4.8 Auth Image Gallery
- Carousel with pagination dots
- NFC verification badge overlay (top-right)
- Zoom on tap (modal, dark scrim)
- Thumbnail strip below (horizontal scroll)

---

## 5. Page Templates

### 5.1 Landing Page
- Hero section with text-gradient headline
- Ambient background blobs (purple, blue, indigo — see `index.css` keyframes)
- Featured auctions grid (3-col desktop, 1-col mobile)
- "How It Works" section with icon cards
- CTA bar with primary button

### 5.2 Browse / Search
- Filter bar (top) — glass card with dropdowns
- Grid layout: 4-col xl, 3-col lg, 2-col md, 1-col sm
- Card: image (aspect 4:3), title, current bid, time remaining
- Infinite scroll with skeleton loading

### 5.3 Listing Detail
- Image gallery (left/top), info panel (right/bottom)
- Sticky bid bar (mobile)
- Trust badges row
- Bid history accordion
- Creator profile card (glass, avatar + stats)
- NFC verification status section

### 5.4 Creator Storefront
- Cover image + avatar overlap
- Stats row: items listed, total sold, rating
- Active listings grid
- "About" section with bio

### 5.5 Create Listing
- Multi-step form wizard
- Image upload zone (dashed border, glass background)
- Category/condition selectors
- Pricing inputs with helper text
- Preview step before publish

### 5.6 Admin Dashboard
- Sidebar navigation (glass, dark.900 background)
- Stats cards row (4-up)
- Data tables with glass card containers
- Action buttons: approve (success), reject (error), flag (warning)

---

## 6. Responsive Behavior

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| **sm** | 640px | Single column, stacked cards |
| **md** | 768px | 2-column grid, side-by-side on detail pages |
| **lg** | 1024px | 3-column grid, sidebar appears |
| **xl** | 1280px | 4-column grid, max content width |
| **2xl** | 1536px | Wide layout, increased spacing |

- Navigation: hamburger menu below `lg`, full nav bar at `lg`+
- Bid bar: sticky bottom on mobile, inline on desktop
- Images: full-width on mobile, constrained on desktop

---

## 7. Accessibility Checklist (WCAG 2.2 AA)

- [ ] **Contrast:** 4.5:1 minimum for all text on backgrounds
- [ ] **Touch targets:** 44px minimum (48px preferred)
- [ ] **Focus indicators:** Visible focus ring on all interactive elements (`#7c3aed` ring, 3px)
- [ ] **Keyboard navigation:** All actions reachable via Tab / Enter / Escape
- [ ] **Screen reader:** All images have alt text; icons have aria-labels
- [ ] **Motion:** `prefers-reduced-motion` disables ambient blobs + transitions
- [ ] **Color independence:** Don't use color alone to convey meaning (add icons/text)
- [ ] **Error states:** Inputs show error text below, not just red border
- [ ] **Skip link:** "Skip to main content" link as first focusable element

---

## 8. Terminology Reference

| Term | Definition |
|------|-----------|
| **Creator** | Seller of items (not "seller" in UI) |
| **Collector** | Buyer of items (not "buyer" in UI) |
| **AM Proof** | NFC + NFT authentication certificate |
| **Authentic Materials** | Public-facing **SFW** brand — memorabilia, autographs, creator merch, fan collectibles. Domain: authentic-materials.com. Operated by The Craving Company Inc. |
| **Unmentionables** | Age-gated **NSFW** property — personal items, intimate content. Owned but not yet built; never publicly marketed. |
| **AuctionX** | Retired brand name. Persists ONLY as the locked DB enum value (`brand_type = 'AUCTIONX'`) identifying the Authentic Materials stream, and as AWS resource prefixes. Not user-facing. |
| **Trust Badge** | NFC verification indicator |
| **Content Flag** | Risk level (LOW/MEDIUM/HIGH) for payment routing — see CONTENT_FLAG_GUIDELINES.md for SFW/NSFW bucket mapping |
