#!/usr/bin/env bash
# After `git push origin dev`: confirm App Runner actually started a deployment.
#
# Why: on 2026-10-09 two pushes were silently ignored and one was dropped because a
# settings update was running at the same moment (App Runner runs one operation at a
# time and does not queue a push). Pushes are NOT a guaranteed deploy.
#
# Usage:  scripts/verify-backend-deploy.sh [profile]      (default profile: claude-ro)
# Exit 0 = a deployment started after you ran this and SUCCEEDED; non-zero otherwise.

set -euo pipefail
PROFILE="${1:-claude-ro}"
REGION=us-east-2
SERVICE=auctionX_backend_staging
WAIT_START_SECS=150     # how long to wait for a push to trigger a deployment
WAIT_DONE_SECS=900      # how long a deployment may take

aws_() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }

ARN=$(aws_ apprunner list-services --query "ServiceSummaryList[?ServiceName=='$SERVICE'].ServiceArn" --output text)
[ -n "$ARN" ] || { echo "✗ service $SERVICE not found"; exit 2; }

latest() { aws_ apprunner list-operations --service-arn "$ARN" --max-results 1 \
  --query 'OperationSummaryList[0].[Id,Type,Status]' --output text; }

# A deployment that started in the last 3 minutes counts (you may run this a
# little after pushing); otherwise wait for a new one.
started_recently() {
  local started; started=$(aws_ apprunner list-operations --service-arn "$ARN" --max-results 1 \
    --query 'OperationSummaryList[0].StartedAt' --output text)
  local epoch; epoch=$(date -j -f '%Y-%m-%dT%H:%M:%S' "${started:0:19}" +%s 2>/dev/null || date -d "$started" +%s)
  [ $(( $(date +%s) - epoch )) -le 180 ]
}

read -r BEFORE _ _ < <(latest)
if started_recently; then BEFORE=""; fi
echo "Waiting up to ${WAIT_START_SECS}s for a new deployment of ${SERVICE}…"
for ((t = 0; t < WAIT_START_SECS; t += 10)); do
  read -r ID TYPE STATUS < <(latest)
  if [ "$ID" != "$BEFORE" ]; then break; fi
  sleep 10
done

if [ "$ID" = "$BEFORE" ]; then
  echo "✗ No deployment started. The push did not trigger App Runner."
  echo "  → App Runner console → $SERVICE → Deploy (or: aws apprunner start-deployment --profile auctionx ...)"
  echo "  → Also check App Runner → GitHub connections → status 'Available'."
  exit 1
fi

echo "→ $TYPE started (${ID}). Waiting for it to finish…"
for ((t = 0; t < WAIT_DONE_SECS; t += 15)); do
  read -r _ TYPE STATUS < <(latest)
  case "$STATUS" in
    SUCCEEDED) echo "✓ $TYPE SUCCEEDED"; exit 0 ;;
    FAILED|ROLLBACK_*) echo "✗ $TYPE $STATUS"; exit 1 ;;
  esac
  sleep 15
done
echo "✗ still $STATUS after ${WAIT_DONE_SECS}s"; exit 1
