#!/usr/bin/env bash
# One-time migration: reads existing .env files and creates items in 1Password
# Run from project root: ./scripts/migrate-to-1password.sh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OP_ACCOUNT=$(cat "$PROJECT_ROOT/.op-account")
VAULT="AM_Development"

echo "Migrating secrets to 1Password"
echo "  Account: $OP_ACCOUNT"
echo "  Vault:   $VAULT"
echo ""

# Source env files into subshells to avoid polluting this shell
source "$PROJECT_ROOT/backend/.env" 2>/dev/null || true
source "$PROJECT_ROOT/supabase/.env.local" 2>/dev/null || true
source "$PROJECT_ROOT/scripts/.env" 2>/dev/null || true

# Helper: create item, skip if already exists
create_item() {
  local title="$1"
  shift
  if op item get "$title" --vault "$VAULT" --account "$OP_ACCOUNT" &>/dev/null; then
    echo "  SKIP (exists): $title"
  else
    echo "  CREATE: $title"
    op item create \
      --category "API Credential" \
      --title "$title" \
      --vault "$VAULT" \
      --account "$OP_ACCOUNT" \
      "$@"
  fi
}

echo "--- Supabase Staging ---"
create_item "Supabase Staging" \
  "url[text]=$SUPABASE_URL" \
  "anon-key[password]=$SUPABASE_ANON_KEY" \
  "service-role-key[password]=$SUPABASE_SERVICE_ROLE_KEY" \
  "project-id[text]=pmlofthmobglcfkqjtru" \
  "db-password[password]=FILL_IN_FROM_SUPABASE_DASHBOARD"

echo ""
echo "--- AWS AuctionX Media ---"
create_item "AWS AuctionX Media" \
  "access-key-id[text]=$AWS_ACCESS_KEY_ID" \
  "secret-access-key[password]=$AWS_SECRET_ACCESS_KEY" \
  "region[text]=$AWS_REGION" \
  "s3-bucket[text]=$S3_BUCKET_NAME"

echo ""
echo "--- Postmark API ---"
create_item "Postmark API" \
  "server-token[password]=FILL_IN_FROM_POSTMARK_DASHBOARD" \
  "from-email[text]=noreply@authentic-materials.com"

echo ""
echo "--- Stripe ---"
create_item "Stripe" \
  "secret-key[password]=$STRIPE_SECRET_KEY" \
  "webhook-secret[password]=$STRIPE_WEBHOOK_SECRET" \
  "publishable-key[text]=FILL_IN_FROM_STRIPE_DASHBOARD"

echo ""
echo "--- Pinata (IPFS) ---"
create_item "Pinata" \
  "jwt[password]=$PINATA_JWT" \
  "gateway-url[text]=$PINATA_GATEWAY_URL"

echo ""
echo "--- Base Network ---"
create_item "Base Network" \
  "minter-private-key[password]=$MINTER_PRIVATE_KEY" \
  "rpc-url[text]=$BASE_RPC_URL" \
  "testnet-rpc-url[text]=$BASE_TESTNET_RPC_URL" \
  "nft-contract-address[text]=$NFT_CONTRACT_ADDRESS" \
  "chain-id[text]=$CHAIN_ID"

echo ""
echo "--- App Secrets ---"
create_item "App Secrets" \
  "settle-secret[password]=$SETTLE_SECRET" \
  "test-user-password[password]=$PLAYWRIGHT_TEST_PASSWORD" \
  "admin-password[password]=$PLAYWRIGHT_ADMIN_PASSWORD"

echo ""
echo "--- Third Party APIs ---"
create_item "Third Party APIs" \
  "notion-api-key[password]=$NOTION_API_KEY" \
  "anthropic-api-key[password]=FILL_IN_FROM_ANTHROPIC_CONSOLE"

echo ""
echo "Done. Check AM_Development vault for items marked FILL_IN_*"
echo "Fields to fill in manually:"
echo "  - Supabase Staging / db-password"
echo "  - Postmark API / server-token"
echo "  - Stripe / publishable-key"
echo "  - Third Party APIs / anthropic-api-key"
