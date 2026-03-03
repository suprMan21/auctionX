# Module 16 Verification — Notifications System

**Date:** 2026-03-03
**Build status after Module 16:**

| Check | Result |
|-------|--------|
| Frontend TypeScript | ✅ 0 errors |
| Backend TypeScript | ✅ 0 errors |
| Production build | ✅ PASS |
| DB migration pushed | ✅ Applied |
| Types regenerated | ✅ notifications + notification_preferences in database.types.ts |

---

## Files Created

| File | Description |
|------|-------------|
| `supabase/migrations/20260303000001_notifications.sql` | notifications + notification_preferences tables, indexes, RLS, realtime |
| `backend/src/lib/notifications/notificationService.ts` | NotificationService class — preference-aware in-app + email delivery |
| `backend/src/lib/notifications/emailSender.ts` | Email delivery stub (Resend-ready) |
| `backend/src/lib/notifications/emailTemplates.ts` | 10 typed email template functions |
| `backend/src/controllers/notificationController.ts` | 5 handlers: list, markRead, markAllRead, getPreferences, updatePreferences |
| `backend/src/routes/notifications.ts` | Express router mounted at /api/v1/notifications |
| `frontend/src/features/notifications/types/notification.ts` | Notification, NotificationPreferences, NotificationsResponse types |
| `frontend/src/features/notifications/components/NotificationBell.tsx` | Bell icon + dropdown with realtime badge |
| `frontend/src/features/notifications/pages/NotificationsPage.tsx` | Paginated history with filter tabs |
| `frontend/src/features/notifications/pages/NotificationPreferencesPage.tsx` | Toggle preferences with debounced save |

---

## Files Modified

| File | Change |
|------|--------|
| `backend/src/server.ts` | Mounted notificationRoutes at /api/v1/notifications |
| `backend/src/controllers/payoutController.ts` | Replaced stub with notificationService.sendBatch for DISPUTE_OPENED |
| `backend/src/controllers/bidController.ts` | Added AUCTION_OUTBID notification to displaced high bidder |
| `backend/src/controllers/verificationController.ts` | Added ITEM_SCANNED notification to current_owner_id |
| `backend/src/controllers/messagingController.ts` | Added MESSAGE_RECEIVED notification to other participant |
| `backend/src/lib/notifications/stubs.ts` | Added @deprecated JSDoc; no imports remain |
| `supabase/functions/settle-auction/index.ts` | Added AUCTION_WON notification + insertNotification helper |
| `supabase/functions/check-payment-window/index.ts` | Added SETTLEMENT_CASCADE notification + insertNotification helper |
| `supabase/functions/release-escrow/index.ts` | Added ESCROW_RELEASED + PAYOUT_COMPLETED notifications + helper |
| `supabase/functions/payment-webhook/index.ts` | Added PAYMENT_RECEIVED notifications + insertNotification helper |
| `frontend/src/components/navigation/Header.tsx` | Added <NotificationBell userId={user.id} /> |
| `frontend/src/App.tsx` | Added /notifications and /settings/notifications ProtectedRoutes |
| `frontend/src/lib/api.ts` | Added 5 notification API methods |

---

## Routes Added

### Backend API
- `GET    /api/v1/notifications` — list paginated notifications (auth required)
- `POST   /api/v1/notifications/mark-all-read` — bulk mark unread as read
- `GET    /api/v1/notifications/preferences` — fetch/upsert preferences
- `PUT    /api/v1/notifications/preferences` — update preferences
- `PATCH  /api/v1/notifications/:id/read` — mark single notification read

### Frontend
- `/notifications` — full notification history (ProtectedRoute)
- `/settings/notifications` — notification preferences (ProtectedRoute)

---

## Notification Types Wired

| Type | Trigger | Controller/Function |
|------|---------|---------------------|
| AUCTION_WON | Auction settled with winner | settle-auction edge fn |
| AUCTION_OUTBID | Bid displaces previous high bidder | bidController |
| PAYMENT_RECEIVED | Payment webhook: settlement → ESCROW_HOLD | payment-webhook edge fn |
| PAYOUT_COMPLETED | Escrow released, payout initiated | release-escrow edge fn |
| ESCROW_RELEASED | Settlement released after escrow period | release-escrow edge fn |
| MESSAGE_RECEIVED | New message sent in conversation | messagingController |
| ITEM_SCANNED | NFC token scanned | verificationController |
| SETTLEMENT_CASCADE | Offer cascaded to next eligible bidder | check-payment-window edge fn |
| DISPUTE_OPENED | Buyer opens dispute on settlement | payoutController |

---

## Architecture Notes

- NotificationService uses service-role client to bypass RLS — always pass service client
- Edge Functions use inline `insertNotification()` helper (Deno, can't import Node modules)
- Errors from notification inserts are caught and logged, never thrown — notifications are always non-fatal
- `in_app_enabled` is always true in the UI (locked); preference page controls email + per-type toggles
- Unknown notification types bypass preference filtering (treated as always-enabled)
- Realtime subscription on `notifications` table powers the bell badge + history page live updates

---

## Known Gaps (documented in TODO.md)

1. Email delivery is stub only — needs Resend API key + integration
2. MESSAGE_RECEIVED email is always sent (no offline > 5 min check)
3. PAYMENT_WINDOW_EXPIRING notifications are not yet triggered (needs pg_cron job)
4. Edge functions need `FRONTEND_URL` env var for action URLs
