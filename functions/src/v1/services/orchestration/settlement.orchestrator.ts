import { db } from "../../lib/firebaseAdmin";
import { createSettlementIfAbsent, getSettlement, updateSettlementTxn } from "../../repos/settlements.repo";
import { SettlementPersistSchema } from "../../schemas/domain/settlement.schema";
import type { SettlementAction, SettlementPersist } from "../../schemas/domain/settlement.schema";

import { StripePaymentProvider } from "../../payments/stripe/stripe.provider";
import { mapStripeError } from "../../payments/stripe/stripe.errors";

type OrchResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

function nowMs() {
  return Date.now();
}

function err(code: string, message: string): OrchResult<never> {
  return { ok: false, error: { code, message } };
}

function logInfo(event: string, payload: Record<string, any>) {
  console.log(`[orch][info] ${event}`, payload);
}

function logWarn(event: string, payload: Record<string, any>) {
  console.log(`[orch][warn] ${event}`, payload);
}

function auctionStateCurrentRef(listingId: string, auctionId: string) {
  return db.doc(`listings/${listingId}/auctions/${auctionId}/state/current`);
}

function listingRef(listingId: string) {
  return db.doc(`listings/${listingId}`);
}

function actionPayV1Id() {
  return "action_pay_v1";
}

async function readAuctionStateCurrent(listingId: string, auctionId: string): Promise<OrchResult<any>> {
  try {
    const snap = await auctionStateCurrentRef(listingId, auctionId).get();
    if (!snap.exists) return err("AUCTION_STATE_NOT_FOUND", "AuctionState current doc not found");
    return { ok: true, value: snap.data() ?? {} };
  } catch (e: any) {
    return err("AUCTION_STATE_READ_FAILED", e?.message ?? "Failed to read AuctionState");
  }
}

async function readListing(listingId: string): Promise<OrchResult<any>> {
  try {
    const snap = await listingRef(listingId).get();
    if (!snap.exists) return err("LISTING_NOT_FOUND", "Listing doc not found");
    return { ok: true, value: snap.data() ?? {} };
  } catch (e: any) {
    return err("LISTING_READ_FAILED", e?.message ?? "Failed to read listing");
  }
}

function buildSettlementFromClose(opts: {
  listingId: string;
  auctionId: string;
  close: any;
  listing: any;
  nowMs: number;
}): OrchResult<SettlementPersist> {
  const { listingId, auctionId, close, listing, nowMs } = opts;

  const reason = String(close?.reason ?? "UNKNOWN");
  const winnerUid: string | null = close?.winnerUid ?? null;

  const isNoBids = reason === "NO_BIDS" || winnerUid === null;

  if (isNoBids) {
    const settlement: SettlementPersist = SettlementPersistSchema.parse({
      id: auctionId,
      listingId,
      auctionId,
      status: "VOIDED",
      version: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      outcomeKind: "NO_BIDS",
      buyerUid: null,
      sellerUid: null,
      amountCents: null,
      currency: null,
      close: {
        closedAtMs: close.closedAtMs,
        reason,
        winnerUid: null,
        winningPriceCents: close.winningPriceCents,
      },
      actions: [],
      lastRequest: null,
      lastFailure: null,
    });

    return { ok: true, value: settlement };
  }

  const sellerUid: string | null = typeof listing?.sellerUid === "string" ? listing.sellerUid : null;
  const currency: string | null =
    typeof listing?.pricing?.currency === "string" ? listing.pricing.currency : null;

  if (!sellerUid || !currency) {
    return err("LISTING_FIELDS_MISSING", "Listing missing sellerUid or pricing.currency");
  }

  const actions: SettlementAction[] = [
    {
      id: actionPayV1Id(),
      type: "COLLECT_AND_PAY",
      status: "PENDING",
      attempts: [],
    },
  ];

  const settlement: SettlementPersist = SettlementPersistSchema.parse({
    id: auctionId,
    listingId,
    auctionId,
    status: "ACTION_REQUIRED",
    version: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    outcomeKind: "PAYMENT_REQUIRED",
    buyerUid: winnerUid,
    sellerUid,
    amountCents: close.winningPriceCents,
    currency,
    close: {
      closedAtMs: close.closedAtMs,
      reason,
      winnerUid,
      winningPriceCents: close.winningPriceCents,
    },
    actions,
    lastRequest: null,
    lastFailure: null,
  });

  return { ok: true, value: settlement };
}

export async function orchCreateSettlementFromAuctionClose(input: {
  requestId: string;
  listingId: string;
  auctionId: string;
}): Promise<OrchResult<{ settlement: SettlementPersist }>> {
  const t0 = nowMs();
  const { requestId, listingId, auctionId } = input;

  logInfo("orch.createSettlement.attempt", {
    requestId,
    op: "createSettlement",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "attempt",
    durationMs: 0,
  });

  const stateRes = await readAuctionStateCurrent(listingId, auctionId);
  if (!stateRes.ok) {
    logWarn("orch.createSettlement.failed", {
      requestId,
      op: "createSettlement",
      aggregate: "settlement",
      listingId,
      auctionId,
      outcome: "failed",
      durationMs: nowMs() - t0,
    });
    return err(stateRes.error.code, stateRes.error.message);
  }

  const close = stateRes.value?.close;
  if (!close) return err("AUCTION_NOT_CLOSED", "AuctionState current missing close");

  const listingRes = await readListing(listingId);
  if (!listingRes.ok) return err(listingRes.error.code, listingRes.error.message);

  const built = buildSettlementFromClose({
    listingId,
    auctionId,
    close,
    listing: listingRes.value,
    nowMs: nowMs(),
  });

  if (!built.ok) return err(built.error.code, built.error.message);

  const createRes = await createSettlementIfAbsent(built.value);
  if (!createRes.ok) return err(createRes.error.code, createRes.error.message);

  logInfo("orch.createSettlement.success", {
    requestId,
    op: "createSettlement",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "success",
    durationMs: nowMs() - t0,
  });

  return { ok: true, value: { settlement: createRes.value } };
}

export async function orchGetSettlement(input: {
  requestId: string;
  settlementId: string;
  listingId: string;
  auctionId: string;
}): Promise<OrchResult<{ settlement: SettlementPersist | null }>> {
  const t0 = nowMs();
  const { requestId, settlementId, listingId, auctionId } = input;

  logInfo("orch.getSettlement.attempt", {
    requestId,
    op: "getSettlement",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "attempt",
    durationMs: 0,
  });

  const res = await getSettlement(settlementId);
  if (!res.ok) return err(res.error.code, res.error.message);

  logInfo("orch.getSettlement.success", {
    requestId,
    op: "getSettlement",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "success",
    durationMs: nowMs() - t0,
  });

  return { ok: true, value: { settlement: res.value } };
}

export async function orchStartSettlement(input: {
  requestId: string;
  settlementId: string;
  listingId: string;
  auctionId: string;
  expectedVersion?: number;
}): Promise<OrchResult<{ settlement: SettlementPersist }>> {
  const t0 = nowMs();
  const { requestId, settlementId, listingId, auctionId, expectedVersion } = input;

  logInfo("orch.startSettlement.attempt", {
    requestId,
    op: "startSettlement",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "attempt",
    durationMs: 0,
    expectedVersion,
  });

  const upd = await updateSettlementTxn({
    settlementId,
    expectedVersion,
    nowMs: nowMs(),
    mutate: (cur) => {
      if (cur.lastRequest?.op === "startSettlement" && cur.lastRequest.requestId === requestId) return cur;
      if (cur.status === "VOIDED" || cur.status === "SETTLED") return cur;

      const actions: SettlementAction[] = cur.actions.map((a) => {
        if (a.id !== actionPayV1Id()) return a;
        if (a.status === "PENDING" || a.status === "FAILED") {
          return { ...a, status: "RUNNING" };
        }
        return a;
      });

      return {
        ...cur,
        status: "IN_PROGRESS",
        version: cur.version + 1,
        updatedAtMs: nowMs(),
        actions,
        lastRequest: { op: "startSettlement", requestId, atMs: nowMs() },
      };
    },
  });

  if (!upd.ok) return err(upd.error.code, upd.error.message);

  logInfo("orch.startSettlement.success", {
    requestId,
    op: "startSettlement",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "success",
    durationMs: nowMs() - t0,
    expectedVersion,
  });

  return { ok: true, value: { settlement: upd.value } };
}

export async function orchRecordSettlementFailure(input: {
  requestId: string;
  settlementId: string;
  listingId: string;
  auctionId: string;
  expectedVersion?: number;
  code?: string | null;
  message?: string | null;
  retryable: boolean;
}): Promise<OrchResult<{ settlement: SettlementPersist }>> {
  const t0 = nowMs();
  const { requestId, settlementId, listingId, auctionId, expectedVersion, code, message, retryable } = input;

  logInfo("orch.recordSettlementFailure.attempt", {
    requestId,
    op: "recordSettlementFailure",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "attempt",
    durationMs: 0,
    expectedVersion,
  });

  const upd = await updateSettlementTxn({
    settlementId,
    expectedVersion,
    nowMs: nowMs(),
    mutate: (cur) => {
      if (cur.lastRequest?.op === "recordSettlementFailure" && cur.lastRequest.requestId === requestId) return cur;
      if (cur.status === "VOIDED" || cur.status === "SETTLED") return cur;

      const status = retryable ? "FAILED_RETRYABLE" : "FAILED_TERMINAL";

      const actions: SettlementAction[] = cur.actions.map((a) => {
        if (a.id !== actionPayV1Id()) return a;
        const attempts = [...a.attempts, { atMs: nowMs(), ok: false, code: code ?? null, message: message ?? null }];
        return { ...a, status: "FAILED", attempts };
      });

      return {
        ...cur,
        status,
        version: cur.version + 1,
        updatedAtMs: nowMs(),
        actions,
        lastFailure: { atMs: nowMs(), code: code ?? null, message: message ?? null, retryable },
        lastRequest: { op: "recordSettlementFailure", requestId, atMs: nowMs() },
      };
    },
  });

  if (!upd.ok) return err(upd.error.code, upd.error.message);

  logInfo("orch.recordSettlementFailure.success", {
    requestId,
    op: "recordSettlementFailure",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "success",
    durationMs: nowMs() - t0,
    expectedVersion,
  });

  return { ok: true, value: { settlement: upd.value } };
}

export async function orchMarkSettlementSettled(input: {
  requestId: string;
  settlementId: string;
  listingId: string;
  auctionId: string;
  expectedVersion?: number;
}): Promise<OrchResult<{ settlement: SettlementPersist }>> {
  const t0 = nowMs();
  const { requestId, settlementId, listingId, auctionId, expectedVersion } = input;

  logInfo("orch.markSettlementSettled.attempt", {
    requestId,
    op: "markSettlementSettled",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "attempt",
    durationMs: 0,
    expectedVersion,
  });

  const upd = await updateSettlementTxn({
    settlementId,
    expectedVersion,
    nowMs: nowMs(),
    mutate: (cur) => {
      if (cur.lastRequest?.op === "markSettlementSettled" && cur.lastRequest.requestId === requestId) return cur;
      if (cur.status === "VOIDED" || cur.status === "SETTLED") return cur;

      const actions: SettlementAction[] = cur.actions.map((a) => {
        if (a.id !== actionPayV1Id()) return a;
        if (a.status === "SUCCEEDED") return a;
        const attempts = [...a.attempts, { atMs: nowMs(), ok: true, code: null, message: null }];
        return { ...a, status: "SUCCEEDED", attempts };
      });

      return {
        ...cur,
        status: "SETTLED",
        version: cur.version + 1,
        updatedAtMs: nowMs(),
        actions,
        lastFailure: null,
        lastRequest: { op: "markSettlementSettled", requestId, atMs: nowMs() },
      };
    },
  });

  if (!upd.ok) return err(upd.error.code, upd.error.message);

  logInfo("orch.markSettlementSettled.success", {
    requestId,
    op: "markSettlementSettled",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "success",
    durationMs: nowMs() - t0,
    expectedVersion,
  });

  return { ok: true, value: { settlement: upd.value } };
}

export async function orchCollectAndPay(input: {
  requestId: string;
  settlementId: string;
  listingId: string;
  auctionId: string;
  expectedVersion?: number;
  paymentMethodRef: string;
  customerRef?: string;
}): Promise<OrchResult<{ settlement: SettlementPersist }>> {
  const t0 = nowMs();
  const { requestId, settlementId, listingId, auctionId, expectedVersion, paymentMethodRef, customerRef } = input;

  logInfo("orch.collectAndPay.attempt", {
    requestId,
    op: "collectAndPay",
    aggregate: "settlement",
    listingId,
    auctionId,
    outcome: "attempt",
    durationMs: 0,
    expectedVersion,
  });

  const curRes = await getSettlement(settlementId);
  if (!curRes.ok) return err(curRes.error.code, curRes.error.message);
  const settlement = curRes.value;
  if (!settlement) return err("NOT_FOUND", "Settlement not found");

  if (settlement.outcomeKind !== "PAYMENT_REQUIRED") {
    return err("PRECONDITION_FAILED", "Settlement outcomeKind is not PAYMENT_REQUIRED");
  }

  const payAction = settlement.actions.find((a) => a.id === actionPayV1Id());
  if (!payAction || payAction.type !== "COLLECT_AND_PAY") {
    return err("PRECONDITION_FAILED", "Settlement missing COLLECT_AND_PAY action");
  }

  if (settlement.status === "VOIDED" || settlement.status === "SETTLED") {
    return err("PRECONDITION_FAILED", `Settlement not payable in status ${settlement.status}`);
  }

  if (!settlement.buyerUid) return err("PRECONDITION_FAILED", "Settlement buyerUid missing");
  if (!settlement.amountCents) return err("PRECONDITION_FAILED", "Settlement amountCents missing");
  if (!settlement.currency) return err("PRECONDITION_FAILED", "Settlement currency missing");

  const startRes = await orchStartSettlement({
    requestId,
    settlementId,
    listingId,
    auctionId,
    expectedVersion,
  });

  if (!startRes.ok) {
    logWarn("orch.collectAndPay.failed", {
      requestId,
      op: "collectAndPay",
      aggregate: "settlement",
      listingId,
      auctionId,
      outcome: "failed",
      durationMs: nowMs() - t0,
      expectedVersion,
    });
    return err(startRes.error.code, startRes.error.message);
  }

  const started = startRes.value.settlement;

  try {
    const provider = new StripePaymentProvider();

    await provider.authorizeAndCapture({
      requestId,
      settlementId,
      amountCents: started.amountCents!,
      currency: started.currency!,
      buyerUid: started.buyerUid!,
      paymentMethodRef,
      customerRef,
    });

    const settledRes = await orchMarkSettlementSettled({
      requestId,
      settlementId,
      listingId,
      auctionId,
      expectedVersion: started.version,
    });

    if (!settledRes.ok) return err(settledRes.error.code, settledRes.error.message);

    logInfo("orch.collectAndPay.success", {
      requestId,
      op: "collectAndPay",
      aggregate: "settlement",
      listingId,
      auctionId,
      outcome: "success",
      durationMs: nowMs() - t0,
      expectedVersion,
    });

    return { ok: true, value: { settlement: settledRes.value.settlement } };
  } catch (e: any) {
    const failure = mapStripeError(e);

    const failRes = await orchRecordSettlementFailure({
      requestId,
      settlementId,
      listingId,
      auctionId,
      expectedVersion: started.version,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    });

    if (!failRes.ok) return err(failRes.error.code, failRes.error.message);

    logWarn("orch.collectAndPay.failed", {
      requestId,
      op: "collectAndPay",
      aggregate: "settlement",
      listingId,
      auctionId,
      outcome: "failed",
      durationMs: nowMs() - t0,
      expectedVersion,
    });

    return err("PAYMENT_FAILED", failure.message);
  }
}
