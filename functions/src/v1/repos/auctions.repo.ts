import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { AuctionSchema, type Auction } from "../v1/schemas/domain/auction.schema";
import { parseOrThrow } from "./repo.utils";
import { auctionPath, auctionsCollectionPath } from "./paths";

export type CreateAuctionInput = Omit<Auction, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type UpdateAuctionPatch = Partial<Omit<Auction, "id" | "createdAt">>;

export class AuctionsRepo {
  constructor(private readonly db: Firestore) {}

  async get(listingId: string, auctionId: string): Promise<Auction | null> {
    const snap = await this.db.doc(auctionPath(listingId, auctionId)).get();
    if (!snap.exists) return null;
    return parseOrThrow(AuctionSchema, snap.data(), `Auction:${listingId}/${auctionId}:read`);
  }

  async listByListing(listingId: string, limit = 20): Promise<Auction[]> {
    const qs = await this.db
      .collection(auctionsCollectionPath(listingId))
      .orderBy("schedule.startAt", "desc")
      .limit(limit)
      .get();

    return qs.docs.map((d) =>
      parseOrThrow(AuctionSchema, d.data(), `Auction:${listingId}/${d.id}:readMany`)
    );
  }

  async create(listingId: string, input: CreateAuctionInput): Promise<Auction> {
    const now = Timestamp.now();
    const col = this.db.collection(auctionsCollectionPath(listingId));
    const id = input.id ?? col.doc().id;

    const doc: Auction = parseOrThrow(
      AuctionSchema,
      {
        ...input,
        id,
        listingId,
        createdAt: now,
        updatedAt: now,
      },
      `Auction:${listingId}/${id}:create`
    );

    await this.db.doc(auctionPath(listingId, id)).set(doc, { merge: false });
    return doc;
  }

  async update(listingId: string, auctionId: string, patch: UpdateAuctionPatch): Promise<Auction> {
    const now = Timestamp.now();

    const existing = await this.get(listingId, auctionId);
    if (!existing) throw new Error(`NotFound: Auction:${listingId}/${auctionId}`);

    const next: Auction = parseOrThrow(
      AuctionSchema,
      {
        ...existing,
        ...patch,
        id: auctionId,
        listingId,
        createdAt: existing.createdAt,
        updatedAt: now,
      },
      `Auction:${listingId}/${auctionId}:update`
    );

    await this.db.doc(auctionPath(listingId, auctionId)).set(next, { merge: false });
    return next;
  }
}
