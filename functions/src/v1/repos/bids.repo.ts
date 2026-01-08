import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { BidSchema, type Bid } from "../v1/schemas/domain/bid.schema";
import { parseOrThrow } from "./repo.utils";
import { bidPath, bidsCollectionPath } from "./paths";

export type CreateBidInput = Omit<Bid, "id" | "placedAt"> & { id?: string; placedAt?: Timestamp };

export class BidsRepo {
  constructor(private readonly db: Firestore) {}

  async get(listingId: string, auctionId: string, bidId: string): Promise<Bid | null> {
    const snap = await this.db.doc(bidPath(listingId, auctionId, bidId)).get();
    if (!snap.exists) return null;
    return parseOrThrow(BidSchema, snap.data(), `Bid:${listingId}/${auctionId}/${bidId}:read`);
  }

  async listByAuction(listingId: string, auctionId: string, limit = 50): Promise<Bid[]> {
    const qs = await this.db
      .collection(bidsCollectionPath(listingId, auctionId))
      .orderBy("placedAt", "desc")
      .limit(limit)
      .get();

    return qs.docs.map((d) =>
      parseOrThrow(BidSchema, d.data(), `Bid:${listingId}/${auctionId}/${d.id}:readMany`)
    );
  }

  async create(listingId: string, auctionId: string, input: CreateBidInput): Promise<Bid> {
    const col = this.db.collection(bidsCollectionPath(listingId, auctionId));
    const id = input.id ?? col.doc().id;

    const doc: Bid = parseOrThrow(
      BidSchema,
      {
        ...input,
        id,
        listingId,
        auctionId,
        placedAt: input.placedAt ?? Timestamp.now(),
      },
      `Bid:${listingId}/${auctionId}/${id}:create`
    );

    await this.db.doc(bidPath(listingId, auctionId, id)).set(doc, { merge: false });
    return doc;
  }
}
