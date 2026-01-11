import type { Registry } from "../../openapi/registry";

/**
 * Reserved for bid-specific OpenAPI registrations (if we split tags later).
 * For Module 04 MVP, bidding is registered under registerAuctionsOpenApi.
 */
export function registerBidsOpenApi(_registry: Registry) {
  // no-op
}
