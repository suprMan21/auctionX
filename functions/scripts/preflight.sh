#!/usr/bin/env bash
set -euo pipefail

./scripts/runWithSpinner.sh npm run build

export SKIP_BUILD=1
exec npx ts-node ./scripts/preflightGate.ts
