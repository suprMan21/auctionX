import { orchEvent, OrchestrationLogger } from "./orchestration.logging";
import { getSettlement } from "../../repos/settlements.repo";
import { createPayoutIfAbsent, getPayout, updatePayoutTxn } from "../../repos/payouts.repo";
import { PayoutPersist } from "../../schemas/domain/payout.schema";
import { calcFeeQuote, calcNetAmountCents, calcTaxQuote } from "../payouts/payout.calc";

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

function err(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

function now() {
  return Date.now();
}

function getNumberEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

function calcQuotesFromGross(grossAmountCents: number) {
  const platformFeeBps = getNumberEnv("PAYOUT_PLATFORM_FEE_BPS", 0);
  const platformFeeFixedCents = getNumberEnv("PAYOUT_PLATFORM_FEE_FIXED_CENTS", 0);
  const sellerWithholdingBps = getNumberEnv("PAYOUT_SELLER_WITHHOLDING_BPS", 0);
  const platformFeeTaxBps = getNumberEnv("PAYOUT_PLATFORM_FEE_TAX_BPS", 0);

  const feeRulesetVersion = process.env.PAYOUT_FEE_RULESET_VERSION || "FEE_V1";
  const taxRulesetVersion = process.env.PAYOUT_TAX_RULESET_VERSION || "TAX_V1";

  const fee = calcFeeQuote({
    grossAmountCents,
    platformFeeBps,
    platformFeeFixedCents,
    rulesetVersion: feeRulesetVersion,
  });

  const tax = calcTaxQuote({
    grossAmountCents,
    platformFeeCents: fee.platformFeeCents,
    jurisdictionCode: process.env.PAYOUT_TAX_JURISDICTION_CODE || null,
    sellerWithholdingBps,
    platformFeeTaxBps,
    rulesetVersion: taxRulesetVersion,
  });

  const netAmountCents = calcNetAmountCents({
    grossAmountCents,
    platformFeeCents: fee.platformFeeCents,
    sellerWithheldCents: tax.sellerWithheldCents,
  });

  return { fee, tax, netAmountCents };
}

export async function createPayoutFromSettlement(deps: {
  logger: OrchestrationLogger;
  requestId: string;
  settlementId: string;
}): Promise<Result<{ payout: PayoutPersist }>> {
  const startedAt = now();
  const op = "createPayoutFromSettlement";
  deps.logger.info(orchEvent(op, "attempt"), {
    requestId: deps.requestId,
    op,
    aggregate: "payout",
    outcome: "attempt",
    durationMs: 0,
  });

  const settlementId = deps.settlementId;
  if (!settlementId) {
    deps.logger.warn(orchEvent(op, "validation_failed"), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: "validation_failed",
      durationMs: now() - startedAt,
      error: { code: "VALIDATION", message: "Missing settlementId" },
    });
    return err("VALIDATION", "Missing settlementId");
  }

  const s = await getSettlement(settlementId);
  if (!s.ok) {
    deps.logger.error(orchEvent(op, "repo_error"), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: "repo_error",
      durationMs: now() - startedAt,
      error: s.error,
    });
    return err(s.error.code, s.error.message);
  }
  if (!s.value) {
    deps.logger.warn(orchEvent(op, "not_found"), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: "not_found",
      durationMs: now() - startedAt,
      error: { code: "NOT_FOUND", message: "Settlement not found" },
    });
    return err("NOT_FOUND", "Settlement not found");
  }

  const settlement = s.value;

  if (settlement.status !== "SETTLED") {
    deps.logger.warn(orchEvent(op, "precondition_failed"), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: "precondition_failed",
      durationMs: now() - startedAt,
      listingId: settlement.listingId,
      auctionId: settlement.auctionId,
      error: { code: "PRECONDITION", message: `Settlement.status must be SETTLED (got ${settlement.status})` },
    });
    return err("PRECONDITION", `Settlement.status must be SETTLED (got ${settlement.status})`);
  }

  if (settlement.outcomeKind !== "PAYMENT_REQUIRED") {
    const payoutId = settlement.id;
    const existing = await getPayout(payoutId);
    if (existing.ok && existing.value) {
      deps.logger.info(orchEvent(op, "noop"), {
        requestId: deps.requestId,
        op,
        aggregate: "payout",
        outcome: "noop",
        durationMs: now() - startedAt,
        listingId: settlement.listingId,
        auctionId: settlement.auctionId,
      });
      return { ok: true, value: { payout: existing.value } };
    }

    const payout: PayoutPersist = {
      id: payoutId,
      settlementId: settlement.id,
      listingId: settlement.listingId,
      auctionId: settlement.auctionId,

      buyerUid: settlement.buyerUid,
      sellerUid: settlement.sellerUid,
      currency: settlement.currency,

      grossAmountCents: settlement.amountCents,
      fee: {
        rulesetVersion: process.env.PAYOUT_FEE_RULESET_VERSION || "FEE_V1",
        platformFeeBps: getNumberEnv("PAYOUT_PLATFORM_FEE_BPS", 0),
        platformFeeFixedCents: getNumberEnv("PAYOUT_PLATFORM_FEE_FIXED_CENTS", 0),
        platformFeeCents: 0,
      },
      tax: {
        rulesetVersion: process.env.PAYOUT_TAX_RULESET_VERSION || "TAX_V1",
        jurisdictionCode: process.env.PAYOUT_TAX_JURISDICTION_CODE || null,
        sellerWithholdingBps: getNumberEnv("PAYOUT_SELLER_WITHHOLDING_BPS", 0),
        sellerWithheldCents: 0,
        platformFeeTaxBps: getNumberEnv("PAYOUT_PLATFORM_FEE_TAX_BPS", 0),
        platformFeeTaxCents: 0,
      },
      netAmountCents: settlement.amountCents,

      status: "VOIDED",
      version: 0,
      createdAtMs: now(),
      updatedAtMs: now(),

      hold: null,
      release: null,

      lastRequest: { op, requestId: deps.requestId, atMs: now() },
      lastFailure: null,
    };

    const created = await createPayoutIfAbsent(payout);
    if (!created.ok) return err(created.error.code, created.error.message);

    deps.logger.info(orchEvent(op, "success"), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: "success",
      durationMs: now() - startedAt,
      listingId: settlement.listingId,
      auctionId: settlement.auctionId,
    });
    return { ok: true, value: { payout: created.value } };
  }

  if (settlement.amountCents === null || settlement.currency === null || settlement.sellerUid === null) {
    deps.logger.warn(orchEvent(op, "precondition_failed"), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: "precondition_failed",
      durationMs: now() - startedAt,
      listingId: settlement.listingId,
      auctionId: settlement.auctionId,
      error: { code: "PRECONDITION", message: "Settlement missing amount/currency/sellerUid" },
    });
    return err("PRECONDITION", "Settlement missing amount/currency/sellerUid");
  }

  const payoutId = settlement.id;

  const { fee, tax, netAmountCents } = calcQuotesFromGross(settlement.amountCents);

  const payout: PayoutPersist = {
    id: payoutId,
    settlementId: settlement.id,
    listingId: settlement.listingId,
    auctionId: settlement.auctionId,

    buyerUid: settlement.buyerUid,
    sellerUid: settlement.sellerUid,
    currency: settlement.currency,

    grossAmountCents: settlement.amountCents,
    fee,
    tax,
    netAmountCents,

    status: "READY",
    version: 0,

    createdAtMs: now(),
    updatedAtMs: now(),

    hold: null,
    release: null,

    lastRequest: { op, requestId: deps.requestId, atMs: now() },
    lastFailure: null,
  };

  const created = await createPayoutIfAbsent(payout);
  if (!created.ok) {
    deps.logger.error(orchEvent(op, "repo_error"), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: "repo_error",
      durationMs: now() - startedAt,
      error: created.error,
    });
    return err(created.error.code, created.error.message);
  }

  deps.logger.info(orchEvent(op, "success"), {
    requestId: deps.requestId,
    op,
    aggregate: "payout",
    outcome: "success",
    durationMs: now() - startedAt,
    listingId: settlement.listingId,
    auctionId: settlement.auctionId,
  });

  return { ok: true, value: { payout: created.value } };
}

export async function holdPayout(deps: {
  logger: OrchestrationLogger;
  requestId: string;
  payoutId: string;
  expectedVersion?: number;
  reasonCode: string;
  reasonDetail?: string | null;
}): Promise<Result<{ payout: PayoutPersist }>> {
  const startedAt = now();
  const op = "holdPayout";

  deps.logger.info(orchEvent(op, "attempt"), {
    requestId: deps.requestId,
    op,
    aggregate: "payout",
    outcome: "attempt",
    durationMs: 0,
    expectedVersion: deps.expectedVersion,
  });

  const res = await updatePayoutTxn({
    payoutId: deps.payoutId,
    expectedVersion: deps.expectedVersion,
    nowMs: now(),
    mutate: (cur) => {
      if (cur.lastRequest?.requestId === deps.requestId && cur.lastRequest?.op === op) return cur;
      if (cur.status === "RELEASED") return cur;
      if (cur.status === "VOIDED") return cur;

      const next: PayoutPersist = {
        ...cur,
        status: "ON_HOLD",
        version: cur.version + 1,
        hold: { heldAtMs: now(), reasonCode: deps.reasonCode, reasonDetail: deps.reasonDetail ?? null },
        lastRequest: { op, requestId: deps.requestId, atMs: now() },
        lastFailure: null,
      };
      return next;
    },
  });

  if (!res.ok) {
    const outcome = res.error.code === "CONFLICT" ? "version_conflict" : "repo_error";
    deps.logger.warn(orchEvent(op, outcome as any), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: outcome as any,
      durationMs: now() - startedAt,
      expectedVersion: deps.expectedVersion,
      error: res.error,
    });
    return err(res.error.code, res.error.message);
  }

  deps.logger.info(orchEvent(op, "success"), {
    requestId: deps.requestId,
    op,
    aggregate: "payout",
    outcome: "success",
    durationMs: now() - startedAt,
    expectedVersion: deps.expectedVersion,
    listingId: res.value.listingId,
    auctionId: res.value.auctionId,
  });

  return { ok: true, value: { payout: res.value } };
}

export async function releasePayoutHold(deps: {
  logger: OrchestrationLogger;
  requestId: string;
  payoutId: string;
  expectedVersion?: number;
}): Promise<Result<{ payout: PayoutPersist }>> {
  const startedAt = now();
  const op = "releasePayoutHold";

  deps.logger.info(orchEvent(op, "attempt"), {
    requestId: deps.requestId,
    op,
    aggregate: "payout",
    outcome: "attempt",
    durationMs: 0,
    expectedVersion: deps.expectedVersion,
  });

  const res = await updatePayoutTxn({
    payoutId: deps.payoutId,
    expectedVersion: deps.expectedVersion,
    nowMs: now(),
    mutate: (cur) => {
      if (cur.lastRequest?.requestId === deps.requestId && cur.lastRequest?.op === op) return cur;
      if (cur.status !== "ON_HOLD") return cur;

      const next: PayoutPersist = {
        ...cur,
        status: "READY",
        version: cur.version + 1,
        hold: null,
        lastRequest: { op, requestId: deps.requestId, atMs: now() },
        lastFailure: null,
      };
      return next;
    },
  });

  if (!res.ok) {
    const outcome = res.error.code === "CONFLICT" ? "version_conflict" : "repo_error";
    deps.logger.warn(orchEvent(op, outcome as any), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: outcome as any,
      durationMs: now() - startedAt,
      expectedVersion: deps.expectedVersion,
      error: res.error,
    });
    return err(res.error.code, res.error.message);
  }

  deps.logger.info(orchEvent(op, "success"), {
    requestId: deps.requestId,
    op,
    aggregate: "payout",
    outcome: "success",
    durationMs: now() - startedAt,
    expectedVersion: deps.expectedVersion,
    listingId: res.value.listingId,
    auctionId: res.value.auctionId,
  });

  return { ok: true, value: { payout: res.value } };
}

export async function releasePayout(deps: {
  logger: OrchestrationLogger;
  requestId: string;
  payoutId: string;
  expectedVersion?: number;
}): Promise<Result<{ payout: PayoutPersist }>> {
  const startedAt = now();
  const op = "releasePayout";

  deps.logger.info(orchEvent(op, "attempt"), {
    requestId: deps.requestId,
    op,
    aggregate: "payout",
    outcome: "attempt",
    durationMs: 0,
    expectedVersion: deps.expectedVersion,
  });

  const res = await updatePayoutTxn({
    payoutId: deps.payoutId,
    expectedVersion: deps.expectedVersion,
    nowMs: now(),
    mutate: (cur) => {
      if (cur.lastRequest?.requestId === deps.requestId && cur.lastRequest?.op === op) return cur;

      if (cur.status === "ON_HOLD") return cur;
      if (cur.status === "VOIDED") return cur;
      if (cur.status === "RELEASED") return cur;

      if (cur.status !== "READY" && cur.status !== "FAILED_RETRYABLE") return cur;

      const requestedAtMs = cur.release?.requestedAtMs ?? now();
      const next: PayoutPersist = {
        ...cur,
        status: "RELEASED",
        version: cur.version + 1,
        release: { requestedAtMs, releasedAtMs: now() },
        lastRequest: { op, requestId: deps.requestId, atMs: now() },
        lastFailure: null,
      };
      return next;
    },
  });

  if (!res.ok) {
    const outcome = res.error.code === "CONFLICT" ? "version_conflict" : "repo_error";
    deps.logger.warn(orchEvent(op, outcome as any), {
      requestId: deps.requestId,
      op,
      aggregate: "payout",
      outcome: outcome as any,
      durationMs: now() - startedAt,
      expectedVersion: deps.expectedVersion,
      error: res.error,
    });
    return err(res.error.code, res.error.message);
  }

  deps.logger.info(orchEvent(op, "success"), {
    requestId: deps.requestId,
    op,
    aggregate: "payout",
    outcome: "success",
    durationMs: now() - startedAt,
    expectedVersion: deps.expectedVersion,
    listingId: res.value.listingId,
    auctionId: res.value.auctionId,
  });

  return { ok: true, value: { payout: res.value } };
}
