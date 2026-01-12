import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

import { ListingSchema, type Listing } from "../src/v1/schemas/domain/listing.schema";
import { parseOrThrow } from "../src/v1/repos/repo.utils";
import { listingPath } from "../src/v1/repos/paths";

function envOr(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.length > 0 ? process.env[name]! : fallback;
}

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const listingId = envOr("LISTING_ID", "listing_seed_1");
  const now = Timestamp.now();

  const listing: Listing = parseOrThrow(
    ListingSchema,
    {
      id: listingId,
      sellerUid: envOr("SELLER_UID", "seller_seed_1"),
      title: envOr("TITLE", "Seed Listing"),
      description: envOr("DESCRIPTION", "Seed listing for emulator testing"),
      categoryId: envOr("CATEGORY_ID", "category_seed_1"),
      condition: envOr("CONDITION", "GOOD") as any,
      photos: [],
      location: {
        country: envOr("COUNTRY", "CA"),
        region: envOr("REGION", "ON"),
        city: envOr("CITY", "Toronto"),
        postalFsa: envOr("POSTAL_FSA", "M5V"),
      },
      pricing: {
        currency: "CAD",
      },
      status: envOr("STATUS", "ACTIVE") as any,
      createdAt: now,
      updatedAt: now,
    },
    `Seed:Listing:${listingId}`
  );

  await db.doc(listingPath(listingId)).set(listing, { merge: false });

  console.log(
    JSON.stringify(
      {
        ok: true,
        listingId,
        path: listingPath(listingId),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
