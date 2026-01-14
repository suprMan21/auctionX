import { firestore } from "firebase-admin";
import {
  AdminAction,
  AdminActionZ,
  AdminReasonCode,
  adminActionIdFromRequestId,
} from "../../schemas/domain/admin/adminAction.schema";
import {
  createAdminActionIfAbsent,
  finalizeAdminActionOutcome,
  getAdminActionById,
} from "../../repos/adminActions.repo";
import { DisputeActorSchema, DisputeReasonCodeSchema } from "../../schemas/domain/dispute.schema";
import { DisputeOrchestrator } from "./dispute.orchestrator";

type OrchLogBase = {
  requestId: string;
  op: string;
  aggregate: "adminAction";
  outcome: "attempt" | "success" | "noop" | "error";
  durationMs: number;
  [k: string]: unknown;
};

function logInfo(event: string, payload: Record<string, unknown>) {
  console.log(`[orch][info] ${event}`, payload);
}

function logError(event: string, payload: Record<string, unknown>) {
  console.error(`[orch][error] ${event}`, payload);
}

export type AdminActor = {
  kind: "HUMAN" | "SYSTEM";
  uid: string;
};

export class AdminOrchestrator {
  private readonly db: firestore.Firestore;
  private readonly disputes: DisputeOrchestrator;

  constructor(db: firestore.Firestore) {
    this.db = db;
    this.disputes = new DisputeOrchestrator(db);
  }

  async createDisputeAdmin(params: {
    requestId: string;
    actor: AdminActor;
    justification: string;
    reasonCode: AdminReasonCode;

    disputeId: string;

    listingId: string;
    auctionId: string;
    settlementId: string | null;
    payoutId: string | null;
    buyerUid: string;
    sellerUid: string;

    disputeReasonCode: typeof DisputeReasonCodeSchema._type;
    reasonText?: string | null;
    note?: string;
  }): Promise<{ adminAction: AdminAction; disputeId: string }> {
    const started = Date.now();
    const op = "adminCreateDispute";

    logInfo(`orch.${op}.attempt`, {
      requestId: params.requestId,
      op,
      aggregate: "adminAction",
      outcome: "attempt",
      durationMs: 0,
    } satisfies OrchLogBase);

    const id = adminActionIdFromRequestId(params.requestId);

    const existing = await getAdminActionById(this.db, id);
    if (existing && existing.result !== "PENDING") {
      logInfo(`orch.${op}.noop`, {
        requestId: params.requestId,
        op,
        aggregate: "adminAction",
        outcome: "noop",
        durationMs: Date.now() - started,
        adminActionId: id,
        result: existing.result,
      } satisfies OrchLogBase);
      return { adminAction: existing, disputeId: params.disputeId };
    }

    const createdAtMs = Date.now();

    const base: AdminAction = AdminActionZ.parse({
      id,
      actionKind: "CREATE_DISPUTE_ADMIN",
      reasonCode: params.reasonCode,
      reasonCodeVersion: "ADMIN_REASON_V1",
      actor: params.actor,
      justification: params.justification,
      requestId: params.requestId,
      target: { aggregate: "DISPUTE", id: params.disputeId },
      createdAtMs,
      result: "PENDING",
      preSnapshot: {
        listingId: params.listingId,
        auctionId: params.auctionId,
        settlementId: params.settlementId,
        payoutId: params.payoutId,
        buyerUid: params.buyerUid,
        sellerUid: params.sellerUid,
        disputeReasonCode: params.disputeReasonCode,
      },
    });

    const { created, value } = await createAdminActionIfAbsent(this.db, base);

    if (!created && value.result !== "PENDING") {
      logInfo(`orch.${op}.noop`, {
        requestId: params.requestId,
        op,
        aggregate: "adminAction",
        outcome: "noop",
        durationMs: Date.now() - started,
        adminActionId: id,
        result: value.result,
      } satisfies OrchLogBase);
      return { adminAction: value, disputeId: params.disputeId };
    }

    const appliedAtMs = Date.now();

    try {
      const disputeActor = DisputeActorSchema.parse(params.actor.kind === "SYSTEM" ? "SYSTEM" : "ADMIN");

      await this.disputes.createDispute({
        requestId: params.requestId,
        disputeId: params.disputeId,
        listingId: params.listingId,
        auctionId: params.auctionId,
        settlementId: params.settlementId ?? null,
        payoutId: params.payoutId ?? null,
        buyerUid: params.buyerUid,
        sellerUid: params.sellerUid,
        reasonCode: params.disputeReasonCode,
        reasonText: params.reasonText ?? null,
        actor: disputeActor,
        note: params.note,
      });

      await finalizeAdminActionOutcome(this.db, id, {
        appliedAtMs,
        result: "APPLIED",
        postSnapshot: { ok: true, disputeId: params.disputeId },
      });

      const out = (await getAdminActionById(this.db, id)) ?? {
        ...value,
        appliedAtMs,
        result: "APPLIED",
        postSnapshot: { ok: true, disputeId: params.disputeId },
      };

      logInfo(`orch.${op}.success`, {
        requestId: params.requestId,
        op,
        aggregate: "adminAction",
        outcome: "success",
        durationMs: Date.now() - started,
        adminActionId: id,
        created,
      } satisfies OrchLogBase);

      return { adminAction: out, disputeId: params.disputeId };
    } catch (err: any) {
      await finalizeAdminActionOutcome(this.db, id, {
        appliedAtMs,
        result: "FAILED_TERMINAL",
        failure: {
          code: "TERMINAL",
          messageSafe: String(err?.message ?? err),
          atMs: Date.now(),
        },
      });

      logError(`orch.${op}.error`, {
        requestId: params.requestId,
        op,
        aggregate: "adminAction",
        outcome: "error",
        durationMs: Date.now() - started,
        adminActionId: id,
        error: String(err?.message ?? err),
      } satisfies OrchLogBase);

      throw err;
    }
  }

  async recordChargebackFactAdmin(params: {
    requestId: string;
    actor: AdminActor;
    justification: string;
    reasonCode: AdminReasonCode;

    disputeId: string;
    expectedVersion: number;

    fact: "REPORTED" | "WON" | "LOST";
    amountCents?: number;
    note?: string;
    externalRef?: { system: string; id: string } | null;
  }): Promise<{ adminAction: AdminAction }> {
    const started = Date.now();
    const op = "adminRecordChargebackFact";

    logInfo(`orch.${op}.attempt`, {
      requestId: params.requestId,
      op,
      aggregate: "adminAction",
      outcome: "attempt",
      durationMs: 0,
      disputeId: params.disputeId,
      expectedVersion: params.expectedVersion,
      fact: params.fact,
    } satisfies OrchLogBase);

    const id = adminActionIdFromRequestId(params.requestId);

    const existing = await getAdminActionById(this.db, id);
    if (existing && existing.result !== "PENDING") {
      logInfo(`orch.${op}.noop`, {
        requestId: params.requestId,
        op,
        aggregate: "adminAction",
        outcome: "noop",
        durationMs: Date.now() - started,
        adminActionId: id,
        result: existing.result,
      } satisfies OrchLogBase);
      return { adminAction: existing };
    }

    const createdAtMs = Date.now();

    const base: AdminAction = AdminActionZ.parse({
      id,
      actionKind: "RECORD_CHARGEBACK_FACT",
      reasonCode: params.reasonCode,
      reasonCodeVersion: "ADMIN_REASON_V1",
      actor: params.actor,
      justification: params.justification,
      requestId: params.requestId,
      expectedVersion: params.expectedVersion,
      target: { aggregate: "DISPUTE", id: params.disputeId, secondaryId: params.fact },
      createdAtMs,
      result: "PENDING",
      preSnapshot: {
        disputeId: params.disputeId,
        expectedVersion: params.expectedVersion,
        fact: params.fact,
        amountCents: params.amountCents ?? null,
      },
    });

    const { created, value } = await createAdminActionIfAbsent(this.db, base);

    if (!created && value.result !== "PENDING") {
      logInfo(`orch.${op}.noop`, {
        requestId: params.requestId,
        op,
        aggregate: "adminAction",
        outcome: "noop",
        durationMs: Date.now() - started,
        adminActionId: id,
        result: value.result,
      } satisfies OrchLogBase);
      return { adminAction: value };
    }

    const appliedAtMs = Date.now();

    try {
      const disputeActor = DisputeActorSchema.parse(params.actor.kind === "SYSTEM" ? "SYSTEM" : "ADMIN");

      if (params.fact === "REPORTED") {
        if (typeof params.amountCents !== "number") {
          throw new Error("amountCents required for fact=REPORTED");
        }
        await this.disputes.reportChargeback({
          requestId: params.requestId,
          disputeId: params.disputeId,
          expectedVersion: params.expectedVersion,
          actor: disputeActor,
          amountCents: params.amountCents,
          note: params.note,
          externalRef: params.externalRef ?? null,
        });
      } else {
        await this.disputes.setChargebackStatus({
          requestId: params.requestId,
          disputeId: params.disputeId,
          expectedVersion: params.expectedVersion,
          actor: disputeActor,
          status: params.fact,
          note: params.note,
        });
      }

      await finalizeAdminActionOutcome(this.db, id, {
        appliedAtMs,
        result: "APPLIED",
        postSnapshot: { ok: true, disputeId: params.disputeId, fact: params.fact },
      });

      const out = (await getAdminActionById(this.db, id)) ?? {
        ...value,
        appliedAtMs,
        result: "APPLIED",
        postSnapshot: { ok: true, disputeId: params.disputeId, fact: params.fact },
      };

      logInfo(`orch.${op}.success`, {
        requestId: params.requestId,
        op,
        aggregate: "adminAction",
        outcome: "success",
        durationMs: Date.now() - started,
        adminActionId: id,
        created,
      } satisfies OrchLogBase);

      return { adminAction: out };
    } catch (err: any) {
      await finalizeAdminActionOutcome(this.db, id, {
        appliedAtMs,
        result: "FAILED_TERMINAL",
        failure: {
          code: "TERMINAL",
          messageSafe: String(err?.message ?? err),
          atMs: Date.now(),
        },
      });

      logError(`orch.${op}.error`, {
        requestId: params.requestId,
        op,
        aggregate: "adminAction",
        outcome: "error",
        durationMs: Date.now() - started,
        adminActionId: id,
        error: String(err?.message ?? err),
      } satisfies OrchLogBase);

      throw err;
    }
  }
}
