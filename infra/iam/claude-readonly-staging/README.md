# claude-readonly-staging

Read-only, staging-only AWS access for Claude Code sessions, so Claude can read
backend logs and deploy status itself instead of asking Boss to run commands.

## Shape

```
IAM user  claude-readonly-staging   (no console; can ONLY sts:AssumeRole)
   │  access key in 1Password: AM_Development / "AWS - Claude ReadOnly Staging"
   ▼
IAM role  claude-readonly-staging   (1-hour sessions, auto-renewed by the CLI)
   └─ policy ClaudeReadOnlyStaging  (permissions-policy.json)
```

| Can | Cannot (explicit Deny) |
|---|---|
| Read/filter/tail/query `/aws/apprunner/auctionX_backend_staging/*` logs | `apprunner:DescribeService`, because it returns every env var, secrets included, in plaintext |
| `apprunner:ListServices`, `ListOperations` (deploy status) | Any App Runner update, start or delete |
| CloudWatch metrics | `kms:*`, `secretsmanager:*`, `ssm:GetParameter*`, `s3:*`, `iam:*` |
| CloudFront invalidation status for `E3JOPXHI8DB4BE` | Log exports, subscriptions, writes; assuming any further role |

Nothing in production. Production access stays human-only.

## Console setup (Boss, once)

Order matters: the role's trust policy names the user, so the user must exist first.

1. **Policy.** IAM → Policies → Create policy → JSON → paste `permissions-policy.json`.
   Name: `ClaudeReadOnlyStaging`.
2. **User.** IAM → Users → Create user `claude-readonly-staging`. No console access, no groups.
   Then Permissions → Add permissions → Create inline policy → JSON → paste
   `user-assume-policy.json`. Name: `AssumeClaudeReadOnlyStaging`.
3. **Access key.** User → Security credentials → Create access key → "Command Line Interface".
   Save to 1Password, vault `AM_Development`, as an **API Credential** item titled
   `AWS - Claude ReadOnly Staging` (key id + secret access key fields). Do not download the CSV.
4. **Role.** IAM → Roles → Create role → Custom trust policy → paste `trust-policy.json` →
   attach `ClaudeReadOnlyStaging` → name `claude-readonly-staging`. Leave max session at 1 hour.

## Local wiring (Boss, once)

See the session notes for the `~/.aws/config` profiles, the `~/.aws/claude-ro-env-creds.sh`
helper and the `op-claude-session.sh` block. Claude calls the CLI as
`command aws --profile claude-ro ...` (`command` bypasses the 1Password `aws` plugin alias,
which needs Touch ID and cannot run in Claude's shell).

## Audit and revocation

- Every call is in CloudTrail → Event history, filter **User name = `claude-code`**
  (the role session name).
- Kill switch: deactivate the user's access key. Rotate the key quarterly.
- Logs contain PII (recipient emails, admin emails, raw UIDs from `GET /nfc/by-uid`).
  Reading them sends that content to Anthropic. Acceptable for staging test accounts;
  this role must never be extended to production log groups.
