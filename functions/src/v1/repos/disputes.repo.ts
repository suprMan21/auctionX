import { Firestore } from "firebase-admin/firestore";
import { Dispute, DisputeSchema } from "../schemas/domain/dispute.schema";
import { disputeDoc } from "./paths";

export type DisputeCreateInput = Omit<Dispute, "version" | "createdAtMs" | "updatedAtMs"> & {
  createdAtMs: number;
  updatedAtMs: number;
  version: number;
};

export class DisputesRepo {
  constructor(private readonly db: Firestore) {}

  ref(disputeId: string) {
    return this.db.doc(disputeDoc(disputeId));
  }

  async get(disputeId: string): Promise<Dispute | null> {
    const snap = await this.ref(disputeId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    const parsed = DisputeSchema.safeParse({ id: disputeId, ...(data || {}) });
    if (!parsed.success) {
      throw new Error(`Invalid dispute document: ${disputeId}`);
    }
    return parsed.data;
  }

  async createIfAbsent(input: DisputeCreateInput): Promise<Dispute> {
    const ref = this.ref(input.id);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return;
      tx.set(ref, { ...input });
    });
    const got = await this.get(input.id);
    if (!got) throw new Error(`Failed to create dispute: ${input.id}`);
    return got;
  }

  async updateWithExpectedVersion(
    disputeId: string,
    expectedVersion: number,
    mutate: (cur: Dispute) => Dispute
  ): Promise<Dispute> {
    const ref = this.ref(disputeId);
    let out: Dispute | null = null;

    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`Dispute not found: ${disputeId}`);
      const data = snap.data() || {};
      const parsed = DisputeSchema.safeParse({ id: disputeId, ...data });
      if (!parsed.success) throw new Error(`Invalid dispute document: ${disputeId}`);
      const cur = parsed.data;

      if (cur.version !== expectedVersion) {
        throw new Error(
          `Version mismatch for dispute ${disputeId}: expected ${expectedVersion}, got ${cur.version}`
        );
      }

      const next = mutate(cur);
      const validated = DisputeSchema.parse(next);

      tx.set(ref, { ...validated });
      out = validated;
    });

    if (!out) throw new Error(`Failed to update dispute: ${disputeId}`);
    return out;
  }
}
