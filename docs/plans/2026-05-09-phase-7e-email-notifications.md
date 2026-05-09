# Phase 7E — Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Postmark transactional email layer. As of 2026-05-09 the backend Node-side wiring (emailSender, 10 templates, notificationService, 4 controller call-sites) is already shipped — remaining scope is the Deno helper, three edge-function email triggers, and Supabase Auth SMTP.

**Architecture:** The backend already has a complete notification system (notificationService.ts → emailSender.ts → 10 HTML templates) running against Postmark's Node SDK in production. Edge functions that trigger emails (settle-auction, release-escrow, check-payment-window) use Postmark's REST API directly via fetch (no SDK needed in Deno). Supabase Auth emails (welcome, password reset) are configured separately via the Supabase Dashboard SMTP settings.

> **2026-05-09 status update:** Discovered during 7C/7E consolidated planning that Tasks 1–3 below (postmark npm install, replacing the emailSender stub, controller wiring) were already merged in commit `8534036` and earlier work. Marked completed inline. The remaining live tasks are 4–10.

**Tech Stack:** Postmark Node.js SDK (`postmark` npm package), Postmark REST API (for Deno edge functions), Supabase Auth SMTP settings

**LOCKED DECISION:** Postmark is the transactional email provider (Decisions DB, locked March 2026). Do not use Resend, SendGrid, or AWS SES.

---

## Context

- **Project root:** `projectClaude/unmentionables/Unmen/` — run all commands from here
- **Branch:** Create `feature/phase-7e-email-notifications` off `dev`
- **Current state (2026-05-09):** emailSender.ts at `backend/src/lib/notifications/emailSender.ts` is a real Postmark `ServerClient` implementation. 10 complete HTML email templates exist in `backend/src/lib/notifications/emailTemplates.ts`. notificationService.ts is fully wired with preference checks. Four controllers (bid, payout, verification, messaging) already call `notificationService.send()` for transactional events.
- **Key constraint:** Edge functions (Deno runtime) cannot use Node.js npm packages — use Postmark REST API via fetch instead.
- **Postmark note:** You'll need a Postmark server token. The account uses stream separation: use the `outbound` message stream for transactional emails. The FROM address should be `noreply@authentic-materials.com` (or `noreply@collectxmrkt.com` for AuctionX). Get the actual server token from Boss.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/lib/notifications/emailSender.ts` | Modify | Replace stub with Postmark Node SDK |
| `backend/.env.example` | Modify | Add POSTMARK_SERVER_TOKEN, POSTMARK_FROM_EMAIL |
| `backend/package.json` | Modify | Add `postmark` package |
| `supabase/functions/_shared/postmark.ts` | Create | Postmark REST helper for Deno edge functions |
| `supabase/functions/settle-auction/index.ts` | Modify | Add AUCTION_WON email |
| `supabase/functions/release-escrow/index.ts` | Modify | Add ESCROW_RELEASED email |
| `supabase/functions/check-payment-window/index.ts` | Modify | Add PAYMENT_WINDOW_EXPIRING email |

---

## Task 1: Branch Setup + Install Postmark — ✅ COMPLETED in prior session (discovered 2026-05-09)

> Postmark `4.0.7` is already in `backend/package.json`. Skip steps 2 and 4. Step 3 (.env.example) is the only remaining piece and is handled fresh below.

**Files:**
- `backend/package.json`
- `backend/.env.example`

- [ ] **Step 1: Create feature branch**

```bash
cd /Volumes/myDev_Drive/Dev/dev/projectClaude/unmentionables/Unmen
git checkout dev && git pull origin dev
git checkout -b feature/phase-7e-email-notifications
```

- [ ] **Step 2: Install postmark package**

```bash
cd backend && npm install postmark
```

Expected: `postmark` appears in package.json dependencies.

- [ ] **Step 3: Add env vars to .env.example**

In `backend/.env.example`, add after the existing PORT line:

```env
# Email (Postmark)
POSTMARK_SERVER_TOKEN=your_postmark_server_token_here
POSTMARK_FROM_EMAIL=noreply@authentic-materials.com
```

- [ ] **Step 4: Verify install**

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors (postmark package includes types).

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/package.json backend/package-lock.json backend/.env.example
git commit -m "feat(7e): install postmark, add env vars to .env.example"
```

---

## Task 2: Replace emailSender Stub with Postmark — ✅ COMPLETED in prior session (discovered 2026-05-09)

> The file at `backend/src/lib/notifications/emailSender.ts` is already a Postmark `ServerClient` implementation matching the spec below. Verify with `cat backend/src/lib/notifications/emailSender.ts` if uncertain. Skip this task.

**Files:**
- Modify: `backend/src/lib/notifications/emailSender.ts`

- [ ] **Step 1: Read the current stub**

Read `backend/src/lib/notifications/emailSender.ts` to confirm its interface before replacing.

- [ ] **Step 2: Write the Postmark implementation**

Replace the entire file content:

```typescript
import * as postmark from 'postmark';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

const client = new postmark.ServerClient(
  process.env.POSTMARK_SERVER_TOKEN ?? ''
);

const FROM = process.env.POSTMARK_FROM_EMAIL ?? 'noreply@authentic-materials.com';

export const sendEmail = async (payload: EmailPayload): Promise<boolean> => {
  if (!process.env.POSTMARK_SERVER_TOKEN) {
    console.warn('[email] POSTMARK_SERVER_TOKEN not set — skipping email send');
    return false;
  }
  try {
    await client.sendEmail({
      From: FROM,
      To: payload.to,
      Subject: payload.subject,
      HtmlBody: payload.html,
      MessageStream: 'outbound',
    });
    return true;
  } catch (err) {
    console.error('[email] Postmark send failed:', err);
    return false;
  }
};
```

- [ ] **Step 3: TypeScript check**

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/notifications/emailSender.ts
git commit -m "feat(7e): implement Postmark email sender (replaces stub)"
```

---

## Task 3: Verify Backend Controller Email Paths — ✅ COMPLETED in prior session (discovered 2026-05-09)

> Confirmed: `notificationService.ts` maps all 10 notification types to email templates and respects `email_enabled` preference. Four controllers (bidController, payoutController, verificationController, messagingController) call `notificationService.send()`. Skip this task.

The notificationService.ts already calls sendEmail for all 10 notification types. Verify the 4 wired controllers trigger the right types by reading them — no code changes needed unless something is missing.

**Files:**
- Read: `backend/src/lib/notifications/notificationService.ts`
- Read: `backend/src/controllers/bidController.ts`
- Read: `backend/src/controllers/payoutController.ts`
- Read: `backend/src/controllers/verificationController.ts`
- Read: `backend/src/controllers/messagingController.ts`

- [ ] **Step 1: Read notificationService.ts**

Confirm sendEmail is called when `email_enabled` is true in preferences. Confirm all 10 notification types are mapped to email template functions.

- [ ] **Step 2: Verify template mapping completeness**

Read `backend/src/lib/notifications/emailTemplates.ts`. Confirm these 10 functions exist:
- `auctionWonEmail`
- `outbidEmail`
- `paymentReceivedEmail`
- `payoutCompletedEmail`
- `escrowReleasedEmail`
- `messageReceivedEmail`
- `itemScannedEmail`
- `settlementCascadeEmail`
- `paymentWindowExpiringEmail`
- `disputeOpenedEmail`

- [ ] **Step 3: Check notificationService maps all types to templates**

In notificationService.ts, look for the type→template mapping. If any of the 10 types above are NOT mapped to a template function, add the mapping. The pattern should be:

```typescript
case 'AUCTION_WON':
  html = auctionWonEmail(data);
  subject = 'You won the auction!';
  break;
// ... etc for all 10 types
```

- [ ] **Step 4: TypeScript check**

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit if any changes were made**

```bash
git add backend/src/lib/notifications/notificationService.ts
git commit -m "feat(7e): ensure all notification types mapped to email templates"
```

---

## Task 4: Postmark Helper for Deno Edge Functions

Edge functions run in Deno and cannot use npm packages. Create a shared Postmark helper that uses fetch.

**Files:**
- Create: `supabase/functions/_shared/postmark.ts`

- [ ] **Step 1: Check existing _shared directory**

```bash
ls supabase/functions/_shared/
```

Note what files already exist (e.g., corsHeaders.ts, supabaseClient.ts).

- [ ] **Step 2: Create postmark.ts**

```typescript
export interface PostmarkEmailPayload {
  to: string;
  subject: string;
  htmlBody: string;
}

export async function sendEmail(payload: PostmarkEmailPayload): Promise<void> {
  const token = Deno.env.get('POSTMARK_SERVER_TOKEN');
  const from = Deno.env.get('POSTMARK_FROM_EMAIL') ?? 'noreply@authentic-materials.com';

  if (!token) {
    console.warn('[postmark] POSTMARK_SERVER_TOKEN not set — skipping email');
    return;
  }

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      From: from,
      To: payload.to,
      Subject: payload.subject,
      HtmlBody: payload.htmlBody,
      MessageStream: 'outbound',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[postmark] Send failed (${res.status}): ${body}`);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/postmark.ts
git commit -m "feat(7e): add Postmark REST helper for Deno edge functions"
```

---

## Task 5: Wire AUCTION_WON Email in settle-auction

When settle-auction creates a PENDING_PAYMENT settlement, it notifies the winner. Read the current notification code and add an email via the Postmark helper.

**Files:**
- Modify: `supabase/functions/settle-auction/index.ts`

- [ ] **Step 1: Read settle-auction/index.ts**

Look for where the winner notification is sent (should be near lines 240–280). Note the winner's email address — you may need to query the users table for their email.

- [ ] **Step 2: Add import at top of file**

```typescript
import { sendEmail } from '../_shared/postmark.ts';
```

- [ ] **Step 3: Find the winner notification block and add email**

After the existing notification insert, add (adapt the template inline since we can't import from backend):

```typescript
// Send AUCTION_WON email to winner
const { data: winnerUser } = await serviceClient
  .from('users')
  .select('email, username')
  .eq('id', winner.id)
  .single();

if (winnerUser?.email) {
  const paymentDeadline = new Date(settlement.payment_window_expires_at).toLocaleString();
  await sendEmail({
    to: winnerUser.email,
    subject: `You won: ${auction.title ?? 'the auction'}`,
    htmlBody: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#13131a;color:#fff;padding:24px;border-radius:12px;">
        <h1 style="background:linear-gradient(135deg,#7c3aed,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">You Won!</h1>
        <p>Hi ${winnerUser.username ?? 'there'},</p>
        <p>Congratulations — you won <strong>${auction.title ?? 'the auction'}</strong> for <strong>$${(settlement.gross_amount_cents / 100).toFixed(2)}</strong>.</p>
        <p>Complete your payment by <strong>${paymentDeadline}</strong> to secure your item.</p>
        <a href="${Deno.env.get('FRONTEND_URL') ?? ''}/settlements/${settlement.id}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#fff;border-radius:8px;text-decoration:none;margin-top:16px;">Complete Payment</a>
      </div>
    `,
  });
}
```

- [ ] **Step 4: Verify the function still deploys**

```bash
supabase functions serve settle-auction --env-file supabase/.env.local --no-verify-jwt
```

Check no TypeScript errors in Deno output.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/settle-auction/index.ts
git commit -m "feat(7e): send AUCTION_WON email via Postmark from settle-auction"
```

---

## Task 6: Wire ESCROW_RELEASED Email in release-escrow

**Files:**
- Modify: `supabase/functions/release-escrow/index.ts`

- [ ] **Step 1: Read release-escrow/index.ts**

Find the notification block (lines 241–272 per audit). Note how buyer and seller are notified.

- [ ] **Step 2: Add import**

```typescript
import { sendEmail } from '../_shared/postmark.ts';
```

- [ ] **Step 3: Query emails and send after status update**

After the existing notification inserts (and after status is set to RELEASED), add:

```typescript
// Fetch emails for both parties
const { data: parties } = await serviceClient
  .from('users')
  .select('id, email, username')
  .in('id', [settlement.seller_id, settlement.buyer_id].filter(Boolean));

const seller = parties?.find((u) => u.id === settlement.seller_id);
const buyer = parties?.find((u) => u.id === settlement.buyer_id);
const amount = `$${(settlement.net_amount_cents / 100).toFixed(2)}`;

if (seller?.email) {
  await sendEmail({
    to: seller.email,
    subject: 'Escrow released — your payout is processing',
    htmlBody: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#13131a;color:#fff;padding:24px;border-radius:12px;">
        <h2 style="color:#22c55e;">Payout Processing</h2>
        <p>Hi ${seller.username ?? 'there'},</p>
        <p>The escrow for your sale has been released. Your payout of <strong>${amount}</strong> is now being processed.</p>
        <a href="${Deno.env.get('FRONTEND_URL') ?? ''}/payouts" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#fff;border-radius:8px;text-decoration:none;margin-top:16px;">View Payouts</a>
      </div>
    `,
  });
}

if (buyer?.email) {
  await sendEmail({
    to: buyer.email,
    subject: 'Your purchase is confirmed',
    htmlBody: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#13131a;color:#fff;padding:24px;border-radius:12px;">
        <h2 style="color:#22c55e;">Purchase Confirmed</h2>
        <p>Hi ${buyer.username ?? 'there'},</p>
        <p>Your purchase is confirmed and the seller has been paid. Expect shipping updates soon.</p>
        <a href="${Deno.env.get('FRONTEND_URL') ?? ''}/purchases" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#fff;border-radius:8px;text-decoration:none;margin-top:16px;">View Purchases</a>
      </div>
    `,
  });
}
```

- [ ] **Step 4: Verify with serve**

```bash
supabase functions serve release-escrow --env-file supabase/.env.local --no-verify-jwt
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/release-escrow/index.ts
git commit -m "feat(7e): send ESCROW_RELEASED emails via Postmark from release-escrow"
```

---

## Task 7: Wire PAYMENT_WINDOW_EXPIRING Email in check-payment-window

**Files:**
- Modify: `supabase/functions/check-payment-window/index.ts`

- [ ] **Step 1: Read check-payment-window/index.ts**

Find where expired offers are processed. Note the buyer_id on each offer.

- [ ] **Step 2: Add import and email send**

```typescript
import { sendEmail } from '../_shared/postmark.ts';
```

After marking an offer expired, fetch the buyer's email and send:

```typescript
const { data: buyer } = await serviceClient
  .from('users')
  .select('email, username')
  .eq('id', expiredOffer.buyer_id)
  .single();

if (buyer?.email) {
  await sendEmail({
    to: buyer.email,
    subject: 'Payment window expired — your offer was cancelled',
    htmlBody: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#13131a;color:#fff;padding:24px;border-radius:12px;">
        <h2 style="color:#ef4444;">Payment Window Expired</h2>
        <p>Hi ${buyer.username ?? 'there'},</p>
        <p>Your payment window for a recent auction expired before payment was completed. A penalty has been applied to your account.</p>
        <p>Please ensure you complete payments promptly to avoid further restrictions.</p>
        <a href="${Deno.env.get('FRONTEND_URL') ?? ''}/account" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#fff;border-radius:8px;text-decoration:none;margin-top:16px;">View Account</a>
      </div>
    `,
  });
}
```

- [ ] **Step 3: Verify with serve**

```bash
supabase functions serve check-payment-window --env-file supabase/.env.local --no-verify-jwt
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/check-payment-window/index.ts
git commit -m "feat(7e): send payment window expiry email via Postmark"
```

---

## Task 8: Configure Supabase Auth SMTP (Postmark)

Supabase Auth (GoTrue) handles welcome/confirmation and password reset emails. Configure it to send via Postmark SMTP.

**This is a dashboard/config task — no code changes.**

- [ ] **Step 1: Get Postmark SMTP credentials**

In Postmark Dashboard:
- Go to your server → Settings → SMTP
- SMTP host: `smtp.postmarkapp.com`
- Port: 587 (TLS) or 465 (SSL)
- Username: your server token
- Password: your server token (same as username for Postmark SMTP)

- [ ] **Step 2: Configure in Supabase Dashboard**

Go to: https://supabase.com/dashboard/project/pmlofthmobglcfkqjtru/auth/smtp

Enable Custom SMTP and fill in:
- Host: `smtp.postmarkapp.com`
- Port: `587`
- Username: `<POSTMARK_SERVER_TOKEN>`
- Password: `<POSTMARK_SERVER_TOKEN>`
- Sender name: `Authentic Materials`
- Sender email: `noreply@authentic-materials.com`

- [ ] **Step 3: Test with a password reset**

Log out of the staging test account (`test@authenticmaterials.com`) and trigger a password reset. Verify email arrives in inbox.

- [ ] **Step 4: Commit a verification note**

```bash
echo "Supabase Auth SMTP configured via Postmark on $(date)" >> docs/PHASE_7E_SMTP_CONFIG.md
git add docs/PHASE_7E_SMTP_CONFIG.md
git commit -m "docs(7e): note Supabase Auth SMTP configured via Postmark"
```

---

## Task 9: End-to-End Verification

- [ ] **Step 1: TypeScript check (both)**

```bash
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```

Expected: 0 errors in both.

- [ ] **Step 2: Run backend tests**

```bash
cd backend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Test backend email path manually**

With the backend running locally (`cd backend && npm run dev`):
1. Log in as `test@authenticmaterials.com`
2. Place a bid that gets outbid — verify AUCTION_OUTBID email arrives in inbox
3. Check server logs for `[email]` entries confirming Postmark responses

- [ ] **Step 4: Deploy edge functions**

```bash
supabase functions deploy settle-auction
supabase functions deploy release-escrow
supabase functions deploy check-payment-window
```

Confirm no deployment errors.

- [ ] **Step 5: Add POSTMARK_SERVER_TOKEN to edge function env**

```bash
supabase secrets set POSTMARK_SERVER_TOKEN=<your_token>
supabase secrets set POSTMARK_FROM_EMAIL=noreply@authentic-materials.com
```

---

## Task 10: Session Close-Out

- [ ] **Step 1: Create verification doc**

Create `docs/PHASE_7E_VERIFICATION.md` with:
- Checklist of what was implemented
- Email types now sending: list all wired notification types
- SMTP configured: yes/no
- TypeScript: 0 errors
- Tests: pass/fail count

- [ ] **Step 2: Merge to dev**

```bash
git checkout dev && git pull origin dev
git merge feature/phase-7e-email-notifications
git push origin dev
```

- [ ] **Step 3: Add Lessons Learned to Notion**

Add any gotchas to the Lessons Learned DB (`collection://dae3b391-3163-4fd0-9eee-586d923415d1`).

---

## Verification

End-to-end test:
1. Trigger an outbid via the staging frontend — confirm email arrives
2. Check Postmark activity log in dashboard for sent messages
3. Trigger password reset — confirm Supabase Auth email arrives via Postmark
4. `npx tsc --noEmit` in both frontend and backend — 0 errors
5. `cd backend && npx vitest run` — all pass
