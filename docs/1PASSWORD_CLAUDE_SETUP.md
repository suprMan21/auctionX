# 1Password CLI — One-Auth-Per-Dev-Session for Claude Code

**Goal:** one Touch ID prompt per terminal you spend the day in, instead of one per `op` call.

## How it works

`op signin` exports a `OP_SESSION_<account>` env var into the current shell.
Anything launched from that shell — including Claude Code, and every `Bash`
subshell Claude itself spawns — inherits the env var. While the session is
valid (~30 min idle, auto-refreshed on each use), `op` calls reuse it without
prompting.

**No tokens are stored on disk** — the token lives only in the shell process's
environment. **The script also registers an `EXIT` trap** that runs
`op signout` when the shell exits, actively revoking the server-side session
at 1Password (so an orphaned token can't be replayed within the 30-min idle
window). Close terminal → session is gone everywhere, immediately.

Caveat: a force-kill (`kill -9` of the shell, hard reboot) bypasses traps, so
the token will sit server-side until the 30-min idle timeout naturally expires.

---

## One-time prerequisite — 1Password 8 desktop settings

Open **1Password 8 → ⌘, → Developer**:

- ✅ **"Connect with 1Password CLI"** — ON (probably already is)
- ❌ **"Always require Touch ID when accessing the CLI"** (or similar wording) —
  **OFF**. If this is on, every `op` call demands biometric regardless of
  session state and the session-token approach won't help.

**Settings → Security → Auto-lock:** set to **"After Mac sleeps"** or
**"After 1 hour of inactivity"**. Aggressive auto-lock will invalidate the
1Password vault unlock and indirectly kill `op` sessions.

Quit and relaunch 1Password 8 after changing these.

---

## Daily workflow

```bash
cd /Volumes/myDev_Drive/Dev/dev/projectClaude/unmentionables/Unmen

# 1) Source the session helper — one Touch ID prompt
source scripts/op-claude-session.sh

# 2) Launch Claude Code from the same terminal (inherits OP_SESSION_*)
claude
```

That's it. For the rest of the shell's lifetime, `op` calls (Claude's, yours,
`npm run dev`, `./scripts/inject-secrets.sh`) reuse the cached session.

### Optional zsh alias

Add to `~/.zshrc`:

```bash
alias cc-auctionx-op='cd /Volumes/myDev_Drive/Dev/dev/projectClaude/unmentionables/Unmen && source scripts/op-claude-session.sh && claude'
```

Then daily: just `cc-auctionx-op`.

---

## Verification

After sourcing the script:

```bash
# 1) Session token is exported in current shell
env | grep OP_SESSION_   # should show OP_SESSION_<something>=<token>

# 2) Five back-to-back op reads — only the first should prompt (or none at all)
for i in 1 2 3 4 5; do
  op read "op://AM_Development/Supabase Staging/url" >/dev/null && echo "ok $i"
done

# 3) End-to-end through op run
cd frontend && npm run dev    # boots Vite with no per-call prompts
```

If step 2 prompts on every iteration, the desktop integration is overriding
the session token — re-check the **Developer → "Always require Touch ID for
CLI"** setting above.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `op signin` returns silently, no `OP_SESSION_*` exported | Desktop integration is intercepting auth | Disable "Always require Touch ID for CLI" in 1Password Developer settings; consider toggling "Connect with 1Password CLI" off briefly to test the pure session-token path |
| Touch ID still prompts on every `op` call after sourcing | Same as above, OR vault auto-locked between calls | Increase auto-lock interval in Security settings |
| Claude Code doesn't see the session | Claude was launched from a different terminal than the one that sourced the script | Always launch `claude` from the same shell that ran `source scripts/op-claude-session.sh` |
| Session works for an hour then breaks | 30-min idle timeout hit | Re-source the script. Sessions auto-refresh on use; long idle gaps drop them |
| `op whoami` shows you signed in but session token isn't being used | `op` is preferring desktop integration over the env var | Set `OP_BIOMETRIC_UNLOCK_ENABLED=false` in the shell before re-sourcing (treats CLI as if desktop integration is off for this shell only) |

---

## Why not a permanent service account token?

Considered and rejected per Boss's preference: he'd rather re-auth once per
dev session than have a long-lived token sitting in macOS Keychain. The
session-token approach gives:

- Zero on-disk persistence (token dies with the shell)
- No keychain provisioning, no token rotation, no admin work in 1Password.com
- Same security posture as Boss's manual `op signin` workflow — just made
  ergonomic for Claude Code's many-Bash-calls-per-task pattern

If you ever want the zero-prompts-ever path, see the original plan
(`/Users/chris/.claude/plans/adding-the-1password-cli-refactored-iverson.md`,
"Tier 2") for the service account variant.
