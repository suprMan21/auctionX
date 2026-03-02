/**
 * @module Module 02 Port — Auction Mechanics
 * Auction-mechanics error types and Result<T> helpers.
 * Ported from functions/src/v1/services/auctions/auction.errors.ts
 */

export type AuctionErrorCode =
  | "AUCTION_NOT_SCHEDULED"
  | "AUCTION_NOT_RUNNING"
  | "AUCTION_ALREADY_TERMINAL"
  | "AUCTION_NOT_STARTED_YET"
  | "AUCTION_ALREADY_ENDED"
  | "BID_TOO_LOW"
  | "BIDDER_MAX_DECREASE"
  | "BID_BELOW_START_PRICE"
  | "BID_MUST_BE_AT_LEAST_NEXT_INCREMENT"
  | "INVALID_TIME_WINDOW"
  | "INVARIANT_VIOLATION";

/** Domain error thrown by auction mechanics pure functions. */
export class AuctionMechanicsError extends Error {
  public readonly code: AuctionErrorCode;
  public readonly details?: unknown;

  constructor(code: AuctionErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: AuctionMechanicsError };
export type Result<T> = Ok<T> | Err;

/** Wrap a success value in Result<T>. */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
/** Wrap an error in Result<T>. */
export const err = (error: AuctionMechanicsError): Err => ({ ok: false, error });
