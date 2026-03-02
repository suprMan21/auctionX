import { db } from "../lib/firebaseAdmin";
import type { Category } from "../schemas/domain/category.schema";
import { CategorySchema } from "../schemas/domain/category.schema";
import { parseOrThrow } from "./repo.utils";

const COLLECTION = "categories";

export class CategoriesRepo {
  /**
   * Get category by ID
   */
  static async getById(id: string): Promise<Category | null> {
    const snap = await db.collection(COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const raw = snap.data();
    return parseOrThrow(CategorySchema, { id: snap.id, ...raw }, `category:${id}`);
  }

  /**
   * List all categories
   */
  static async list(): Promise<Category[]> {
    const snap = await db.collection(COLLECTION).get();
    return snap.docs.map(doc => 
      parseOrThrow(CategorySchema, { id: doc.id, ...doc.data() }, `category:${doc.id}`)
    );
  }

  /**
   * Create or update category
   */
  static async save(category: Category): Promise<void> {
    const ref = db.collection(COLLECTION).doc(category.id);
    const existing = await ref.get();

    if (existing.exists) {
      // Update existing
      await ref.update({
        name: category.name,
        brand: category.brand,
        isAdult: category.isAdult,
        isActive: category.isActive,
        parentId: category.parentId,
        path: category.path,
        sortOrder: category.sortOrder,
      });
    } else {
      // Create new
      await ref.set(category);
    }
  }
}
