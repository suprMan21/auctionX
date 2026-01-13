import type { Firestore } from "firebase-admin/firestore";
import { DisputesRepo } from "../../repos/disputes.repo";
import {
  Dispute,
  DisputeChargebackRecordSchema,
  DisputeRefundRecordSchema,
  DisputeSchema,
} from "../../schemas/domain/dispute.schema";
import { orchEvent, type OrchestrationLogger } from "./orchestration.logging";

export type DisputeActor = { kind: "SYSTEM" | "USER" | "ADMIN"; id: string };

export type DisputeDeps = {
  db: Firestore;
  logger: OrchestrationLogger;
  requestId: string;
};

export type CreateDisputeInput = {
  disputeId: string;

  settlementId: string;
  listingId: string;
  auctionId: string;

  buyerUid: string;
  sellerUid: string;

  reasonCode: Dispute["reasonCode"];
  detail?: string;

  actor: DisputeActor;

  payoutImpact?: Dispute["payoutImpact"];
  buyerImpact?: Dispute["buyerImpact"];
  sellerImpact?: Dispute["sellerImpact"];

  nowMs: number;
};

export type UpdateDisputeInput = {
  disputeId: string;
  expectedVersion: number;

  actor: DisputeActor;
  nowMs: number;

  status?: Dispute["status"];
  payoutImpact?: Dispute["payoutImpact"];
  buyerImpact?: Dispute["buyerImpact"];
  sellerImpact?: Dispute["sellerImpact"];
  detail?: string;
  note?: string;
};

export type ResolveDisputeInput = {
  disputeId: string;
  expectedVersion: number;

  actor: DisputeActor;
  nowMs: number;

  resolution: {
    payoutImpact?: Dispute["payoutImpact"];
    buyerImpact?: Dispute["buyerImpact"];
    sellerImpact?: Dispute["sellerImpact"];
    refund?: unknown;
    chargeback?: unknown;
    note?: string;
  };
};

export class DisputeOrchestrator {
  private readonly repo: DisputesRepo;

  constructor(private readonly deps: DisputeDeps) {
    this.repo = new DisputesRepo(deps.db);
  }

  async createDispute(input: CreateDisputeInput): Promise<{ dispute: Dispute }> {
    const op = "createDispute";
    const started = Date.now();

    this.deps.logger.info(orchEvent(op, "attempt"), {
      requestId: this.deps.requestId,
      op,
      aggregate: "dispute",
      outcome: "attempt",
      durationMs: 0,
      auctionId: input.auctionId,
      listingId: input.listingId,
      actorId: input.actor.id,
    });

    const existing = await this.repo.get(input.disputeId);
    if (
      existing &&
      existing.lastMutation?.requestId === this.deps.requestId &&
      existing.lastMutation?.op === "createDispute"
    ) {
      this.deps.logger.info(orchEvent(op, "noop"), {
        requestId: this.deps.requestId,
        op,
        aggregate: "dispute",
        outcome: "noop",
        durationMs: Date.now() - started,
        auctionId: input.auctionId,
        listingId: input.listingId,
        actorId: input.actor.id,
        expectedVersion: existing.version,
      });
      return { dispute: existing };
    }

    const dispute: Dispute = DisputeSchema.parse({
      id: input.disputeId,
      settlementId: input.settlementId,
      listingId: input.listingId,
      auctionId: input.auctionId,
      buyerUid: input.buyerUid,
      sellerUid: input.sellerUid,
      status: "OPEN",
      reasonCode: input.reasonCode,
      detail: input.detail,
      payoutImpact: input.payoutImpact ?? "NONE",
      buyerImpact: input.buyerImpact ?? "NONE",
      sellerImpact: input.sellerImpact ?? "NONE",
      refunds: [],
      chargebacks: [],
      events: [
        {
          atMs: input.nowMs,
          kind: "DISPUTE_CREATED",
          actor: input.actor,
          requestId: this.deps.requestId,
        },
      ],
      lastMutation: { requestId: this.deps.requestId, op: "createDispute", atMs: input.nowMs },
      version: 0,
      createdAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
    });

    const created = await this.repo.createIfAbsent({
      ...dispute,
      version: 0,
      createdAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
    });

    this.deps.logger.info(orchEvent(op, "success"), {
      requestId: this.deps.requestId,
      op,
      aggregate: "dispute",
      outcome: "success",
      durationMs: Date.now() - started,
      auctionId: input.auctionId,
      listingId: input.listingId,
      actorId: input.actor.id,
      expectedVersion: created.version,
    });

    return { dispute: created };
  }

  async updateDispute(input: UpdateDisputeInput): Promise<{ dispute: Dispute }> {
    const op = "updateDispute";
    const started = Date.now();

    this.deps.logger.info(orchEvent(op, "attempt"), {
      requestId: this.deps.requestId,
      op,
      aggregate: "dispute",
      outcome: "attempt",
      durationMs: 0,
      actorId: input.actor.id,
      expectedVersion: input.expectedVersion,
    });

    const updated = await this.repo.updateWithExpectedVersion(input.disputeId, input.expectedVersion, (cur) => {
      if (cur.lastMutation?.requestId === this.deps.requestId && cur.lastMutation?.op === "updateDispute") return cur;

      const next: Dispute = {
        ...cur,
        status: input.status ?? cur.status,
        payoutImpact: input.payoutImpact ?? cur.payoutImpact,
        buyerImpact: input.buyerImpact ?? cur.buyerImpact,
        sellerImpact: input.sellerImpact ?? cur.sellerImpact,
        detail: input.detail ?? cur.detail,
        events: [
          ...cur.events,
          {
            atMs: input.nowMs,
            kind: "DISPUTE_UPDATED",
            actor: input.actor,
            requestId: this.deps.requestId,
            note: input.note,
          },
        ],
        lastMutation: { requestId: this.deps.requestId, op: "updateDispute", atMs: input.nowMs },
        version: cur.version + 1,
        updatedAtMs: input.nowMs,
      };

      return next;
    });

    this.deps.logger.info(orchEvent(op, "success"), {
      requestId: this.deps.requestId,
      op,
      aggregate: "dispute",
      outcome: "success",
      durationMs: Date.now() - started,
      actorId: input.actor.id,
      expectedVersion: input.expectedVersion,
    });

    return { dispute: updated };
  }

  async resolveDispute(input: ResolveDisputeInput): Promise<{ dispute: Dispute }> {
    const op = "resolveDispute";
    const started = Date.now();

    this.deps.logger.info(orchEvent(op, "attempt"), {
      requestId: this.deps.requestId,
      op,
      aggregate: "dispute",
      outcome: "attempt",
      durationMs: 0,
      actorId: input.actor.id,
      expectedVersion: input.expectedVersion,
    });

    const updated = await this.repo.updateWithExpectedVersion(input.disputeId, input.expectedVersion, (cur) => {
      if (cur.lastMutation?.requestId === this.deps.requestId && cur.lastMutation?.op === "resolveDispute") return cur;

      const refund = input.resolution.refund ? DisputeRefundRecordSchema.parse(input.resolution.refund) : null;
      const chargeback = input.resolution.chargeback
        ? DisputeChargebackRecordSchema.parse(input.resolution.chargeback)
        : null;

      const nextStatus: Dispute["status"] = cur.status === "CLOSED" ? "CLOSED" : "RESOLVED";

      const next: Dispute = {
        ...cur,
        status: nextStatus,
        payoutImpact: input.resolution.payoutImpact ?? cur.payoutImpact,
        buyerImpact: input.resolution.buyerImpact ?? cur.buyerImpact,
        sellerImpact: input.resolution.sellerImpact ?? cur.sellerImpact,
        refunds: refund ? [...cur.refunds, refund] : cur.refunds,
        chargebacks: chargeback ? [...cur.chargebacks, chargeback] : cur.chargebacks,
        events: [
          ...cur.events,
          {
            atMs: input.nowMs,
            kind: "DISPUTE_RESOLVED",
            actor: input.actor,
            requestId: this.deps.requestId,
            note: input.resolution.note,
          },
        ],
        lastMutation: { requestId: this.deps.requestId, op: "resolveDispute", atMs: input.nowMs },
        version: cur.version + 1,
        updatedAtMs: input.nowMs,
      };

      return next;
    });

    this.deps.logger.info(orchEvent(op, "success"), {
      requestId: this.deps.requestId,
      op,
      aggregate: "dispute",
      outcome: "success",
      durationMs: Date.now() - started,
      actorId: input.actor.id,
      expectedVersion: input.expectedVersion,
    });

    return { dispute: updated };
  }
}
