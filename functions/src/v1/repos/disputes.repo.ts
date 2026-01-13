import { firestore } from "firebase-admin";
import { Dispute, DisputeSchema } from "../schemas/domain/dispute.schema";

const COLL = "disputes";

export class DisputesRepo {
  constructor(private readonly db: firestore.Firestore) {}

  docRef(disputeId: string) {
    return this.db.collection(COLL).doc(disputeId);
  }

  async get(disputeId: string): Promise<Dispute | null> {
    const snap = await this.docRef(disputeId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    return DisputeSchema.parse(data);
  }

  async createIfAbsent(params: {
    dispute: Dispute;
    requestId: string;
  }): Promise<{ dispute: Dispute; created: boolean }> {
    const { dispute, requestId } = params;
    const ref = this.docRef(dispute.id);

    return await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

      if (snap.exists) {
        const existing = DisputeSchema.parse(snap.data());
        if (existing.idempotency?.[requestId]) {
          return { dispute: existing, created: false };
        }
        return { dispute: existing, created: false };
      }

      const toWrite: Dispute = {
        ...dispute,
        idempotency: {
          ...(dispute.idempotency ?? {}),
          [requestId]: { op: "createDispute", atMs: Date.now() },
        },
      };

      tx.create(ref, toWrite);
      return { dispute: toWrite, created: true };
    });
  }

  async mutate(params: {
    disputeId: string;
    requestId: string;
    expectedVersion: number;
    op: string;
    apply: (current: Dispute, nowMs: number) => Dispute;
  }): Promise<Dispute> {
    const { disputeId, requestId, expectedVersion, op, apply } = params;
    const ref = this.docRef(disputeId);

    return await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("DISPUTE_NOT_FOUND");

      const current = DisputeSchema.parse(snap.data());

      const prior = current.idempotency?.[requestId];
      if (prior) {
        return current;
      }

      if (current.version !== expectedVersion) {
        throw new Error("DISPUTE_VERSION_MISMATCH");
      }

      const nowMs = Date.now();
      const next = apply(current, nowMs);

      const nextWithIdem: Dispute = {
        ...next,
        idempotency: {
          ...(current.idempotency ?? {}),
          [requestId]: { op, atMs: nowMs },
        },
      };

      tx.set(ref, nextWithIdem, { merge: false });
      return nextWithIdem;
    });
  }

  async findActiveHoldByPayoutId(payoutId: string): Promise<{
    blocked: boolean;
    disputeId: string | null;
  }> {
    const q = await this.db
      .collection(COLL)
      .where("payoutId", "==", payoutId)
      .where("hold.status", "==", "PLACED")
      .limit(1)
      .get();

    if (q.empty) return { blocked: false, disputeId: null };
    return { blocked: true, disputeId: q.docs[0]!.id };
  }
}
