# S-NFC3-FE follow-up Verification: transfer recipient email

**Date:** 2026-10-05 · **Branches:** `feature/s-nfc3-fe-recipient-email`, `fix/transfer-email-success-log`, `feature/transfer-email-layout`
**Commits:** `9804fa2` feature · `b260386` success log (both pushed + live) · `6548898` layout (merged to `dev`; verified as a local render, live after the 2026-10-05 close-out push)
**Feature Backlog:** "Transfer recipient email on initiate (Postmark)" → Shipped

## Results

| Gate | Result |
|---|---|
| Backend `tsc --noEmit` | 0 errors |
| Backend vitest | **428 passed / 21 skipped** (baseline 422 / 21; +6, no new skips) |
| Frontend | Untouched |
| Live (staging) | test2@ → test@ initiate and cancel: both emails received in a real inbox; `[EMAIL] ... accepted by Postmark` logged (pre-layout version) |
| Layout | Headless-Chrome render of both emails reviewed by Boss; real-inbox check pending the close-out push |

**Mutation-checked.** Relaxing the cancel guard to `if (cancelError)` made "refuses a cancel that loses the race, and sends nothing" fail; restored.

## What shipped

- `backend/src/lib/notifications/transferEmails.ts`: `transferInitiatedEmail`, `transferCancelledEmail`, `notifyTransferRecipient`.
  Transactional (not preference-gated), so a no-account recipient is covered. Resolves `to_email`, else `users.email` for `to_user_id`.
  Never names the sender. Never throws. Logs the transfer id and a hashed address only.
- `initiateTransfer` sends after the row persists; `cancelTransfer` sends a short notice.
- **Cancel race fix.** The conditional `UPDATE ... WHERE status='PENDING'` now uses `.select().maybeSingle()`; zero rows (webhook won) returns `conflict` instead of reporting CANCELLED and emailing.
- `sendEmail` no longer logs the raw recipient address.
- Layout: table-based shell with `bgcolor` fallbacks (Gmail/Outlook drop div margins and gradients), gradient bar, wordmark + "Where it came from matters.", numbered step rows, preheader, footer panel, copyright line. Brand Voice checked: no em dashes.

## Acceptance criteria

| Criterion | Status |
|---|---|
| Sent on initiate to `to_email`, no-account recipient included | ✅ test + live |
| Link to `/tokens` + instruction to tap the item | ✅ |
| No owner identity | ✅ test asserts sender email/id absent |
| Failures logged, never block | ✅ test: Postmark throws → 201 + PENDING |
| Cancel sends a short notice | ✅ test + live |
| Brand Voice Guide | ✅ |
| Tests mock Postmark | ✅ mocked at `sendEmail` |

## Not done / follow-ups

- Logo image in the header (Ideas DB). Legacy `emailTemplates.ts` shell still says "AuctionX" (Ideas DB).
- `SECURITY_LOG_HMAC_KEY` still unset, so `to_email_hash` is null in logs (existing TODO).
