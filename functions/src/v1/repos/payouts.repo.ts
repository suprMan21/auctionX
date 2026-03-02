import { db } from "../lib/firebaseAdmin";
import { PayoutPersist, PayoutPersistSchema } from "../schemas/domain/payout.schema";

type TxnResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

function err(code: string, message: string): TxnResult<never> {
  return { ok: false, error: { code, message } };
}

function payoutsCol() {
  return db.collection("payouts");
}

function docRef(payoutId: string) {
  return payoutsCol().doc(payoutId);
}

export async function getPayout(payoutId: string): Promise<TxnResult<PayoutPersist | null>> {
  try {
    const snap = await docRef(payoutId).get();
    if (!snap.exists) return { ok: true, value: null };
    const parsed = PayoutPersistSchema.safeParse({ id: snap.id, ...snap.data() });
    if (!parsed.success) return err("SCHEMA_INVALID", "Payout doc failed schema validation");
    return { ok: true, value: parsed.data };
  } catch (e: any) {
    return err("IO_ERROR", e?.message ?? "Failed to read payout");
  }
}

export async function createPayoutIfAbsent(payout: PayoutPersist): Promise<TxnResult<PayoutPersist>> {
  try {
    const validated = PayoutPersistSchema.parse(payout);

    const res = await db.runTransaction(async (tx) => {
      const ref = docRef(validated.id);
      const snap = await tx.get(ref);

      if (snap.exists) {
        const existing = PayoutPersistSchema.safeParse({ id: snap.id, ...snap.data() });
        if (!existing.success) throw new Error("Existing payout failed schema validation");
        return existing.data;
      }

      const { id, ...data } = validated;
      tx.create(ref, data);
      return validated;
    });

    return { ok: true, value: res };
  } catch (e: any) {
    return err("TX_ERROR", e?.message ?? "Failed to create payout");
  }
}

export async function updatePayoutTxn(opts: {
  payoutId: string;
  expectedVersion?: number;
  nowMs: number;
  mutate: (current: PayoutPersist) => PayoutPersist;
}): Promise<TxnResult<PayoutPersist>> {
  const { payoutId, expectedVersion, nowMs, mutate } = opts;

  try {
    const res = await db.runTransaction(async (tx) => {
      const ref = docRef(payoutId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Payout not found");

      const parsed = PayoutPersistSchema.safeParse({ id: snap.id, ...snap.data() });
      if (!parsed.success) throw new Error("Payout failed schema validation");
      const current = parsed.data;

      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        const errObj = { code: "CONFLICT", message: `Expected version ${expectedVersion} but found ${current.version}` };
        throw Object.assign(new Error(errObj.message), { _payoutErr: errObj });
      }

      const next = PayoutPersistSchema.parse(mutate(current));
      const { id, ...data } = next;

      tx.update(ref, { ...data, updatedAtMs: nowMs });

      return next;
    });

    const normalized = PayoutPersistSchema.safeParse(res);
    if (!normalized.success) return err("SCHEMA_INVALID", "Updated payout failed schema validation");
    return { ok: true, value: normalized.data };
  } catch (e: any) {
    if (e?._payoutErr?.code === "CONFLICT") {
      return { ok: false, error: e._payoutErr };
    }
    return err("TX_ERROR", e?.message ?? "Failed to update payout");
  }
}

export async function findLatestSettledSettlementId(): Promise<TxnResult<string | null>> {
  try {
    const snap = await db
      .collection("settlements")
      .where("status", "==", "SETTLED")
      .orderBy("updatedAtMs", "desc")
      .limit(1)
      .get();

    if (snap.empty) return { ok: true, value: null };
    return { ok: true, value: snap.docs[0].id };
  } catch (e: any) {
    return err("IO_ERROR", e?.message ?? "Failed to query settlements");
  }
}
