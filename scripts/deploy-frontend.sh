#!/usr/bin/env bash
# Build and deploy one of the two frontends. They are separate sites:
#
#   staging   the whole app   → s3://auctionx-frontend-staging  (CloudFront E3JOPXHI8DB4BE)
#   public    landing only    → s3://am-frontend-prod-904183418667           (CloudFront E35K71RCQGYBAW,
#                                                                 authentic-materials.com)
#
# Usage:  scripts/deploy-frontend.sh staging|public [--dry-run]
#         --dry-run builds and runs every check, then prints the AWS commands instead of running them.
#
# The `auctionx` profile resolves its key through the 1Password shell plugin, which a
# script does not inherit as an alias, so AWS is called as `op plugin run -- aws`.
# Override with AWS_CMD="aws" if your credentials come from somewhere else.
#
# Setup for the public site (one time): infra/s3/am-frontend-prod-904183418667/README.md

set -euo pipefail

TARGET="${1:-}"
DRY_RUN="${2:-}"
PROFILE=auctionx
AWS_CMD="${AWS_CMD:-op plugin run -- aws}"
STAGING_BUCKET=auctionx-frontend-staging
STAGING_DIST_ID=E3JOPXHI8DB4BE
PUBLIC_BUCKET=am-frontend-prod-904183418667
PUBLIC_DIST_ID=E35K71RCQGYBAW
PUBLIC_URL=https://authentic-materials.com

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

aws_() {
  if [ "$DRY_RUN" = "--dry-run" ]; then echo "  [dry-run] aws --profile $PROFILE $*"; return 0; fi
  $AWS_CMD --profile "$PROFILE" "$@"
}

# Hashed assets never change, so cache them for a year; index.html and the other
# root files are what a deploy changes, so they are never cached by browsers.
sync_site() {
  local dir="$1" bucket="$2"
  aws_ s3 sync "$dir/assets/" "s3://$bucket/assets/" --delete --cache-control "public,max-age=31536000,immutable"
  aws_ s3 sync "$dir/" "s3://$bucket/" --delete --exclude "assets/*" --cache-control "no-cache"
}

invalidate() { aws_ cloudfront create-invalidation --distribution-id "$1" --paths '/*' --query 'Invalidation.Id' --output text; }

# S-MOB1: the Apple association file has no extension, so `s3 sync` would store
# it as binary/octet-stream; iOS needs application/json. Re-upload it with the
# right type after every sync (assetlinks.json is typed from its extension).
put_well_known() {
  local dir="$1" bucket="$2"
  aws_ s3 cp "$dir/.well-known/apple-app-site-association" "s3://$bucket/.well-known/apple-app-site-association" \
    --content-type application/json --cache-control "max-age=3600"
}

# Both files must come back as real JSON (HTTP 200, no redirect), not the site's
# HTML fallback, or passkeys and "Open the app" silently stop working.
check_well_known() {
  local base="$1"
  [ "$DRY_RUN" = "--dry-run" ] && { echo "  [dry-run] would check $base/.well-known/*"; return 0; }
  for f in apple-app-site-association assetlinks.json; do
    local status type
    read -r status type < <(curl -s -o /dev/null -m 15 -w '%{http_code} %{content_type}' "$base/.well-known/$f")
    if [ "$status" != "200" ] || [[ "$type" != application/json* ]]; then
      echo "⚠ $base/.well-known/$f answered $status $type (want 200 application/json). Wait for the invalidation and re-check."
    else
      echo "✓ $base/.well-known/$f"
    fi
  done
}

case "$TARGET" in
  staging)
    npm run build
    grep -lq "pk_test_" dist/assets/*.js || { echo "✗ no Stripe test key in the build (frontend/.env.production missing?)"; exit 1; }
    sync_site dist "$STAGING_BUCKET"
    put_well_known dist "$STAGING_BUCKET"
    invalidate "$STAGING_DIST_ID"
    echo "✓ staging deployed: https://d1bwev65w7rqzl.cloudfront.net"
    check_well_known https://d1bwev65w7rqzl.cloudfront.net
    ;;

  public)
    npm run build:public
    # The public bundle must hold no app code or key of any kind, and only ONE backend
    # address: the early-access signup (Decisions DB, Locked 2026-10-28; publicSite.test.ts).
    if LEAKS=$(grep -rlE 'supabase|pk_test_|pk_live_|stripe' dist-public); then
      echo "✗ app code or keys found in the public build:"; echo "$LEAKS"; exit 1
    fi
    ALLOWED_API='vw7zy9mkyg.us-east-2.awsapprunner.com'
    API_HOSTS=$(grep -rhoE '[A-Za-z0-9.-]*awsapprunner\.com[A-Za-z0-9/._-]*' dist-public | sort -u)
    if [ -n "$API_HOSTS" ] && [ "$API_HOSTS" != "$ALLOWED_API/api/v1/early-access" ]; then
      echo "✗ unexpected backend address in the public build (only the signup is allowed):"; echo "$API_HOSTS"; exit 1
    fi
    sync_site dist-public "$PUBLIC_BUCKET"
    put_well_known dist-public "$PUBLIC_BUCKET"
    invalidate "$PUBLIC_DIST_ID"
    if [ "$DRY_RUN" != "--dry-run" ]; then
      BUILT=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist-public/index.html)
      echo "✓ uploaded. Checking $PUBLIC_URL for $BUILT every 10s, up to 5 minutes (Ctrl-C is safe: the upload is done)"
      for i in $(seq 1 30); do
        LIVE=$(curl -fsS -m 10 "$PUBLIC_URL/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' || true)
        [ "$LIVE" = "$BUILT" ] && { echo "✓ public site live: $PUBLIC_URL"; check_well_known "$PUBLIC_URL"; exit 0; }
        echo "  $i/30: still serving ${LIVE:-nothing}"
        sleep 10
      done
      echo "✗ $PUBLIC_URL still serves ${LIVE:-nothing} after 5 minutes. Is its origin $PUBLIC_BUCKET yet?"; exit 1
    fi
    ;;

  *)
    echo "usage: scripts/deploy-frontend.sh staging|public [--dry-run]"; exit 2
    ;;
esac
