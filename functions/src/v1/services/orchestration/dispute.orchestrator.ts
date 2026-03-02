import { firestore } from "firebase-admin";
import { DisputesRepo } from "../../repos/disputes.repo";
import {
  Dispute,
  DisputeActorSchema,
  DisputeReasonCodeSchema,
  DisputeSchema,
} from "../../schemas/domain/dispute.schema";

type OrchLogBase = {
  requestId: string;
  op: string;
  aggregate: "dispute";
  outcome: "attempt" | "success" | "error";
  durationMs: number;
  [k: string]: unknown;
};

function logInfo(event: string, payload: Record<string, unknown>) {
  console.log(`[orch][info] ${event}`, payload);
}

function logError(event: string, payload: Record<string, unknown>) {
  console.error(`[orch][error] ${event}`, payload);
}

export type DisputeCreateParams = {
  requestId: string;
  disputeId: string;
  listingId: string;
  auctionId: string;
  settlementId: string | null;
  payoutId: string | null;
  buyerUid: string;
  sellerUid: string;
  reasonCode: typeof DisputeReasonCodeSchema._type;
  reasonText?: string | null;
  actor: typeof DisputeActorSchema._type;
  note?: string;
};

export class DisputeOrchestrator {
  private readonly repo: DisputesRepo;

  constructor(db: firestore.Firestore) {
    this.repo = new DisputesRepo(db);
  }

  async createDispute(params: DisputeCreateParams): Promise<{ dispute: Dispute }> {
    const started = Date.now();
    const op = "createDispute";

    logInfo(`orch.${op}.attempt`, {
      requestId: params.requestId,
      op,
      aggregate: "dispute",
      outcome: "attempt",
      durationMs: 0,
    } satisfies OrchLogBase);

    try {
      const nowMs = Date.now();
      const dispute: Dispute = DisputeSchema.parse({
        id: params.disputeId,
        listingId: params.listingId,
        auctionId: params.auctionId,
        settlementId: params.settlementId ?? null,
        payoutId: params.payoutId ?? null,
        buyerUid: params.buyerUid,
        sellerUid: params.sellerUid,
        reasonCode: params.reasonCode,
        reasonText: params.reasonText ?? null,
        status: "OPEN",
        outcomeKind: null,
        hold: { status: "NONE", placedAtMs: null, releasedAtMs: null },
        refund: {
          status: "NONE",
          currency: "CAD",
          amountCents: null,
          intentAtMs: null,
          updatedAtMs: null,
        },
        chargeback: {
          status: "NONE",
          amountCents: null,
          reportedAtMs: null,
          updatedAtMs: null,
        },
        evidence: [],
        events: [
          {
            type: "CREATED",
            atMs: nowMs,
            actor: params.actor,
            note: params.note,
          },
        ],
        version: 0,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        idempotency: {},
      });

      const res = await this.repo.createIfAbsent({
        dispute,
        requestId: params.requestId,
      });

      logInfo(`orch.${op}.success`, {
        requestId: params.requestId,
        op,
        aggregate: "dispute",
        outcome: "success",
        durationMs: Date.now() - started,
        disputeId: res.dispute.id,
        created: res.created,
      } satisfies OrchLogBase);

      return { dispute: res.dispute };
    } catch (err: any) {
      logError(`orch.${op}.error`, {
        requestId: params.requestId,
        op,
        aggregate: "dispute",
        outcome: "error",
        durationMs: Date.now() - started,
        error: String(err?.message ?? err),
      } satisfies OrchLogBase);
      throw err;
    }
  }

  async placeHold(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    actor: typeof DisputeActorSchema._type;
    note?: string;
  }): Promise<{ dispute: Dispute }> {
    return await this.mutateStatus({
      requestId: params.requestId,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      op: "placeHold",
      apply: (cur, nowMs) => {
        if (cur.status === "RESOLVED" || cur.status === "CANCELED") {
          throw new Error("DISPUTE_TERMINAL");
        }
        const next: Dispute = {
          ...cur,
          hold: {
            status: "PLACED",
            placedAtMs: nowMs,
            releasedAtMs: null,
            note: params.note,
          },
          updatedAtMs: nowMs,
          version: cur.version + 1,
          events: [
            ...cur.events,
            { type: "HOLD_PLACED", atMs: nowMs, actor: params.actor, note: params.note },
          ],
        };
        return next;
      },
    });
  }

  async releaseHold(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    actor: typeof DisputeActorSchema._type;
    note?: string;
  }): Promise<{ dispute: Dispute }> {
    return await this.mutateStatus({
      requestId: params.requestId,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      op: "releaseHold",
      apply: (cur, nowMs) => {
        if (cur.status === "RESOLVED" || cur.status === "CANCELED") {
          throw new Error("DISPUTE_TERMINAL");
        }
        const next: Dispute = {
          ...cur,
          hold: {
            status: "RELEASED",
            placedAtMs: cur.hold.placedAtMs,
            releasedAtMs: nowMs,
            note: params.note,
          },
          updatedAtMs: nowMs,
          version: cur.version + 1,
          events: [
            ...cur.events,
            { type: "HOLD_RELEASED", atMs: nowMs, actor: params.actor, note: params.note },
          ],
        };
        return next;
      },
    });
  }

  async recordRefundIntent(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    actor: typeof DisputeActorSchema._type;
    amountCents: number;
    currency: string;
    note?: string;
  }): Promise<{ dispute: Dispute }> {
    return await this.mutateStatus({
      requestId: params.requestId,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      op: "recordRefundIntent",
      apply: (cur, nowMs) => {
        if (cur.status === "RESOLVED" || cur.status === "CANCELED") {
          throw new Error("DISPUTE_TERMINAL");
        }
        const next: Dispute = {
          ...cur,
          refund: {
            ...cur.refund,
            status: "INTENT_RECORDED",
            amountCents: params.amountCents,
            currency: params.currency,
            intentAtMs: nowMs,
            updatedAtMs: nowMs,
            note: params.note,
          },
          updatedAtMs: nowMs,
          version: cur.version + 1,
          events: [
            ...cur.events,
            { type: "REFUND_INTENT_RECORDED", atMs: nowMs, actor: params.actor, note: params.note },
          ],
        };
        return next;
      },
    });
  }

  async setRefundStatus(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    actor: typeof DisputeActorSchema._type;
    status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
    note?: string;
  }): Promise<{ dispute: Dispute }> {
    return await this.mutateStatus({
      requestId: params.requestId,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      op: "setRefundStatus",
      apply: (cur, nowMs) => {
        if (cur.status === "RESOLVED" || cur.status === "CANCELED") {
          throw new Error("DISPUTE_TERMINAL");
        }
        const next: Dispute = {
          ...cur,
          refund: {
            ...cur.refund,
            status: params.status,
            updatedAtMs: nowMs,
            note: params.note,
          },
          updatedAtMs: nowMs,
          version: cur.version + 1,
          events: [
            ...cur.events,
            { type: "REFUND_STATUS_CHANGED", atMs: nowMs, actor: params.actor, note: params.note },
          ],
        };
        return next;
      },
    });
  }

  async reportChargeback(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    actor: typeof DisputeActorSchema._type;
    amountCents: number;
    note?: string;
    externalRef?: { system: string; id: string } | null;
  }): Promise<{ dispute: Dispute }> {
    return await this.mutateStatus({
      requestId: params.requestId,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      op: "reportChargeback",
      apply: (cur, nowMs) => {
        if (cur.status === "RESOLVED" || cur.status === "CANCELED") {
          throw new Error("DISPUTE_TERMINAL");
        }
        const next: Dispute = {
          ...cur,
          chargeback: {
            ...cur.chargeback,
            status: "REPORTED",
            amountCents: params.amountCents,
            reportedAtMs: nowMs,
            updatedAtMs: nowMs,
            note: params.note,
            externalRef: params.externalRef ?? cur.chargeback.externalRef ?? null,
          },
          updatedAtMs: nowMs,
          version: cur.version + 1,
          events: [
            ...cur.events,
            { type: "CHARGEBACK_REPORTED", atMs: nowMs, actor: params.actor, note: params.note },
          ],
        };
        return next;
      },
    });
  }

  async setChargebackStatus(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    actor: typeof DisputeActorSchema._type;
    status: "WON" | "LOST";
    note?: string;
  }): Promise<{ dispute: Dispute }> {
    return await this.mutateStatus({
      requestId: params.requestId,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      op: "setChargebackStatus",
      apply: (cur, nowMs) => {
        if (cur.status === "RESOLVED" || cur.status === "CANCELED") {
          throw new Error("DISPUTE_TERMINAL");
        }
        const next: Dispute = {
          ...cur,
          chargeback: {
            ...cur.chargeback,
            status: params.status,
            updatedAtMs: nowMs,
            note: params.note,
          },
          updatedAtMs: nowMs,
          version: cur.version + 1,
          events: [
            ...cur.events,
            { type: "CHARGEBACK_STATUS_CHANGED", atMs: nowMs, actor: params.actor, note: params.note },
          ],
        };
        return next;
      },
    });
  }

  async resolveDispute(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    actor: typeof DisputeActorSchema._type;
    outcomeKind:
      | "NO_ACTION"
      | "REFUND_ISSUED"
      | "PARTIAL_REFUND"
      | "CHARGEBACK_WON"
      | "CHARGEBACK_LOST";
    note?: string;
  }): Promise<{ dispute: Dispute }> {
    return await this.mutateStatus({
      requestId: params.requestId,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      op: "resolveDispute",
      apply: (cur, nowMs) => {
        if (cur.status === "RESOLVED" || cur.status === "CANCELED") {
          return cur;
        }
        const next: Dispute = {
          ...cur,
          status: "RESOLVED",
          outcomeKind: params.outcomeKind,
          updatedAtMs: nowMs,
          version: cur.version + 1,
          events: [
            ...cur.events,
            { type: "RESOLVED", atMs: nowMs, actor: params.actor, note: params.note },
          ],
        };
        return next;
      },
    });
  }

  async cancelDispute(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    actor: typeof DisputeActorSchema._type;
    note?: string;
  }): Promise<{ dispute: Dispute }> {
    return await this.mutateStatus({
      requestId: params.requestId,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      op: "cancelDispute",
      apply: (cur, nowMs) => {
        if (cur.status === "RESOLVED" || cur.status === "CANCELED") {
          return cur;
        }
        const next: Dispute = {
          ...cur,
          status: "CANCELED",
          updatedAtMs: nowMs,
          version: cur.version + 1,
          events: [
            ...cur.events,
            { type: "CANCELED", atMs: nowMs, actor: params.actor, note: params.note },
          ],
        };
        return next;
      },
    });
  }

  async releasePayoutIfNoActiveDisputeHold(params: {
    requestId: string;
    payoutId: string;
    release: () => Promise<unknown>;
  }): Promise<{ ok: boolean; blocked: boolean; blockedByDisputeId: string | null }> {
    const started = Date.now();
    const op = "releasePayoutIfNoActiveDisputeHold";

    logInfo(`orch.${op}.attempt`, {
      requestId: params.requestId,
      op,
      aggregate: "dispute",
      outcome: "attempt",
      durationMs: 0,
      payoutId: params.payoutId,
    } satisfies OrchLogBase);

    try {
      const { blocked, disputeId } = await this.repo.findActiveHoldByPayoutId(params.payoutId);

      if (blocked) {
        logInfo(`orch.${op}.success`, {
          requestId: params.requestId,
          op,
          aggregate: "dispute",
          outcome: "success",
          durationMs: Date.now() - started,
          payoutId: params.payoutId,
          blocked: true,
          disputeId,
        } satisfies OrchLogBase);

        return { ok: true, blocked: true, blockedByDisputeId: disputeId };
      }

      await params.release();

      logInfo(`orch.${op}.success`, {
        requestId: params.requestId,
        op,
        aggregate: "dispute",
        outcome: "success",
        durationMs: Date.now() - started,
        payoutId: params.payoutId,
        blocked: false,
      } satisfies OrchLogBase);

      return { ok: true, blocked: false, blockedByDisputeId: null };
    } catch (err: any) {
      logError(`orch.${op}.error`, {
        requestId: params.requestId,
        op,
        aggregate: "dispute",
        outcome: "error",
        durationMs: Date.now() - started,
        payoutId: params.payoutId,
        error: String(err?.message ?? err),
      } satisfies OrchLogBase);
      throw err;
    }
  }

  private async mutateStatus(params: {
    requestId: string;
    disputeId: string;
    expectedVersion: number;
    op: string;
    apply: (cur: Dispute, nowMs: number) => Dispute;
  }): Promise<{ dispute: Dispute }> {
    const started = Date.now();

    logInfo(`orch.${params.op}.attempt`, {
      requestId: params.requestId,
      op: params.op,
      aggregate: "dispute",
      outcome: "attempt",
      durationMs: 0,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
    } satisfies OrchLogBase);

    try {
      const dispute = await this.repo.mutate({
        disputeId: params.disputeId,
        requestId: params.requestId,
        expectedVersion: params.expectedVersion,
        op: params.op,
        apply: params.apply,
      });

      logInfo(`orch.${params.op}.success`, {
        requestId: params.requestId,
        op: params.op,
        aggregate: "dispute",
        outcome: "success",
        durationMs: Date.now() - started,
        disputeId: dispute.id,
        expectedVersion: params.expectedVersion,
        version: dispute.version,
      } satisfies OrchLogBase);

      return { dispute };
    } catch (err: any) {
      logError(`orch.${params.op}.error`, {
        requestId: params.requestId,
        op: params.op,
        aggregate: "dispute",
        outcome: "error",
        durationMs: Date.now() - started,
        disputeId: params.disputeId,
        expectedVersion: params.expectedVersion,
        error: String(err?.message ?? err),
      } satisfies OrchLogBase);
      throw err;
    }
  }
}
