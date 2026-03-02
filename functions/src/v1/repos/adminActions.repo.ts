import type { Firestore } from "firebase-admin/firestore";
import { AdminAction, AdminActionZ } from "../schemas/domain/admin/adminAction.schema";

const COL = "adminActions";

/**
 * Repo is SILENT.
 * Orchestrators own: validation, idempotency, concurrency, logging.
 */

export function adminActionsCol(db: Firestore) {
  return db.collection(COL);
}

export async function getAdminActionById(db: Firestore, id: string): Promise<AdminAction | null> {
  const snap = await adminActionsCol(db).doc(id).get();
  if (!snap.exists) return null;

  const data = snap.data();
  const parsed = AdminActionZ.safeParse({ id: snap.id, ...data });
  if (!parsed.success) return null;
  return parsed.data;
}

export async function createAdminActionIfAbsent(
  db: Firestore,
  action: AdminAction
): Promise<{ created: boolean; value: AdminAction }> {
  const ref = adminActionsCol(db).doc(action.id);
  const snap = await ref.get();

  if (snap.exists) {
    const existing = await getAdminActionById(db, action.id);
    if (existing) return { created: false, value: existing };
    return { created: false, value: action };
  }

  await ref.create(stripId(action));
  return { created: true, value: action };
}

/**
 * Outcome finalization: orchestrator must enforce immutability.
 * Only previously-null outcome fields may be set.
 */
export async function finalizeAdminActionOutcome(
  db: Firestore,
  id: string,
  patch: Partial<Pick<AdminAction, "appliedAtMs" | "result" | "postSnapshot" | "failure">>
): Promise<void> {
  await adminActionsCol(db).doc(id).update(patch);
}

function stripId(a: AdminAction) {
  const { id, ...rest } = a;
  return rest;
}
