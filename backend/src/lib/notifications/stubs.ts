/**
 * Notification stubs — Module 16 placeholder
 *
 * These functions will be replaced with real email/push notification
 * implementations in Module 16. For now they log intent only.
 */

export async function notifyPayoutCompleted(
  sellerId: string,
  payoutId: string,
  netPayoutCents: number,
): Promise<void> {
  console.log('[notifications] notifyPayoutCompleted (stub)', {
    sellerId,
    payoutId,
    netPayoutCents,
  });
}

export async function notifyDisputeOpened(
  settlementId: string,
  buyerId: string,
  sellerId: string,
): Promise<void> {
  console.log('[notifications] notifyDisputeOpened (stub)', {
    settlementId,
    buyerId,
    sellerId,
  });
}

export async function notifyEscrowReleased(
  settlementId: string,
  sellerId: string,
): Promise<void> {
  console.log('[notifications] notifyEscrowReleased (stub)', {
    settlementId,
    sellerId,
  });
}
