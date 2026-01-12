# Future Upgrades Backlog

This file tracks intentional deferrals (planned later) so upgrades are predictable and low-friction.

## Testing

### Jest (unit + orchestration)
- [ ] TODO(TESTING:JEST): Decide Jest strategy: ts-jest vs swc/jest, ESM vs CJS alignment with Node 20.
- [ ] TODO(TESTING:JEST): Add Jest config + baseline test folder structure.
- [ ] TODO(TESTING:JEST): Add unit tests for mechanics (pure functions): proxy repricing, increment rules, tie-break rules.
- [ ] TODO(TESTING:JEST): Add orchestrator tests with repo fakes (no Firestore) for error mapping + logging outcomes.
- [ ] TODO(TESTING:JEST): Add emulator-backed integration tests only if needed (keep minimal).

### Script runner (CI smoke tests)
- [ ] TODO(TESTING:RUNNER): Create a single runner script that executes scenario scripts and asserts outcomes (exit 0/1).
- [ ] TODO(TESTING:RUNNER): Add canonical scenarios: 2 bidders, 3 bidders, tie max, high-bidder increases max, ended auction rejects bids, close then cascade.
- [ ] TODO(TESTING:RUNNER): Ensure runner supports both: manual emulator start AND firebase emulators:exec.
- [ ] TODO(TESTING:RUNNER): Add deterministic “nowMs” injection for repeatable runs.

## CI/CD

- [ ] TODO(CI): Add GitHub Actions job: build + typecheck + emulator smoke runner.
- [ ] TODO(CI): Cache npm deps for functions workspace.
- [ ] TODO(CI): Add artifact upload for firestore-debug.log on failure.

## Emulator + local dev ergonomics

- [ ] TODO(EMULATOR): Add a single “env bootstrap” script (exports + sanity checks).
- [ ] TODO(EMULATOR): Add a “port check” helper to avoid collisions (8080/5002/4400).
- [ ] TODO(EMULATOR): Add Firestore rules file path to firebase.json (currently permissive default).

## Payments / Offer cascade pipeline (future modules)

- [ ] TODO(PAYMENTS): Model offer acceptance/decline + deadlines + retry windows.
- [ ] TODO(PAYMENTS): Persist offer cascade state (who was offered, when, outcome).
- [ ] TODO(PAYMENTS): Ensure cascade price matches proxy rules and is auditable.
