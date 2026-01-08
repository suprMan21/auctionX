import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { v1Router } from "./v1";

// Default region (change once, keep consistent)
setGlobalOptions({ region: "northamerica-northeast1" });

/**
 * Public API entrypoint.
 * Mounted by firebase.json rewrite: /v1/** -> function "api"
 */
export const api = onRequest(
  {
    region: "northamerica-northeast1",
    cors: true, // tighten later: allowlist origins for dev/staging/prod
  },
  async (req, res) => {
    await v1Router(req, res);
  }
);
