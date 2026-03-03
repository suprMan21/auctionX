/**
 * @deprecated Module 16 — These stubs have been superseded by notificationService.ts.
 * All controllers now import from '../lib/notifications/notificationService' directly.
 * This file is kept to avoid breaking any future module imports but should not be
 * used in new code.
 *
 * Notification stubs — Module 16 placeholder
 * Original implementations: see notificationService.ts
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
