/** Where Stripe sends the buyer back after a redirect-based payment method (read by MyTokensPage). */
export const transferReturnUrl = (transferId: string): string =>
  `${window.location.origin}/tokens?transfer=${encodeURIComponent(transferId)}`;
