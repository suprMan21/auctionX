/**
 * emailTemplates — minimal inline-CSS HTML email templates for each notification type.
 *
 * Each function returns a plain HTML string suitable for sending via Postmark or any
 * SMTP provider. All styles are inline to maximise email client compatibility.
 * No external dependencies are required.
 *
 * @module emailTemplates
 */

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="font-family:sans-serif;background:#13131a;color:#e5e7eb;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#1a1a24;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.1);">
    <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;background:linear-gradient(90deg,#7c3aed,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">
      AuctionX
    </h1>
    ${body}
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
    <p style="font-size:12px;color:#6b7280;margin:0;">You're receiving this because you have notifications enabled. Visit your <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings/notifications" style="color:#7c3aed;">notification settings</a> to update preferences.</p>
  </div>
</body>
</html>`;
}

function btn(href: string, text: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;text-decoration:none;border-radius:12px;font-weight:600;font-size:14px;">${text}</a>`;
}

/** Notification: user won an auction. */
export function auctionWonEmail(opts: {
  listingTitle: string;
  priceCents: number;
  settlementUrl: string;
}): { subject: string; html: string } {
  const price = (opts.priceCents / 100).toFixed(2);
  return {
    subject: `🎉 You won: ${opts.listingTitle}`,
    html: wrap('You Won!', `
      <h2 style="font-size:20px;margin:24px 0 8px;">Congratulations! You won the auction</h2>
      <p style="color:#9ca3af;margin:0 0 4px;">Item: <strong style="color:#e5e7eb;">${opts.listingTitle}</strong></p>
      <p style="color:#9ca3af;margin:0 0 16px;">Winning bid: <strong style="color:#e5e7eb;">$${price}</strong></p>
      <p style="color:#9ca3af;">You have a 20-minute window to complete payment. Act quickly to secure your item.</p>
      ${btn(opts.settlementUrl, 'Complete Payment')}
    `),
  };
}

/** Notification: user was outbid by another bidder. */
export function outbidEmail(opts: {
  listingTitle: string;
  newPriceCents: number;
  auctionUrl: string;
}): { subject: string; html: string } {
  const price = (opts.newPriceCents / 100).toFixed(2);
  return {
    subject: `You've been outbid on: ${opts.listingTitle}`,
    html: wrap('Outbid Alert', `
      <h2 style="font-size:20px;margin:24px 0 8px;">You've been outbid</h2>
      <p style="color:#9ca3af;margin:0 0 4px;">Item: <strong style="color:#e5e7eb;">${opts.listingTitle}</strong></p>
      <p style="color:#9ca3af;margin:0 0 16px;">New high bid: <strong style="color:#ef4444;">$${price}</strong></p>
      <p style="color:#9ca3af;">Don't let it slip away — place a higher bid now.</p>
      ${btn(opts.auctionUrl, 'Bid Again')}
    `),
  };
}

/** Notification: seller received payment for their item. */
export function paymentReceivedEmail(opts: {
  listingTitle: string;
  amountCents: number;
  settlementUrl: string;
}): { subject: string; html: string } {
  const amount = (opts.amountCents / 100).toFixed(2);
  return {
    subject: `Payment received for: ${opts.listingTitle}`,
    html: wrap('Payment Received', `
      <h2 style="font-size:20px;margin:24px 0 8px;">You received a payment</h2>
      <p style="color:#9ca3af;margin:0 0 4px;">Item: <strong style="color:#e5e7eb;">${opts.listingTitle}</strong></p>
      <p style="color:#9ca3af;margin:0 0 16px;">Amount: <strong style="color:#10b981;">$${amount}</strong></p>
      <p style="color:#9ca3af;">Funds are now in escrow. They will be released after the buyer's inspection period.</p>
      ${btn(opts.settlementUrl, 'View Settlement')}
    `),
  };
}

/** Notification: seller's payout has been completed. */
export function payoutCompletedEmail(opts: {
  netPayoutCents: number;
  payoutsUrl: string;
}): { subject: string; html: string } {
  const amount = (opts.netPayoutCents / 100).toFixed(2);
  return {
    subject: `Your payout of $${amount} is on its way`,
    html: wrap('Payout Completed', `
      <h2 style="font-size:20px;margin:24px 0 8px;">Your payout is being processed</h2>
      <p style="color:#9ca3af;margin:0 0 16px;">Net payout amount: <strong style="color:#10b981;">$${amount}</strong></p>
      <p style="color:#9ca3af;">Funds should arrive in your account within 2–5 business days depending on your bank.</p>
      ${btn(opts.payoutsUrl, 'View Payouts')}
    `),
  };
}

/** Notification: escrow has been released for a settlement. */
export function escrowReleasedEmail(opts: {
  listingTitle: string;
  settlementUrl: string;
  isSeller: boolean;
}): { subject: string; html: string } {
  return {
    subject: `Escrow released: ${opts.listingTitle}`,
    html: wrap('Escrow Released', `
      <h2 style="font-size:20px;margin:24px 0 8px;">Escrow funds have been released</h2>
      <p style="color:#9ca3af;margin:0 0 4px;">Item: <strong style="color:#e5e7eb;">${opts.listingTitle}</strong></p>
      <p style="color:#9ca3af;margin:0 0 16px;">${opts.isSeller
        ? 'Your payout is now being processed and should arrive shortly.'
        : 'The transaction has been completed successfully.'
      }</p>
      ${btn(opts.settlementUrl, 'View Details')}
    `),
  };
}

/** Notification: user received a new message. */
export function messageReceivedEmail(opts: {
  senderUsername: string;
  preview: string;
  messagesUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `New message from ${opts.senderUsername}`,
    html: wrap('New Message', `
      <h2 style="font-size:20px;margin:24px 0 8px;">You have a new message</h2>
      <p style="color:#9ca3af;margin:0 0 4px;">From: <strong style="color:#e5e7eb;">${opts.senderUsername}</strong></p>
      <blockquote style="border-left:3px solid #7c3aed;margin:16px 0;padding:8px 16px;color:#9ca3af;font-style:italic;">${opts.preview}</blockquote>
      ${btn(opts.messagesUrl, 'Reply')}
    `),
  };
}

/** Notification: an NFC-verified item owned by the user was scanned. */
export function itemScannedEmail(opts: {
  tokenName: string;
  verifyUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `Your item was scanned: ${opts.tokenName}`,
    html: wrap('Item Scanned', `
      <h2 style="font-size:20px;margin:24px 0 8px;">Your authenticated item was scanned</h2>
      <p style="color:#9ca3af;margin:0 0 4px;">Token: <strong style="color:#e5e7eb;">${opts.tokenName}</strong></p>
      <p style="color:#9ca3af;margin:0 0 16px;">Someone scanned your NFC-authenticated item. You can view the full provenance chain below.</p>
      ${btn(opts.verifyUrl, 'View Verification')}
    `),
  };
}

/** Notification: settlement offer cascaded to the user (previous winner failed to pay). */
export function settlementCascadeEmail(opts: {
  listingTitle: string;
  offerCents: number;
  settlementUrl: string;
}): { subject: string; html: string } {
  const price = (opts.offerCents / 100).toFixed(2);
  return {
    subject: `You have a purchase offer: ${opts.listingTitle}`,
    html: wrap('Purchase Offer', `
      <h2 style="font-size:20px;margin:24px 0 8px;">A purchase offer has come to you</h2>
      <p style="color:#9ca3af;margin:0 0 4px;">Item: <strong style="color:#e5e7eb;">${opts.listingTitle}</strong></p>
      <p style="color:#9ca3af;margin:0 0 4px;">Offer price: <strong style="color:#e5e7eb;">$${price}</strong></p>
      <p style="color:#9ca3af;margin:0 0 16px;">The previous winner did not complete payment. You now have a 20-minute window to pay.</p>
      ${btn(opts.settlementUrl, 'Complete Payment')}
    `),
  };
}

/** Notification: buyer's payment window is about to expire. */
export function paymentWindowExpiringEmail(opts: {
  listingTitle: string;
  minutesRemaining: number;
  settlementUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `⚠️ Payment window expiring: ${opts.listingTitle}`,
    html: wrap('Payment Window Expiring', `
      <h2 style="font-size:20px;margin:24px 0 8px;">Your payment window is expiring soon</h2>
      <p style="color:#9ca3af;margin:0 0 4px;">Item: <strong style="color:#e5e7eb;">${opts.listingTitle}</strong></p>
      <p style="color:#9ca3af;margin:0 0 16px;">You have approximately <strong style="color:#ef4444;">${opts.minutesRemaining} minutes</strong> remaining to complete payment or you will lose this item.</p>
      ${btn(opts.settlementUrl, 'Pay Now')}
    `),
  };
}

/** Notification: a dispute has been opened on a settlement. */
export function disputeOpenedEmail(opts: {
  settlementId: string;
  settlementUrl: string;
  isSeller: boolean;
}): { subject: string; html: string } {
  return {
    subject: `Dispute opened on settlement`,
    html: wrap('Dispute Opened', `
      <h2 style="font-size:20px;margin:24px 0 8px;">A dispute has been opened</h2>
      <p style="color:#9ca3af;margin:0 0 16px;">${opts.isSeller
        ? 'The buyer has opened a dispute on this settlement. Our team will review it and reach out if needed.'
        : 'Your dispute has been received and is under review. Our moderation team will follow up.'
      }</p>
      <p style="color:#9ca3af;margin:0 0 4px;">Settlement reference: <strong style="color:#e5e7eb;">${opts.settlementId.slice(0, 8)}…</strong></p>
      ${btn(opts.settlementUrl, 'View Settlement')}
    `),
  };
}

/**
 * Notification: an admin approved a dispute with a full refund.
 * Buyer hears "you're being refunded"; seller hears "your sale was refunded".
 */
export function disputeApprovedFullEmail(opts: {
  settlementId: string;
  settlementUrl: string;
  refundAmountCents: number;
  isSeller: boolean;
}): { subject: string; html: string } {
  const amount = (opts.refundAmountCents / 100).toFixed(2);
  return {
    subject: opts.isSeller
      ? `Dispute resolved against you — full refund issued`
      : `Refund issued: $${amount}`,
    html: wrap('Dispute Resolved — Full Refund', `
      <h2 style="font-size:20px;margin:24px 0 8px;">Dispute resolved — full refund</h2>
      <p style="color:#9ca3af;margin:0 0 16px;">${opts.isSeller
        ? `The dispute on this sale has been approved. The buyer is receiving a full refund of <strong style="color:#ef4444;">$${amount}</strong>. The funds have been released from escrow.`
        : `Your dispute has been approved. A full refund of <strong style="color:#10b981;">$${amount}</strong> has been issued back to your original payment method. Funds typically appear within 5–10 business days.`
      }</p>
      <p style="color:#9ca3af;margin:0 0 4px;">Settlement reference: <strong style="color:#e5e7eb;">${opts.settlementId.slice(0, 8)}…</strong></p>
      ${btn(opts.settlementUrl, 'View Details')}
    `),
  };
}

/** Notification: an admin approved a dispute with a partial refund. */
export function disputeApprovedPartialEmail(opts: {
  settlementId: string;
  settlementUrl: string;
  refundAmountCents: number;
  totalAmountCents: number;
  isSeller: boolean;
}): { subject: string; html: string } {
  const refund = (opts.refundAmountCents / 100).toFixed(2);
  const total = (opts.totalAmountCents / 100).toFixed(2);
  return {
    subject: opts.isSeller
      ? `Partial refund issued from your sale: $${refund}`
      : `Partial refund issued: $${refund}`,
    html: wrap('Dispute Resolved — Partial Refund', `
      <h2 style="font-size:20px;margin:24px 0 8px;">Dispute resolved — partial refund</h2>
      <p style="color:#9ca3af;margin:0 0 16px;">${opts.isSeller
        ? `The dispute on this sale was partially resolved in the buyer's favor. <strong style="color:#ef4444;">$${refund}</strong> of the <strong>$${total}</strong> sale was refunded. The remainder remains in escrow on its normal release schedule.`
        : `Your dispute was partially resolved. <strong style="color:#10b981;">$${refund}</strong> of the <strong>$${total}</strong> purchase has been refunded to your original payment method. Funds typically appear within 5–10 business days.`
      }</p>
      <p style="color:#9ca3af;margin:0 0 4px;">Settlement reference: <strong style="color:#e5e7eb;">${opts.settlementId.slice(0, 8)}…</strong></p>
      ${btn(opts.settlementUrl, 'View Details')}
    `),
  };
}

/**
 * Notification: an admin rejected a dispute.
 * Buyer gets an appeal link (within 7d window); seller hears "decided in your favor".
 */
export function disputeRejectedEmail(opts: {
  settlementId: string;
  settlementUrl: string;
  appealUrl?: string;
  appealDeadline?: string;
  isSeller: boolean;
}): { subject: string; html: string } {
  return {
    subject: opts.isSeller
      ? `Dispute decided in your favor`
      : `Dispute decision — payment will release to seller`,
    html: wrap('Dispute Decision', `
      <h2 style="font-size:20px;margin:24px 0 8px;">${opts.isSeller ? 'Dispute decided in your favor' : 'Dispute decision'}</h2>
      <p style="color:#9ca3af;margin:0 0 16px;">${opts.isSeller
        ? `The dispute on this sale has been rejected. The escrow will continue to its normal release schedule and your payout will arrive as planned.`
        : `Your dispute has been reviewed and the decision is to release funds to the seller. If you believe this was decided in error, you can appeal within 7 days.`
      }</p>
      <p style="color:#9ca3af;margin:0 0 4px;">Settlement reference: <strong style="color:#e5e7eb;">${opts.settlementId.slice(0, 8)}…</strong></p>
      ${!opts.isSeller && opts.appealUrl && opts.appealDeadline
        ? `<p style="color:#9ca3af;margin:12px 0 0;">Appeal deadline: <strong style="color:#e5e7eb;">${opts.appealDeadline}</strong></p>${btn(opts.appealUrl, 'File an Appeal')}`
        : btn(opts.settlementUrl, 'View Details')
      }
    `),
  };
}

/** Notification: buyer opened an appeal after a rejection. */
export function disputeAppealOpenedEmail(opts: {
  settlementId: string;
  settlementUrl: string;
  isSeller: boolean;
}): { subject: string; html: string } {
  return {
    subject: opts.isSeller
      ? `Buyer has appealed the rejected dispute`
      : `Appeal received — under review`,
    html: wrap('Dispute Appeal Opened', `
      <h2 style="font-size:20px;margin:24px 0 8px;">${opts.isSeller ? 'The buyer has appealed' : 'Your appeal has been received'}</h2>
      <p style="color:#9ca3af;margin:0 0 16px;">${opts.isSeller
        ? `The buyer has filed an appeal on the dispute decision. Escrow release is paused pending our re-review. We'll be in touch with the outcome.`
        : `Your appeal has been submitted and the settlement is paused pending re-review by our moderation team. We'll email you once a decision is made.`
      }</p>
      <p style="color:#9ca3af;margin:0 0 4px;">Settlement reference: <strong style="color:#e5e7eb;">${opts.settlementId.slice(0, 8)}…</strong></p>
      ${btn(opts.settlementUrl, 'View Settlement')}
    `),
  };
}

/** Notification: seller identity verification (Yoti) succeeded. */
export function sellerVerificationApprovedEmail(opts: {
  username?: string | null;
  dashboardUrl: string;
}): { subject: string; html: string } {
  const greeting = opts.username ? `Hi ${opts.username},` : 'Hi there,';
  return {
    subject: `Your seller verification is approved`,
    html: wrap('Seller Verification Approved', `
      <h2 style="font-size:20px;margin:24px 0 8px;">You're verified — welcome aboard.</h2>
      <p style="color:#9ca3af;margin:0 0 12px;">${greeting}</p>
      <p style="color:#9ca3af;margin:0 0 16px;">Your identity check came back clean. Seller tools are now unlocked on your account — you can list items, accept bids, and receive payouts.</p>
      ${btn(opts.dashboardUrl, 'Open Seller Dashboard')}
    `),
  };
}

/** Notification: seller identity verification (Yoti) was rejected. */
export function sellerVerificationRejectedEmail(opts: {
  username?: string | null;
  rejectionReason?: string | null;
  supportUrl: string;
}): { subject: string; html: string } {
  const greeting = opts.username ? `Hi ${opts.username},` : 'Hi there,';
  const reasonBlock = opts.rejectionReason
    ? `<p style="color:#9ca3af;margin:0 0 4px;">Reason: <strong style="color:#e5e7eb;">${opts.rejectionReason}</strong></p>`
    : '';
  return {
    subject: `Action needed: seller verification could not be completed`,
    html: wrap('Seller Verification — Action Needed', `
      <h2 style="font-size:20px;margin:24px 0 8px;">We weren't able to verify your identity.</h2>
      <p style="color:#9ca3af;margin:0 0 12px;">${greeting}</p>
      <p style="color:#9ca3af;margin:0 0 16px;">Our identity provider could not complete the check. This is usually a document-quality issue (blurry image, glare, expired ID) and is fixable on a retry.</p>
      ${reasonBlock}
      <p style="color:#9ca3af;margin:16px 0;">If you believe this was an error, our support team can review your case.</p>
      ${btn(opts.supportUrl, 'Contact Support')}
    `),
  };
}
