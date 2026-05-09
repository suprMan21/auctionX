#!/usr/bin/env bash
# Inject secrets from 1Password (business account only) into .env files.
# Usage: ./scripts/inject-secrets.sh [--dry-run]
#
# Requires:
#   - op CLI v2+ installed and authenticated
#   - .op-account file in project root containing the business account shorthand
#   - .env.op template files in each directory
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ACCOUNT_FILE="$PROJECT_ROOT/.op-account"
DRY_RUN="${1:-}"

if [[ ! -f "$ACCOUNT_FILE" ]]; then
  echo "ERROR: .op-account not found at $ACCOUNT_FILE"
  echo "Run: echo 'kyniteinc.1password.ca' > .op-account"
  exit 1
fi

OP_ACCOUNT=$(cat "$ACCOUNT_FILE")
echo "Using 1Password account: $OP_ACCOUNT"

if ! op account get --account "$OP_ACCOUNT" &>/dev/null; then
  echo "ERROR: Not signed in to $OP_ACCOUNT"
  echo "Run: op signin --account $OP_ACCOUNT"
  exit 1
fi

inject() {
  local src="$1"
  local dest="$2"
  echo "  $src → $dest"
  if [[ "$DRY_RUN" != "--dry-run" ]]; then
    op inject --in-file "$src" --out-file "$dest" --account "$OP_ACCOUNT" --force
  fi
}

echo ""
echo "Injecting secrets from AM_Development vault..."
inject "$PROJECT_ROOT/backend/.env.op"        "$PROJECT_ROOT/backend/.env"
inject "$PROJECT_ROOT/frontend/.env.op"       "$PROJECT_ROOT/frontend/.env.local"
inject "$PROJECT_ROOT/supabase/.env.local.op" "$PROJECT_ROOT/supabase/.env.local"
inject "$PROJECT_ROOT/scripts/.env.op"        "$PROJECT_ROOT/scripts/.env"

echo ""
if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "Dry run complete — no files written."
else
  echo "Done. Real .env files written (gitignored). Do not commit them."
fi
