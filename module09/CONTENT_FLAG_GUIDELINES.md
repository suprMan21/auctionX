# Content Flag Guidelines - AuctionX Platform

**Version:** 1.0  
**Last Updated:** January 27, 2026  
**Purpose:** Define content flags, risk levels, and marketing language for payment processor compliance

---

## Overview

Content flags determine which payment processors can process transactions. Using appropriate flags and marketing language is CRITICAL for:
1. Payment processor approval
2. Avoiding account termination
3. Reducing chargeback rates
4. Maintaining brand reputation

---

## Content Flag Categories

### LOW RISK (AuctionX Brand)

| Flag | Display Name | Description | Cascade |
|------|--------------|-------------|---------|
| `CONCERT_GEAR` | Concert Gear | Authentic stage-used equipment | Stripe first |
| `MEMORABILIA` | Memorabilia | Collectible items with historical value | Stripe first |
| `AUTOGRAPHED` | Autographed Items | Items with verified signatures | Stripe first |
| `SPORTS_EQUIPMENT` | Sports Equipment | Athletic gear and equipment | Stripe first |
| `VINTAGE_COLLECTIBLES` | Vintage Collectibles | Antique and vintage items | Stripe first |
| `FAN_MERCHANDISE` | Fan Merchandise | Official fan merchandise | Stripe first |

### MEDIUM RISK (Unmentionables SFW)

| Flag | Display Name | Description | Cascade |
|------|--------------|-------------|---------|
| `CREATOR_MERCH` | Creator Merchandise | Merchandise from content creators | PaymentCloud first |
| `COSPLAY` | Cosplay Items | Costumes and cosplay accessories | PaymentCloud first |
| `GAMING` | Gaming Collectibles | Video game related items | PaymentCloud first |
| `COLLECTIBLES` | General Collectibles | Various collectible items | PaymentCloud first |
| `DIGITAL_GOODS` | Digital Goods | Digital content and downloads | PaymentCloud first |

### HIGH RISK (Unmentionables NSFW)

| Flag | Display Name | Description | Cascade |
|------|--------------|-------------|---------|
| `ADULT_CONTENT` | Adult Content | Explicit adult material | Signature first |
| `NSFW` | NSFW | Not safe for work content | Signature first |
| `18_PLUS` | 18+ Only | Age-restricted content | Signature first |
| `EXPLICIT` | Explicit | Sexually explicit material | Signature first |
| `INTIMATE_ITEMS` | Intimate Items | Personal/intimate merchandise | Signature first |

---

## Marketing Language Guidelines

### ✅ APPROVED Language

**For Concert/Music Memorabilia:**
- "Authentic stage-worn apparel"
- "Concert-used equipment"
- "Tour merchandise"
- "Verified authentic memorabilia"
- "Professional-grade performance gear"

**For Creator Merchandise:**
- "Creator merchandise collection"
- "Exclusive fan items"
- "Limited edition collectibles"
- "Authentic creator products"
- "Verified creator merchandise"

**For Cosplay/Gaming:**
- "Professional cosplay costume"
- "Screen-accurate replica"
- "Collector's edition"
- "Gaming memorabilia"

### ❌ PROHIBITED Language

**Never use these terms:**
- "Sweaty" (any context)
- "Worn underwear"
- "Used intimate items"
- "Smells like [person]"
- "Body fluids"
- "Soiled"
- "Dirty" (when implying bodily)
- "Personal scent"
- Explicit sexual descriptions

**These trigger processor flags and can result in account termination.**

---

## Prohibited Content (All Processors)

**Absolutely forbidden regardless of flags:**
- ❌ Content featuring minors (anyone appearing <18)
- ❌ Non-consensual content
- ❌ Bestiality
- ❌ Extreme violence/gore
- ❌ "Fantasy" races that could imply underage (elves, fairies with childlike features)
- ❌ Simulated non-consent
- ❌ Incest themes
- ❌ Drug paraphernalia (with explicit drug references)

---

## Flag Assignment Rules

### Single Flag vs Multiple Flags

**Single Flag (Simple):**
```
Jersey signed by athlete → AUTOGRAPHED
Concert t-shirt → CONCERT_GEAR
Gaming figure → GAMING
```

**Multiple Flags (Complex):**
```
Signed concert poster → [AUTOGRAPHED, CONCERT_GEAR]
Creator cosplay outfit → [CREATOR_MERCH, COSPLAY]
Adult creator merchandise → [ADULT_CONTENT, CREATOR_MERCH]
```

### Risk Level Determination

When multiple flags present, use the HIGHEST risk level:
```
[CONCERT_GEAR, CREATOR_MERCH] → MEDIUM (CREATOR_MERCH dominates)
[MEMORABILIA, ADULT_CONTENT] → HIGH (ADULT_CONTENT dominates)
[COSPLAY, NSFW] → HIGH (NSFW dominates)
```

---

## Billing Descriptor Guidelines

**What appears on customer's credit card statement:**

| Processor | Descriptor Format |
|-----------|-------------------|
| Stripe | "AUCTIONX* [item type]" |
| PaymentCloud | "UNMENT* [item type]" |
| Signature | "UNMENTIONABLES" |
| CCBill | "CCBill.com *[merchant]" |

**Keep descriptors:**
- Under 22 characters
- Recognizable to buyer
- Free of explicit terms
- Consistent with marketing

---

## Compliance Checklist

Before listing goes live:

- [ ] Content flag(s) assigned
- [ ] Marketing language reviewed
- [ ] No prohibited terms in title/description
- [ ] Images appropriate for flag level
- [ ] Age verification if HIGH risk
- [ ] Billing descriptor appropriate

---

**END OF CONTENT FLAG GUIDELINES**
