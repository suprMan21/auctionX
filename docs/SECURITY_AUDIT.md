# Security Audit — AuctionX / Authentic Materials

**Date:** 2026-03-03
**Auditor:** Module 17 automated review
**Scope:** Full backend (Express 5), Supabase Edge Functions, React frontend
**Module:** 17 — E2E Testing & Security Audit

---

## Summary

| Area | Status | Notes |
|------|--------|-------|
| Authentication & Authorization | ✅ PASS | JWT + RLS on all writes |
| Admin Security | ✅ PASS | 3-layer check (JWT + admin_users + session_version) |
| Input Validation | ✅ PASS | Zod schemas on all mutation endpoints |
| CORS Configuration | ✅ PASS | Restricted to `FRONTEND_URL` env var |
| Content Security | ✅ PASS | Server-side `is_nsfw` floor enforced (Module 09) |
| Secrets Management | ✅ PASS | All secrets in env vars, never committed |
| Message Filtering | ✅ PASS | 10 off-platform contact patterns blocked |
| Rate Limiting — Bids | ✅ PASS | 10 req/min/IP on bid endpoints |
| Rate Limiting — Admin | ⚠️ NEEDS_WORK | In-memory Map (lost on restart) |
| Rate Limiting — Search | ⚠️ NEEDS_WORK | No rate limit on public `/search` |
| Webhook Verification | ⚠️ NEEDS_WORK | Only Stripe webhook fully verified |
| Payment Content Flags | ⚠️ NEEDS_WORK | Missing DB enum values (SWIMWEAR, LINGERIE, etc.) |

---

## 1. Authentication & Authorization

### Findings

**PASS — JWT enforced on all protected routes**

- `requireAuth` middleware applied via `router.use()` on all authenticated route groups.
- Supabase JWT verified server-side via `supabase.auth.getUser(token)`.
- User-scoped Supabase clients created per request — no shared anon client for writes.
- Row Level Security (RLS) enabled on all 31 database tables.

**PASS — Admin 3-layer verification**

`adminAuth` middleware performs:
1. JWT token validation via `requireAuth`
2. `admin_users` table membership check
3. `session_version` comparison against user record

### Recommendations

- Add token expiry refresh handling in the frontend `authStore` for long-lived sessions.
- Consider IP-based lockout after repeated failed auth attempts (currently no brute-force protection on `/login` calls — mitigated by Supabase's own rate limiting).

---

## 2. Input Validation

### Findings

**PASS — Zod validation on all mutation endpoints**

- `placeBid`: validates `amount_cents` (positive integer) and `max_bid_cents` (optional).
- `createListing`: full Zod schema validation via `ListingSchema`.
- `startConversation` / `sendMessage`: validates message body length, applies `messageFilter`.
- `process-payment` Edge Function: validates content flags, amount, currency.

**NOTE — `process-payment` content flags from client**

Content flags previously sourced from client request body (pre-Module 09). Module 09 fixed this by enforcing `is_nsfw` from the server-side listings table as a floor. However, `riskLevel` calculation still partially uses client-supplied `contentFlags` array. A full server-side lookup of content flags from the listing record is recommended before production deployment.

### Recommendations

- `process-payment`: resolve listing's content classification entirely server-side before processing.
- Add maximum body size limits (`express.json({ limit: '10kb' })`) — currently no explicit limit set.

---

## 3. Rate Limiting

### Findings

**PASS — Bid endpoint rate limited**

`express-rate-limit` applied: 10 requests/minute/IP on `POST /api/v1/auctions/:id/bids`.

**PASS — Admin tiered rate limiting**

Admin routes have tiered in-memory rate limiting per admin user ID.

**⚠️ NEEDS_WORK — No rate limit on `GET /search`**

The public `/search` endpoint has no rate limiting. This creates potential for:
- Enumeration attacks (scraping all listings)
- Resource exhaustion via high-volume search requests

**⚠️ NEEDS_WORK — Admin rate limiter uses in-memory Map**

The admin rate limit state is stored in an in-memory `Map`. On server restart or in multi-process deployments, this state is lost. An attacker could restart the process to clear rate limit state.

### Recommendations

1. **HIGH PRIORITY**: Add `express-rate-limit` to the search router: `rateLimit({ windowMs: 60_000, max: 60 })`.
2. **MEDIUM PRIORITY**: Replace in-memory admin rate limit Map with Redis or Supabase-backed store for persistence across restarts.
3. Consider adding rate limits to: `POST /conversations/start` (prevent conversation spam), `POST /auth/*` (Supabase handles this, verify config).

---

## 4. Content Security

### Findings

**PASS — Server-side NSFW floor enforced (Module 09)**

`process-payment` Edge Function fetches `is_nsfw` from the `listings` table and enforces it as a minimum floor for content flag risk assessment. Client-supplied flags cannot downgrade a server-confirmed NSFW listing.

**⚠️ NEEDS_WORK — Missing DB enum values for content_flag**

The `content_flag` database enum does not include: `SWIMWEAR`, `LINGERIE`, `PERSONAL_ITEM`, `FETISH`. These exist in the payment processor config logic but cannot be stored in the database. This causes silent fallback to TIER_1 fees for these content types.

**⚠️ NEEDS_WORK — `categories.default_content_flag` column missing**

The categories table uses `is_nsfw` boolean as a proxy for content classification. A proper `default_content_flag` column was planned but not implemented.

### Recommendations

1. Add missing values to the `content_flag` DB enum via migration.
2. Add `default_content_flag` to the categories table.
3. Server-side content flag resolution: look up category's default flag on listing creation.

---

## 5. CORS Configuration

### Findings

**PASS — CORS restricted to `FRONTEND_URL`**

```typescript
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));
```

`FRONTEND_URL` is a required environment variable. If unset, CORS headers are not emitted (restrictive default).

### Recommendations

- Confirm `FRONTEND_URL` is set correctly in all deployment environments.
- For local development, ensure `FRONTEND_URL=http://localhost:5173`.
- Consider adding CORS for the Supabase Edge Functions explicitly (they use Supabase's default permissive CORS — review `_shared/cors.ts`).

---

## 6. Secrets Management

### Findings

**PASS — All secrets in environment variables**

Verified: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `AWS_SECRET_ACCESS_KEY`, `SETTLE_SECRET`, `JWT_SECRET` are all loaded from `process.env`. No hardcoded secrets found in source files.

`.env` files are in `.gitignore`. `.env.test` added in Module 17 — must remain gitignored.

### Recommendations

- Rotate `SETTLE_SECRET` before production deployment.
- Store production secrets in a secret manager (AWS Secrets Manager, Supabase Vault) rather than raw env vars.
- Audit `supabase/.env.local` — ensure it is not committed.

---

## 7. Admin Security

### Findings

**PASS — 3-layer admin verification**

As described in Section 1. Additionally:

- Admin API uses `adminApi` on the frontend with separate token handling.
- `AdminProtectedRoute.tsx` performs a 2-stage guard: session check + `admin_users` table query.
- All admin actions are logged to the `audit_logs` table.

**NOTE — Frontend `AdminProtectedRoute` uses anon client**

The `AdminProtectedRoute` checks `admin_users` table using the anon Supabase client. If RLS on `admin_users` is restrictive (which it should be), this check may silently fail and block all admin users. The backend `adminAuth` middleware provides the authoritative check — the frontend guard is a UX improvement only.

### Recommendations

- Verify RLS on `admin_users` allows authenticated users to query their own row (`auth.uid() = user_id`).
- Consider a dedicated backend endpoint `GET /admin/me` to verify admin status from the frontend guard.

---

## 8. Message Filtering

### Findings

**PASS — Off-platform contact attempt detection**

`messageFilter.ts` implements 10 regex patterns blocking:
- Phone numbers (US and international formats)
- Email addresses
- Social media handles and platform names (WhatsApp, Telegram, Instagram, etc.)
- URL patterns

All messages are scanned before insertion. Flagged messages are rejected with a 400 error.

### Recommendations

- Add the `flagged` boolean column to messages (defined in schema) to allow soft-flagging for review rather than hard rejection.
- Consider fuzzy matching for obfuscated contact attempts (e.g., `d-o-t` for `.`).

---

## 9. Webhook Verification

### Findings

**⚠️ NEEDS_WORK — Only Stripe webhook fully verified**

`StripeProcessor.handleWebhook()` implements Stripe signature verification via `stripe.webhooks.constructEvent()`.

Other processors (`PaymentCloud`, `CCBill`, `Signature`, `NOWPayments`) have stub `handleWebhook()` implementations that do not verify request signatures. This means forged webhook calls from these processors would be processed without validation.

### Recommendations

1. **HIGH PRIORITY before going live**: Implement signature verification for each processor before enabling them in production.
2. Until verified, keep non-Stripe processors in sandbox/test mode only.
3. Add webhook replay protection (check `transaction_id` uniqueness before processing).

---

## 10. Remediation Priority List

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 HIGH | Add rate limiting to `GET /search` | Low (1 line) |
| 🔴 HIGH | Implement webhook signature verification for non-Stripe processors | High |
| 🟡 MEDIUM | Replace in-memory admin rate limit with persistent store | Medium |
| 🟡 MEDIUM | Full server-side content flag resolution in `process-payment` | Medium |
| 🟡 MEDIUM | Add missing content_flag enum values to DB | Low (migration) |
| 🟢 LOW | Add `express.json({ limit: '10kb' })` body size cap | Low |
| 🟢 LOW | Add `categories.default_content_flag` column | Low (migration) |
| 🟢 LOW | Fix frontend AdminProtectedRoute anon client issue | Low |
| 🟢 LOW | Add webhook replay protection | Medium |

---

## Appendix: Files Reviewed

- `backend/src/middleware/auth.ts` — requireAuth, adminAuth
- `backend/src/middleware/rateLimiter.ts` — bid + admin rate limits
- `backend/src/lib/messageFilter.ts` — off-platform filtering
- `backend/src/index.ts` — CORS, body parsing, route mounting
- `supabase/functions/process-payment/index.ts` — payment cascade
- `supabase/functions/payment-webhook/index.ts` — webhook handling
- `supabase/functions/_shared/payment/processors/StripeProcessor.ts` — Stripe webhook verification
- `frontend/src/features/admin/components/AdminProtectedRoute.tsx` — frontend admin guard
- All Supabase migration files — RLS policy verification
