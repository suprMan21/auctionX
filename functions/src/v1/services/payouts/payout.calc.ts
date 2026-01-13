import { FeeQuote, TaxQuote } from "../../schemas/domain/payout.schema";

function roundDiv(n: number, d: number) {
  return Math.round(n / d);
}

export function calcFeeQuote(args: {
  grossAmountCents: number;
  platformFeeBps: number;
  platformFeeFixedCents: number;
  rulesetVersion: string;
}): FeeQuote {
  const { grossAmountCents, platformFeeBps, platformFeeFixedCents, rulesetVersion } = args;

  const percent = roundDiv(grossAmountCents * platformFeeBps, 10000);
  const platformFeeCents = Math.max(0, percent + platformFeeFixedCents);

  return {
    rulesetVersion,
    platformFeeBps,
    platformFeeFixedCents,
    platformFeeCents,
  };
}

export function calcTaxQuote(args: {
  grossAmountCents: number;
  platformFeeCents: number;
  jurisdictionCode: string | null;
  sellerWithholdingBps: number;
  platformFeeTaxBps: number;
  rulesetVersion: string;
}): TaxQuote {
  const {
    grossAmountCents,
    platformFeeCents,
    jurisdictionCode,
    sellerWithholdingBps,
    platformFeeTaxBps,
    rulesetVersion,
  } = args;

  const sellerWithheldCents = Math.max(0, roundDiv(grossAmountCents * sellerWithholdingBps, 10000));
  const platformFeeTaxCents = Math.max(0, roundDiv(platformFeeCents * platformFeeTaxBps, 10000));

  return {
    rulesetVersion,
    jurisdictionCode,
    sellerWithholdingBps,
    sellerWithheldCents,
    platformFeeTaxBps,
    platformFeeTaxCents,
  };
}

export function calcNetAmountCents(args: {
  grossAmountCents: number;
  platformFeeCents: number;
  sellerWithheldCents: number;
}): number {
  const { grossAmountCents, platformFeeCents, sellerWithheldCents } = args;
  return Math.max(0, grossAmountCents - platformFeeCents - sellerWithheldCents);
}
