#!/usr/bin/env bash
set -euo pipefail

./scripts/runWithSpinner.sh npm run build

export SKIP_BUILD=1
set -o pipefail
exec npx ts-node ./scripts/postflightGate.ts
