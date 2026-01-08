import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { CategorySchema, type Category } from "../schemas/domain/category.schema";
import { parseOrThrow } from "./repo.utils";
import { categoriesCollectionPath, categoryPath } from "./paths";

export type CreateCategoryInput = Omit<Category, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type UpdateCategoryPatch = Partial<Omit<Category, "id" | "createdAt">>;

export class CategoriesRepo {
  constructor(private readonly db: Firestore) {}

  async get(categoryId: string): Promise<Category | null> {
    const snap = await this.db.doc(categoryPath(categoryId)).get();
    if (!snap.exists) return null;
    return parseOrThrow(CategorySchema, snap.data(), `Category:${categoryId}:read`);
  }

  async create(input: CreateCategoryInput): Promise<Category> {
    const now = Timestamp.now();
    const id = input.id ?? this.db.collection(categoriesCollectionPath()).doc().id;

    const doc: Category = parseOrThrow(
      CategorySchema,
      {
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
      },
      `Category:${id}:create`
    );

    await this.db.doc(categoryPath(id)).set(doc, { merge: false });
    return doc;
  }

  async update(categoryId: string, patch: UpdateCategoryPatch): Promise<Category> {
    const now = Timestamp.now();
    const existing = await this.get(categoryId);
    if (!existing) throw new Error(`NotFound: Category:${categoryId}`);

    const next: Category = parseOrThrow(
      CategorySchema,
      {
        ...existing,
        ...patch,
        id: categoryId,
        createdAt: existing.createdAt,
        updatedAt: now,
      },
      `Category:${categoryId}:update`
    );

    await this.db.doc(categoryPath(categoryId)).set(next, { merge: false });
    return next;
  }
}
