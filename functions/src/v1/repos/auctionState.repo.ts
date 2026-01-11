import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

import { auctionPath, auctionStatePath } from "./paths";
import { parseOrThrow } from "./repo.utils";

import { AuctionSchema, type Auction } from "../schemas/domain/auction.schema";
import { AuctionStateSchema, type AuctionState } from "../schemas/domain/auctionState.schema";

import {
  AuctionPatchSchema,
  PreconditionsSchema,
  type AuctionPatch,
  type Preconditions,
} from "../services/auctions/auction.types";

/**
 * Small, stable error surface for orchestration classification.
 */
export class RepoError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "VERSION_CONFLICT" | "PRECONDITION_FAILED" | "REPOSITORY_ERROR",
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

function applyPatchToState(existing: AuctionState, patch: AuctionPatch, nowMs: number): AuctionState {
  const p = AuctionPatchSchema.parse(patch);

  const next: AuctionState = parseOrThrow(
    AuctionStateSchema,
    {
      ...existing,
      pricing: p.pricing
        ? { ...existing.pricing, ...p.pricing }
        : existing.pricing,
      proxy: p.proxy
        ? { ...existing.proxy, ...p.proxy }
        : existing.proxy,
      ...(p.close !== undefined ? { close: { ...p.close } } : (existing.close !== undefined ? { close: existing.close } : {})),
      version: existing.version + p.versionBump,
      updatedAtMs: nowMs,
    },
    `AuctionState:${existing.listingId}/${existing.auctionId}:applyPatch`
  );

  return next;
}

function applyPatchToAuction(existing: Auction, patch: AuctionPatch): Auction {
  const p = AuctionPatchSchema.parse(patch);

  const next: Auction = parseOrThrow(
    AuctionSchema,
    {
      ...existing,
      ...(p.status !== undefined ? { status: p.status } : {}),
      ...(p.close !== undefined
        ? {
            close: {
              closedAt: Timestamp.fromMillis(p.close.closedAtMs),
              reason: p.close.reason ?? existing.close?.reason,
            },
          }
        : {}),
      // Auction.updatedAt stays Firestore Timestamp (IO-layer), not mechanics updatedAtMs
      updatedAt: Timestamp.now(),
    },
    `Auction:${existing.listingId}/${existing.id}:applyPatchMeta`
  );

  return next;
}

export class AuctionStateRepo {
  constructor(private readonly db: Firestore) {}

  async getState(listingId: string, auctionId: string): Promise<AuctionState | null> {
    const snap = await this.db.doc(auctionStatePath(listingId, auctionId)).get();
    if (!snap.exists) return null;
    return parseOrThrow(AuctionStateSchema, snap.data(), `AuctionState:${listingId}/${auctionId}:read`);
  }

  /**
   * Create initial state (used when auction is created).
   * Not called by orchestration yet (no endpoints in Module 03).
   */
  async createInitialState(args: {
    listingId: string;
    auctionId: string;
    startPriceCents: number;
    nowMs: number;
  }): Promise<AuctionState> {
    const doc: AuctionState = parseOrThrow(
      AuctionStateSchema,
      {
        listingId: args.listingId,
        auctionId: args.auctionId,
        version: 0,
        updatedAtMs: args.nowMs,
        pricing: {
          startPriceCents: args.startPriceCents,
          currentPriceCents: args.startPriceCents,
        },
        proxy: {
          highBidderUid: null,
          highBidderMaxCents: null,
          secondHighestMaxCents: null,
        },
      },
      `AuctionState:${args.listingId}/${args.auctionId}:createInitial`
    );

    await this.db.doc(auctionStatePath(args.listingId, args.auctionId)).set(doc, { merge: false });
    return doc;
  }

  /**
   * Transactional apply:
   * - reads Auction + AuctionState
   * - enforces expectedVersion on AuctionState.version
   * - applies mechanics patch to AuctionState
   * - updates Auction meta fields (status/close) if patch includes them
   */
  async applyMechanicsPatch(args: {
    listingId: string;
    auctionId: string;
    preconditions: Preconditions;
    patch: AuctionPatch;
    nowMs: number;
  }): Promise<{ auction: Auction; state: AuctionState }> {
    const listingId = args.listingId;
    const auctionId = args.auctionId;
    const pre = PreconditionsSchema.parse(args.preconditions);
    const patch = AuctionPatchSchema.parse(args.patch);
    const nowMs = args.nowMs;

    if (pre.auctionId !== auctionId) {
      throw new RepoError("PRECONDITION_FAILED", "Precondition auctionId mismatch", {
        preconditionAuctionId: pre.auctionId,
        auctionId,
      });
    }

    const auctionRef = this.db.doc(auctionPath(listingId, auctionId));
    const stateRef = this.db.doc(auctionStatePath(listingId, auctionId));

    try {
      const out = await this.db.runTransaction(async (tx) => {
        const [aSnap, sSnap] = await Promise.all([tx.get(auctionRef), tx.get(stateRef)]);

        if (!aSnap.exists) throw new RepoError("NOT_FOUND", `Auction not found: ${listingId}/${auctionId}`);
        if (!sSnap.exists) throw new RepoError("NOT_FOUND", `AuctionState not found: ${listingId}/${auctionId}`);

        const auction = parseOrThrow(AuctionSchema, aSnap.data(), `Auction:${listingId}/${auctionId}:txRead`);
        const state = parseOrThrow(AuctionStateSchema, sSnap.data(), `AuctionState:${listingId}/${auctionId}:txRead`);

        if (state.version !== pre.expectedVersion) {
          throw new RepoError("VERSION_CONFLICT", "AuctionState version mismatch", {
            expectedVersion: pre.expectedVersion,
            currentVersion: state.version,
          });
        }

        const nextState = applyPatchToState(state, patch, nowMs);
        tx.set(stateRef, nextState, { merge: false });

        // keep Auction doc query-friendly but consistent for status/close
        const nextAuction = applyPatchToAuction(auction, patch);
        tx.set(auctionRef, nextAuction, { merge: false });

        return { auction: nextAuction, state: nextState };
      });

      return out;
    } catch (e: any) {
      if (e instanceof RepoError) throw e;
      throw new RepoError("REPOSITORY_ERROR", "Failed to apply auction mechanics patch", { cause: e });
    }
  }
}
