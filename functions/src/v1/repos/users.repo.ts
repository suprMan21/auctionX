import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { UserSchema, type User } from "../schemas/domain/user.schema";
import { parseOrThrow } from "./repo.utils";
import { usersPath } from "./paths";

export type UpsertUserInput = Omit<User, "createdAt" | "updatedAt">;

export class UsersRepo {
  constructor(private readonly db: Firestore) {}

  async get(uid: string): Promise<User | null> {
    const snap = await this.db.doc(usersPath(uid)).get();
    if (!snap.exists) return null;
    return parseOrThrow(UserSchema, snap.data(), `User:${uid}:read`);
  }

  async upsert(input: UpsertUserInput): Promise<User> {
    const now = Timestamp.now();
    const existing = await this.get(input.uid);

    const doc: User = parseOrThrow(
      UserSchema,
      {
        ...existing,
        ...input,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
      `User:${input.uid}:upsert`
    );

    await this.db.doc(usersPath(input.uid)).set(doc, { merge: false });
    return doc;
  }
}
