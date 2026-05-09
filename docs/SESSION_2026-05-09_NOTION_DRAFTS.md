# Notion Drafts — 2026-05-09 Session
# 1Password Secret Management + Postmark Migration

> Paste these into the corresponding Notion DBs once Notion MCP OAuth is complete (or do it manually via browser).
> Workspace IDs: Lessons `collection://dae3b391-3163-4fd0-9eee-586d923415d1` · Decisions `collection://83f2eb51-f6a0-49ee-9541-3a93ce857c24`

---

## LESSONS LEARNED DB — 5 entries

### Lesson 1: Reuse existing 1Password vaults before creating new ones
- **Category:** Infrastructure / Secrets
- **Severity:** Low
- **Review Priority:** Module Start
- **Wrong Approach:** Plan called for creating a new `AuctionX` vault; would have fragmented secrets across two vaults in the same project.
- **Right Approach:** Run `op vault list --account <business>` before creating. The existing `AM_Development` vault already had a Postmark-related item — adopting it kept all project secrets in one place and avoided duplicate access management.
- **Why it matters:** Vault sprawl makes access auditing harder and creates ambiguity ("which vault for X?"). One vault per project is the right granularity for a small team.

### Lesson 2: 1Password CLI v2 has no separate "Environments" product — `.env.op` files ARE the environment
- **Category:** Infrastructure / Secrets
- **Severity:** Medium
- **Review Priority:** Module Start
- **Wrong Approach:** Searching for a 1Password "Environments" feature analogous to GitHub Environments or Vercel envs — looking for `op env create` to make a named secret group.
- **Right Approach:** In op CLI v2, `op env list` only lists `op://` references already in shell. Secrets live as **vault items** with named fields. `.env.op` template files (with `op://vault/item/field` references) are committed to git and serve as the "environment definition." `op inject` or `op run --env-file` resolves them at use.
- **Why it matters:** Confusion about this wasted ~10 min during planning. The vault-items + template-file pattern is the correct approach for 1Password CLI; don't search for a different product.

### Lesson 3: `.env.*` gitignore patterns silently block `.env.op` template files
- **Category:** DevOps / Git
- **Severity:** High (would have caused empty git pushes if not caught)
- **Review Priority:** Every Session
- **Wrong Approach:** Ship `.env.op` files expecting them to be tracked when root + frontend `.gitignore` already has `.env.*`.
- **Right Approach:** Add a negative pattern `!.env.op` (and `!.env.local.op`) AFTER the catch-all. Verify with `git check-ignore -v <file>` before committing.
- **Why it matters:** Templates with `op://` references are **safe** to commit (no real secrets) and **must** be committed for the workflow to work. A silent block breaks the team workflow without any error.

### Lesson 4: Sourcing local `.env` files for migration scripts can pull in localhost overrides
- **Category:** DevOps / Migration
- **Severity:** Medium
- **Review Priority:** As Needed
- **Wrong Approach:** `source backend/.env && op item create ... "url=$SUPABASE_URL"` — pulled in the local-dev URL `http://127.0.0.1:54321` instead of the staging URL.
- **Right Approach:** After migration, **always spot-check resolved values** in 1Password (or `op item get` the URL field) and override hardcoded values that should be environment-specific (e.g., staging URLs explicitly hardcoded in the script).
- **Why it matters:** Silent wrong values in 1Password propagate to every developer who later runs `op inject` — much worse than a missing field that errors loudly.

### Lesson 5: Supabase migrations don't require the DB password — MCP `apply_migration` uses OAuth
- **Category:** Database / Supabase
- **Severity:** Low (but unblocking)
- **Review Priority:** Every Session
- **Wrong Approach:** Wait for `SUPABASE_DB_PASSWORD` to apply migrations via `supabase db push` CLI — blocks all schema work until the password is recovered/reset.
- **Right Approach:** Use the Supabase MCP `mcp__plugin_supabase_supabase__apply_migration` tool. Authenticates via OAuth, no DB password needed. Already proven working in Session D close-out.
- **Why it matters:** The DB password is now genuinely optional for routine work — only needed for direct `psql` shell or `pg_dump`. Don't store it in 1Password unless you specifically need shell-level DB access.

---

## DECISIONS DB — 3 entries

### Decision 1: 1Password (`AM_Development` vault, kyniteinc.1password.ca) is the project's dev secret store
- **Status:** Locked
- **Category:** Infrastructure
- **Impact:** All developers, all local-dev workflows, future CI integration
- **Review Priority:** Every Session
- **Rationale:**
  - Plain `.env` files on disk are unencrypted and grow stale across machines
  - Boss's business 1Password account already exists with the right vault
  - `op run` is the standard, well-supported pattern for injecting secrets into dev processes
  - Eliminates the "secret drift" problem when Boss switches machines
- **Alternatives Considered:**
  - **AWS Secrets Manager** — overkill for dev; adds cloud dependency for local work
  - **Doppler / Infisical** — paid SaaS, another vendor to manage
  - **Plain `.env` files** — current state, the problem we're solving
  - **1Password Environments product** — doesn't exist as separate feature in op CLI v2 (see Lesson 2)
- **Implications:**
  - Production secrets stay in their respective platforms (AWS App Runner env vars, Supabase Edge Function secrets dashboard) — 1Password is for **dev** only
  - All new secrets MUST be added to `AM_Development` vault and referenced in the relevant `.env.op` file before they can be consumed
  - Each dev creates their own `.op-account` file (gitignored) pointing to `kyniteinc.1password.ca` — prevents accidental personal-vault use

### Decision 2: Postmark replaces Resend for transactional email
- **Status:** Locked
- **Category:** Technical
- **Impact:** All transactional email flows (auction won, outbid, payment received, escrow released, messaging notifications, etc.)
- **Review Priority:** Module Start
- **Rationale:**
  - Boss already has a Postmark account set up (login was already in 1Password vault before this session)
  - `RESEND_API_KEY` was referenced in code but `emailSender.ts` was a log-only stub — no actual Resend integration to migrate, just stub-to-Postmark
  - Postmark has stronger transactional-email reputation (deliverability, bounce handling)
- **Alternatives Considered:**
  - **Resend** — what the stub mentioned; Boss never set up an account
  - **AWS SES** — cheap but harder to configure; would have required extra AWS setup
  - **SendGrid / Mailgun** — no existing account
- **Implications:**
  - Backend depends on `postmark@4.0.7` package
  - `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM_EMAIL` env vars required (1Password-managed)
  - Email gracefully degrades when token is missing (logs warning, returns false) — auction flows are not blocked

### Decision 3: Notion MCP installed at user scope (hosted, OAuth)
- **Status:** Locked
- **Category:** Infrastructure
- **Impact:** All future Claude Code sessions across all projects
- **Review Priority:** As Needed
- **Rationale:**
  - SSOT workflow in CLAUDE.md depends on Notion MCP tools (`notion-fetch`, `notion-update-page`, etc.)
  - Hosted MCP at `https://mcp.notion.com/mcp` matches the same pattern as the already-working figma + supabase MCPs
  - User-scope availability means any Claude Code project can read/write the Notion SSOT databases
- **Alternatives Considered:**
  - **Local stdio (`@notionhq/notion-mcp-server` + NOTION_API_KEY)** — would work but requires version maintenance and uses long-lived API key instead of OAuth
  - **Project-scope only** — limits utility; the Notion SSOT spans every project
  - **Skip Notion MCP, manual paste** — what was happening this session; not sustainable
- **Implications:**
  - Boss must complete OAuth flow on next session (one-time browser auth)
  - Future sessions can directly write Lessons Learned + Decisions entries instead of drafting markdown
  - Auto-trigger rule from CLAUDE.md (`notion-librarian` after every write) becomes meaningful again
