/**
 * @module Module 02 Port — Auction Mechanics
 * Barrel export for backend/src/lib/auction/.
 *
 * Consumers (Module 11 settlement, Express route handlers) should import from here
 * rather than reaching into individual files.
 */

// Core mechanics (pure functions — no I/O, no Firebase)
export { computeStartAuction, computePlaceBid, computeCloseAuction } from './mechanics';
export { repriceProxyState, minIncrementCents } from './proxy';

// Types
export type { AuctionCore, MechanicsOutput, PlaceBidInput, AuctionPatch, Preconditions } from './types';
export { AuctionCoreSchema, AuctionPatchSchema } from './types';
export { AuctionMechanicsError } from './errors';
export type { Result } from './errors';

// Orchestration
export { closeAuction } from './closeOrchestrator';
export type { AuctionsAggregateRepoPort, CloseAuctionDeps } from './closeOrchestrator';
export type { CloseAuctionOutcome, CloseAuctionResult } from './closeTypes';
export type { OrchestrationError } from './orchestrationErrors';
