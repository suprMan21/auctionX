import admin from "firebase-admin";

/**
 * Firebase Admin singleton init.
 * - Safe in emulator + prod
 * - Avoids duplicate init across hot reloads
 */
if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();
