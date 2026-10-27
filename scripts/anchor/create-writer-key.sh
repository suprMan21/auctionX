#!/usr/bin/env bash
# S-ANCHOR1 Ph1 — create the Ownership Registry WRITER key in AWS KMS (staging).
# Not an NFT key: it can only append fingerprints to the registry.
#
# Boss runs this (Claude's AWS access is read-only). Needs an admin CLI profile:
#   AWS_PROFILE=<admin profile> scripts/anchor/create-writer-key.sh
#
# What it makes:
#   - ECC_SECG_P256K1, SIGN_VERIFY, single-Region us-east-2, non-exportable
#   - alias/am-anchor-writer-staging
#   - key policy:
#       * account root: key ADMINISTRATION only (no Sign), so IAM policies can
#         manage the key but cannot grant anyone signing
#       * role/am-backend-staging-instance: Sign (ECDSA_SHA_256, DIGEST only),
#         GetPublicKey, DescribeKey
#       * explicit Deny of kms:Sign to every other principal, admins included
#   - separate from the chip-key (SDM) hierarchy
#
# Then it proves the deny: it tries kms:Sign as YOU and expects AccessDenied.
# Prints the writer address to pass to the registry deploy (REGISTRY_WRITER).
#
# Safe to re-run: if the alias exists it skips creation and re-prints the address.

set -euo pipefail

REGION=us-east-2
ACCOUNT=904183418667
ALIAS=alias/am-anchor-writer-staging
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$HERE/../../backend"

if [[ -z "${AWS_PROFILE:-}" ]]; then
  echo "Set AWS_PROFILE to an admin profile first." >&2
  exit 1
fi
aws_() { command aws --region "$REGION" "$@"; }

caller=$(aws_ sts get-caller-identity --query Arn --output text)
echo "Running as: $caller"
[[ "$caller" == *":${ACCOUNT}:"* ]] || { echo "Wrong account." >&2; exit 1; }

# Use the role's real ARN (with any IAM path), so the Deny can never block the backend itself.
ROLE_ARN=$(aws_ iam get-role --role-name am-backend-staging-instance --query Role.Arn --output text) \
  || { echo "Instance role am-backend-staging-instance not found." >&2; exit 1; }
echo "Backend role: $ROLE_ARN"

if key_id=$(aws_ kms describe-key --key-id "$ALIAS" --query KeyMetadata.KeyId --output text 2>/dev/null); then
  echo "Key already exists: $key_id (skipping creation)"
else
  policy=$(mktemp)
  trap 'rm -f "$policy"' EXIT
  cat > "$policy" <<JSON
{
  "Version": "2012-10-17",
  "Id": "am-anchor-writer-staging",
  "Statement": [
    {
      "Sid": "AccountAdministersButCannotSign",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::${ACCOUNT}:root" },
      "Action": [
        "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*",
        "kms:Update*", "kms:Revoke*", "kms:Disable*", "kms:Get*", "kms:Delete*",
        "kms:TagResource", "kms:UntagResource",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion"
      ],
      "Resource": "*"
    },
    {
      "Sid": "BackendSignsDigestsOnly",
      "Effect": "Allow",
      "Principal": { "AWS": "${ROLE_ARN}" },
      "Action": "kms:Sign",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "kms:SigningAlgorithm": "ECDSA_SHA_256", "kms:MessageType": "DIGEST" }
      }
    },
    {
      "Sid": "BackendReadsPublicKey",
      "Effect": "Allow",
      "Principal": { "AWS": "${ROLE_ARN}" },
      "Action": ["kms:GetPublicKey", "kms:DescribeKey"],
      "Resource": "*"
    },
    {
      "Sid": "NobodyElseSigns",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "kms:Sign",
      "Resource": "*",
      "Condition": { "ArnNotEquals": { "aws:PrincipalArn": "${ROLE_ARN}" } }
    }
  ]
}
JSON

  key_id=$(aws_ kms create-key \
    --key-spec ECC_SECG_P256K1 \
    --key-usage SIGN_VERIFY \
    --description "S-ANCHOR1 Ownership Registry writer (staging, Base Sepolia). Not an NFT key." \
    --policy "file://$policy" \
    --tags TagKey=project,TagValue=authentic-materials TagKey=purpose,TagValue=anchor-writer TagKey=env,TagValue=staging \
    --query KeyMetadata.KeyId --output text)
  aws_ kms create-alias --alias-name "$ALIAS" --target-key-id "$key_id"
  echo "Created key $key_id as $ALIAS"
fi

echo
echo "Proving the deny: trying kms:Sign as $caller (expect AccessDenied)..."
digest=$(printf '%064d' 0 | xxd -r -p | base64)
if out=$(aws_ kms sign --key-id "$ALIAS" --message "$digest" --message-type DIGEST \
    --signing-algorithm ECDSA_SHA_256 --query KeyId --output text 2>&1); then
  echo "FAIL: $caller was able to sign. Do not use this key; fix the policy." >&2
  exit 1
elif [[ "$out" == *AccessDenied* ]]; then
  echo "OK: AccessDenied for $caller."
else
  echo "Unexpected error (not AccessDenied): $out" >&2
  exit 1
fi

echo
spki=$(aws_ kms get-public-key --key-id "$ALIAS" --query PublicKey --output text)
address=$(cd "$BACKEND" && node -e '
  const { publicKeyToAddress } = require("viem/accounts");
  const der = Buffer.from(process.argv[1], "base64");
  const point = der.subarray(der.length - 65);
  if (point[0] !== 4) { console.error("unexpected public key"); process.exit(1); }
  console.log(publicKeyToAddress("0x" + point.toString("hex")));
' "$spki")

key_arn=$(aws_ kms describe-key --key-id "$ALIAS" --query KeyMetadata.Arn --output text)
cat <<OUT

Writer key ARN : $key_arn
Writer address : $address

Next:
  1. Fund $address with a little Base Sepolia ETH (faucet).
  2. Deploy the registry with REGISTRY_WRITER=$address (contracts/scripts/deploy-registry.ts).
  3. App Runner env: ANCHOR_KMS_KEY_ID=$ALIAS
OUT
