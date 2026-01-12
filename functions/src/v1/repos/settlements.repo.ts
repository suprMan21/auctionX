import { db } from "../lib/firebaseAdmin";
import { SettlementPersist, SettlementPersistSchema } from "../schemas/domain/settlement.schema";

type TxnResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

function err(code: string, message: string): TxnResult<never> {
  return { ok: false, error: { code, message } };
}

function settlementsCol() {
  return db.collection("settlements");
}

function docRef(settlementId: string) {
  return settlementsCol().doc(settlementId);
}

export async function getSettlement(settlementId: string): Promise<TxnResult<SettlementPersist | null>> {
  try {
    const snap = await docRef(settlementId).get();
    if (!snap.exists) return { ok: true, value: null };
    const parsed = SettlementPersistSchema.safeParse({ id: snap.id, ...snap.data() });
    if (!parsed.success) return err("SCHEMA_INVALID", "Settlement doc failed schema validation");
    return { ok: true, value: parsed.data };
  } catch (e: any) {
    return err("IO_ERROR", e?.message ?? "Failed to read settlement");
  }
}

export async function createSettlementIfAbsent(settlement: SettlementPersist): Promise<TxnResult<SettlementPersist>> {
  try {
    const validated = SettlementPersistSchema.parse(settlement);

    const res = await db.runTransaction(async (tx) => {
      const ref = docRef(validated.id);
      const snap = await tx.get(ref);

      if (snap.exists) {
        const existing = SettlementPersistSchema.safeParse({ id: snap.id, ...snap.data() });
        if (!existing.success) throw new Error("Existing settlement failed schema validation");
        return existing.data;
      }

      const { id, ...data } = validated;
      tx.create(ref, data);
      return validated;
    });

    return { ok: true, value: res };
  } catch (e: any) {
    return err("TX_ERROR", e?.message ?? "Failed to create settlement");
  }
}

export async function updateSettlementTxn(opts: {
  settlementId: string;
  expectedVersion?: number;
  nowMs: number;
  mutate: (current: SettlementPersist) => SettlementPersist;
}): Promise<TxnResult<SettlementPersist>> {
  const { settlementId, expectedVersion, nowMs, mutate } = opts;

  try {
    const res = await db.runTransaction(async (tx) => {
      const ref = docRef(settlementId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Settlement not found");

      const parsed = SettlementPersistSchema.safeParse({ id: snap.id, ...snap.data() });
      if (!parsed.success) throw new Error("Settlement failed schema validation");
      const current = parsed.data;

      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        const errObj = { code: "CONFLICT", message: `Expected version ${expectedVersion} but found ${current.version}` };
        throw Object.assign(new Error(errObj.message), { _settlementErr: errObj });
      }

      const next = SettlementPersistSchema.parse(mutate(current));

      const { id, ...data } = next;
      tx.update(ref, { ...data, updatedAtMs: nowMs });

      return next;
    });

    const normalized = SettlementPersistSchema.safeParse(res);
    if (!normalized.success) return err("SCHEMA_INVALID", "Updated settlement failed schema validation");
    return { ok: true, value: normalized.data };
  } catch (e: any) {
    if (e?._settlementErr?.code === "CONFLICT") {
      return { ok: false, error: e._settlementErr };
    }
    return err("TX_ERROR", e?.message ?? "Failed to update settlement");
  }
}
