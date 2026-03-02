import admin from "firebase-admin";

function envOr(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.length > 0 ? process.env[name]! : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`Env ${name} must be an int`);
  return n;
}

async function main() {
  const projectId = envOr("GCLOUD_PROJECT", envOr("GOOGLE_CLOUD_PROJECT", ""));
  if (!projectId) throw new Error("Missing GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT");

  const emulatorHost = envOr("FIRESTORE_EMULATOR_HOST", "");
  if (!emulatorHost) throw new Error("Missing FIRESTORE_EMULATOR_HOST (expected 127.0.0.1:8080)");

  const listingId = envOr("LISTING_ID", "listing_seed_1");
  const auctionId = envOr("AUCTION_ID", "auction_seed_1");
  const limit = envInt("LIMIT", 50);

  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  db.settings({ host: emulatorHost, ssl: false });

  const col = db.collection(`listings/${listingId}/auctions/${auctionId}/bids`);
  const snap = await col.orderBy("placedAt", "desc").limit(limit).get();

  console.log(JSON.stringify({ ok: true, listingId, auctionId, limit, bidsCount: snap.size }, null, 2));
  for (const doc of snap.docs) {
    const x: any = doc.data();
    const placedAtMs =
      typeof x.placedAt?.toMillis === "function" ? x.placedAt.toMillis() : x.placedAt ?? null;

    console.log(
      [
        doc.id,
        placedAtMs,
        x.bidderUid ?? null,
        x.amountCents ?? null,
        x.status ?? null,
        x.clientRequestId ?? "",
      ].join(" ")
    );
  }
}

main().catch((e) => {
  console.error("FATAL:");
  console.error(e);
  process.exit(1);
});
