import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { ListingSchema, type Listing } from "../schemas/domain/listing.schema";
import { parseOrThrow } from "./repo.utils";
import { listingPath, listingsCollectionPath } from "./paths";

export type CreateListingInput = Omit<Listing, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type UpdateListingPatch = Partial<Omit<Listing, "id" | "createdAt">>;

export class ListingsRepo {
  constructor(private readonly db: Firestore) {}

  async get(listingId: string): Promise<Listing | null> {
    const snap = await this.db.doc(listingPath(listingId)).get();
    if (!snap.exists) return null;
    return parseOrThrow(ListingSchema, snap.data(), `Listing:${listingId}:read`);
  }

  async create(input: CreateListingInput): Promise<Listing> {
    const now = Timestamp.now();
    const id = input.id ?? this.db.collection(listingsCollectionPath()).doc().id;

    const doc: Listing = parseOrThrow(
      ListingSchema,
      {
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
      },
      `Listing:${id}:create`
    );

    await this.db.doc(listingPath(id)).set(doc, { merge: false });
    return doc;
  }

  async update(listingId: string, patch: UpdateListingPatch): Promise<Listing> {
    const now = Timestamp.now();

    // NOTE: persistence-only pattern: read + merge + validate + write
    const existing = await this.get(listingId);
    if (!existing) throw new Error(`NotFound: Listing:${listingId}`);

    const next: Listing = parseOrThrow(
      ListingSchema,
      {
        ...existing,
        ...patch,
        id: listingId,
        createdAt: existing.createdAt,
        updatedAt: now,
      },
      `Listing:${listingId}:update`
    );

    await this.db.doc(listingPath(listingId)).set(next, { merge: false });
    return next;
  }
}
