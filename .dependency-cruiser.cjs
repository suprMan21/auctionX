/**
 * S-ISO1 — code boundary enforcement.
 *
 * The token platform must not depend on the parked marketplace. Shared
 * utilities (auth, Supabase clients, errors, logger, email, S3, Stripe) stay
 * shared deliberately — the boundary is about domain modules, not plumbing.
 *
 * Run: npm run lint:boundaries  (cruises from backend/, so rule paths are src/-relative)
 */
module.exports = {
  forbidden: [
    {
      name: 'no-token-to-marketplace',
      severity: 'error',
      comment:
        'Token/NFC/verify/ownership code must not import parked marketplace modules (S-ISO1).',
      from: {
        path: '^src/(routes/(nfc|ownership|stripeTokenFeeWebhook)|controllers/(nfc|token|ownership)[A-Za-z]*|services/(nfc|tokens)/|lib/(fx|kms|tokenPricing|ownership|security)/)',
        pathNot: '__tests__',
      },
      to: {
        path: '^src/(routes/(auctions|settlements|delivery|payouts|stripeConnect|search|messages|webhooks|stripeAccountWebhook|sellerVerification)|controllers/(auction|bid|settlement|delivery|payout|search|messaging|stripeConnect|sellerVerification)Controller|routes/admin/(auctions|escrow|disputes|moderation|sellerVerification)|lib/(auction|refundClient))',
      },
    },
    {
      name: 'no-nft-in-token-flows',
      severity: 'error',
      comment:
        'No NFTs, ever (Locked, 2026-09-18). Token flows must never reach the dormant mint or IPFS code.',
      from: {
        path: '^src/(routes/(nfc|ownership)|controllers/(token|ownership)[A-Za-z]*|services/tokens/)',
        pathNot: '__tests__',
      },
      to: {
        path: '^(src/services/nfc/(nftMinting|pinataService)|\\.\\./contracts/)',
      },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|\\.claude/worktrees|dist|coverage)' },
    tsPreCompilationDeps: true,
  },
};
