import admin from "firebase-admin";

function req(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function deleteCollection(path: string, batchSize = 200) {
  const db = admin.firestore();
  while (true) {
    const snap = await db.collection(path).limit(batchSize).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function main() {
  const projectId = req("GCLOUD_PROJECT");
  const host = req("FIRESTORE_EMULATOR_HOST");
  const listingId = req("LISTING_ID");
  const auctionId = req("AUCTION_ID");

  if (!admin.apps.length) admin.initializeApp({ projectId });

  const db = admin.firestore();
  db.settings({ host, ssl: false });

  const base = `listings/${listingId}/auctions/${auctionId}`;

  await deleteCollection(`${base}/bids`);
  await db.doc(`${base}/state/current`).delete().catch(() => {});
  await db.doc(`${base}`).delete().catch(() => {});
  await db.doc(`listings/${listingId}`).delete().catch(() => {});

  console.log(JSON.stringify({ ok: true, listingId, auctionId, wiped: true }, null, 2));
}

main().catch((e) => {
  console.error("FATAL:");
  console.error(e);
  process.exit(1);
});
