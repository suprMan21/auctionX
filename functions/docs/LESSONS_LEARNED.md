# Lessons Learned

## Module 08 — Payouts, Fees & Taxes
- Prefer deterministic identifiers (payoutId = settlementId) to avoid secondary indexes and cross-module coupling.
- Avoid schema guessing in gates: query for authoritative documents (latest SETTLED settlement) rather than deriving IDs.
- Persist fee/tax snapshots at payout creation to support dispute/reversal math later without recomputation drift.
- Keep provider concerns out of domain: payout release is recorded at domain level; provider integrations belong in adapters.
## Module 08 — Payouts, Fees & Taxes
- Prefer deterministic identifiers (payoutId = settlementId) to avoid secondary indexes and cross-module coupling.
- Avoid schema guessing in gates: query for authoritative documents (latest SETTLED settlement) rather than deriving IDs.
- Persist fee/tax snapshots at payout creation to support dispute/reversal math later without recomputation drift.
- Keep provider concerns out of domain: payout release is recorded at domain level; provider integrations belong in adapters.
