import { MoneyCents } from "./auction.types";

/**
 * Minimum increment schedule (tunable later).
 * Deterministic + pure.
 */
export function minIncrementCents(priceCents: MoneyCents): MoneyCents {
  if (priceCents < 10_00) return 50; // < $10 => $0.50
  if (priceCents < 100_00) return 100; // < $100 => $1
  if (priceCents < 500_00) return 500; // < $500 => $5
  if (priceCents < 2_000_00) return 1_000; // < $2,000 => $10
  if (priceCents < 10_000_00) return 2_500; // < $10,000 => $25
  return 5_000; // >= $10,000 => $50
}

export type ProxyState = {
  highBidderUid: string | null;
  highBidderMaxCents: MoneyCents | null;
  secondHighestMaxCents: MoneyCents | null;
};

export type ProxyRepriceResult = {
  proxy: ProxyState;
  currentPriceCents: MoneyCents;
};

/**
 * Pricing rule:
 * - One bidder => price = startPrice
 * - Two+ bidders => price = min(H, S + inc(S))
 */
export function repriceProxyState(args: {
  startPriceCents: MoneyCents;
  highBidderUid: string | null;
  highBidderMaxCents: MoneyCents | null;
  secondHighestMaxCents: MoneyCents | null;
}): ProxyRepriceResult {
  const { startPriceCents, highBidderUid, highBidderMaxCents, secondHighestMaxCents } = args;

  if (!highBidderUid || highBidderMaxCents == null) {
    return {
      proxy: { highBidderUid: null, highBidderMaxCents: null, secondHighestMaxCents: null },
      currentPriceCents: startPriceCents,
    };
  }

  if (secondHighestMaxCents == null) {
    return {
      proxy: { highBidderUid, highBidderMaxCents, secondHighestMaxCents: null },
      currentPriceCents: startPriceCents,
    };
  }

  const inc = minIncrementCents(secondHighestMaxCents);
  const sPlus = (secondHighestMaxCents + inc) as MoneyCents;
  const price = Math.min(highBidderMaxCents, sPlus) as MoneyCents;

  return {
    proxy: { highBidderUid, highBidderMaxCents, secondHighestMaxCents },
    currentPriceCents: price,
  };
}
