# Module 15: Messaging System — Verification Report

**Date:** 2026-03-03
**Build Status:** ✅ Frontend 0 TS errors | ✅ Backend 0 TS errors | ✅ Production build PASS

---

## Files Created / Modified

| File | Type | Description |
|------|------|-------------|
| `supabase/migrations/20260302120000_messaging.sql` | NEW | conversations + messages tables, RLS, indexes, triggers, Realtime |
| `backend/src/lib/moderation/messageFilter.ts` | NEW | Off-platform payment/contact filter (10 patterns) |
| `backend/src/controllers/messagingController.ts` | NEW | 4 handlers: listConversations, getMessages, sendMessage, startConversation |
| `backend/src/routes/messages.ts` | NEW | Express router mounted at /api/v1/conversations |
| `backend/src/server.ts` | MODIFIED | Import + mount messageRoutes |
| `frontend/src/features/messaging/types/messaging.ts` | NEW | TypeScript types: Message, Conversation, ConversationWithDetails |
| `frontend/src/features/messaging/pages/ConversationsPage.tsx` | NEW | Two-panel responsive chat UI with Realtime subscriptions |
| `frontend/src/lib/api.ts` | MODIFIED | getConversations, getMessages, sendMessage, startConversation |
| `frontend/src/components/navigation/Header.tsx` | MODIFIED | Messages nav link + useUnreadCount hook with live badge |
| `frontend/src/features/auctions/pages/AuctionDetailPage.tsx` | MODIFIED | Message Seller button + modal for non-seller authenticated users |
| `frontend/src/App.tsx` | MODIFIED | /messages and /messages/:conversationId ProtectedRoutes |

---

## TypeScript Verification

```
cd unmentionables/Unmen/backend && npx tsc --noEmit
# → no output (0 errors) ✅

cd unmentionables/Unmen/frontend && npx tsc --noEmit
# → no output (0 errors) ✅

npm run build
# → ✓ built in 1.20s ✅
```

---

## Database Migration: `20260302120000_messaging.sql`

### Tables Created
- **conversations** — `(id, listing_id, participant_1_id, participant_2_id, last_message_at, last_message_preview, created_at, updated_at)`
  - UNIQUE constraint: `(listing_id, participant_1_id, participant_2_id)`
  - Trigger: `set_updated_at_conversations` (reuses existing `update_updated_at_column()`)
- **messages** — `(id, conversation_id, sender_id, body TEXT NOT NULL, read_at, flagged, flagged_reason, created_at)`

### Triggers
- `update_conversation_on_message()` — SECURITY DEFINER; fires AFTER INSERT on messages; updates `conversations.last_message_at` and `last_message_preview`.

### RLS Policies
| Table | Policy | Rule |
|-------|--------|------|
| conversations | `conversations_participant_read` | SELECT: is participant_1 or participant_2 |
| conversations | `conversations_participant_insert` | INSERT WITH CHECK: is participant |
| messages | `messages_participant_read` | SELECT: is conversation participant |
| messages | `messages_participant_insert` | INSERT WITH CHECK: sender_id = auth.uid() AND is participant |
| messages | `messages_participant_update` | UPDATE: sender_id != auth.uid() AND is participant (read receipts) |

### Indexes
- `idx_conversations_participant_1` / `_2` — participant lookups
- `idx_conversations_last_message_at` — DESC ordering for sidebar
- `idx_messages_conversation_id` / `sender_id` — message queries
- `idx_messages_unread` — partial index on `read_at IS NULL` for unread count efficiency

### Realtime
- Both `conversations` and `messages` tables added to `supabase_realtime` publication.

---

## Backend API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/conversations` | ✅ | List conversations with other-participant profile, listing title, unread count |
| POST | `/api/v1/conversations/start` | ✅ | Start conversation or reuse existing; participant order normalised |
| GET | `/api/v1/conversations/:id/messages` | ✅ | Paginated messages (oldest-first); marks unread as read |
| POST | `/api/v1/conversations/:id/messages` | ✅ | Send message; content filtered before insert |

### Content Filter (`messageFilter.ts`)
Blocks 10 patterns: PayPal, Venmo, CashApp, Zelle, Western Union/MoneyGram, crypto wallet addresses, WhatsApp, Telegram, Discord, off-platform payment phrases.

---

## Frontend Features

### ConversationsPage (`/messages`, `/messages/:conversationId`)
- **Desktop:** Two-panel layout — 320px sidebar + flex-1 thread panel
- **Mobile:** Full-screen list at `/messages`; full-screen thread at `/messages/:id`; back button navigates to `/messages`
- **Realtime (sidebar):** `postgres_changes` on `conversations` table — triggers list refresh for new preview/unread changes
- **Realtime (thread):** `postgres_changes INSERT` on `messages` filtered by `conversation_id` — appends incoming messages; auto-scrolls to bottom
- **Read marking:** `getMessages` triggers server-side `UPDATE messages SET read_at=NOW()` for unread messages from the other participant

### Header unread badge
- `useUnreadCount(userId)` hook — initial query + Realtime INSERT/UPDATE subscription on `messages` table
- Badge shows count (capped at 9+), disappears when 0

### AuctionDetailPage "Message Seller" button
- Visible only to: authenticated user who is NOT the seller
- Opens inline modal with textarea (max 2000 chars)
- Calls `api.startConversation(listingId, sellerId, body)`
- Navigates to `/messages/:conversationId` on success

---

## Pending Actions (before feature is live)

1. **Apply migration:** `npx supabase db push`
2. **Regenerate types:**
   ```bash
   npx supabase gen types typescript --project-id pmlofthmobglcfkqjtru > frontend/src/types/database.types.ts
   cp frontend/src/types/database.types.ts backend/src/types/database.types.ts
   ```
3. **Remove `as never` casts** in `ConversationsPage.tsx` (Realtime `postgres_changes`) and `Header.tsx` (`from('messages' as never)`) once types include the new tables.
4. **Tighten `useUnreadCount`** to scope the query to conversations the user participates in (currently queries all messages not sent by user — valid but imprecise until type regen).

---

## Smoke Test Checklist

- [ ] Open AuctionDetailPage as non-seller → "Message Seller" button visible
- [ ] Click → enter message → redirected to `/messages/:id`
- [ ] Conversation appears in list with preview text
- [ ] Send another message → appears in thread in real-time (no refresh)
- [ ] Open conversation as seller → message marked as read (read_at set)
- [ ] Header badge decrements after reading
- [ ] Enter `paypal.me/test` in message body → blocked with 400 error
- [ ] `/messages` on mobile → full-screen list; tap row → full-screen thread; back button returns to list
