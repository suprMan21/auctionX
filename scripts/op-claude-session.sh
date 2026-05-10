#!/usr/bin/env bash
# Establish a 1Password CLI session AND a GitHub SSH agent for this shell
# (and any children launched from it, including `claude`). One Touch ID prompt
# per dev session — the GitHub SSH key is read from 1Password into a
# session-scoped ssh-agent using the same op session, so no extra prompt.
#
# Daily workflow:
#   $ source scripts/op-claude-session.sh    # one Touch ID
#   $ claude                                  # inherits OP_SESSION_*,
#                                            # SSH_AUTH_SOCK, SSH_AGENT_PID,
#                                            # GIT_SSH_COMMAND
#   # ...all op + git-over-ssh calls Claude makes are auth'd from the session.
#
# 1Password session expires after 30 minutes of inactivity (auto-refreshed).
# ssh-agent persists for the life of this shell.
# Closing the terminal: EXIT trap signs out op AND removes the SSH key + kills
# the agent — no orphaned sockets, no lingering session tokens.
#
# Non-git SSH (e.g. ssh to a server) keeps using the 1Password SSH agent
# configured in ~/.ssh/config. GIT_SSH_COMMAND scopes the bypass to git only.
#
# MUST be sourced, not executed, so the exports reach the caller's shell.

# Detect sourced vs executed (zsh + bash). In zsh, $0 in a sourced file equals
# the script's own name, so the bash trick of comparing $0 to BASH_SOURCE[0]
# doesn't translate — use ZSH_EVAL_CONTEXT instead.
_op_sourced=0
if [[ -n "${ZSH_VERSION:-}" ]]; then
  case "${ZSH_EVAL_CONTEXT:-}" in
    *:file*) _op_sourced=1 ;;
  esac
elif [[ -n "${BASH_VERSION:-}" ]]; then
  [[ "${BASH_SOURCE[0]}" != "${0}" ]] && _op_sourced=1
fi
if [[ "$_op_sourced" != "1" ]]; then
  echo "ERROR: this script must be sourced, not executed:" >&2
  echo "  source scripts/op-claude-session.sh" >&2
  unset _op_sourced
  exit 1
fi
unset _op_sourced

# Resolve project root from this file's location
_op_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
_op_account_file="$(cd "$_op_script_dir/.." && pwd)/.op-account"

if [[ ! -f "$_op_account_file" ]]; then
  echo "ERROR: .op-account not found at $_op_account_file" >&2
  unset _op_script_dir _op_account_file
  return 1
fi

_op_account="$(cat "$_op_account_file")"

echo "Signing in to 1Password ($_op_account)..."
if ! eval "$(op signin --account "$_op_account")"; then
  echo "ERROR: op signin failed for $_op_account" >&2
  unset _op_script_dir _op_account_file _op_account
  return 1
fi

# Confirm a session is actually active before doing anything that depends on it
if ! op whoami --account "$_op_account" >/dev/null 2>&1; then
  echo "WARNING: signin returned but 'op whoami' failed. If 1Password 8 desktop" >&2
  echo "integration is enabled, disable 'Always require Touch ID for CLI' in" >&2
  echo "Settings -> Developer, then re-source this script." >&2
  unset _op_script_dir _op_account_file _op_account
  return 1
fi

# --- GitHub SSH session-scoped agent ---------------------------------------
# The GitHub SSH key lives in 1Password (vault AM_Development). We read it
# into a fresh, session-scoped ssh-agent here, so git-over-ssh inherits auth
# for the whole session without further Touch ID prompts. ~/.ssh/config has
# `Host * IdentityAgent <1password-socket>` which would otherwise override
# SSH_AUTH_SOCK — GIT_SSH_COMMAND scopes the override to git only.

# Persist for the EXIT trap function (must outlive script return)
_op_amcode_account="$_op_account"
_op_amcode_github_ref='op://AM_Development/qvtkkfrb5f7zfdpmnsiqpjqcju/private key?ssh-format=openssh'

# Re-source safety: kill any agent we previously spawned in this shell
if [[ -n "${SSH_AGENT_PID:-}" ]] && kill -0 "$SSH_AGENT_PID" 2>/dev/null; then
  ssh-add -D >/dev/null 2>&1 || true
  kill "$SSH_AGENT_PID" >/dev/null 2>&1 || true
  unset SSH_AUTH_SOCK SSH_AGENT_PID
fi

echo "Starting session-scoped ssh-agent for GitHub..."
if ! eval "$(ssh-agent -s)" >/dev/null; then
  echo "ERROR: ssh-agent failed to start; signing out 1Password" >&2
  op signout --account "$_op_account" >/dev/null 2>&1 || true
  unset _op_script_dir _op_account_file _op_account _op_amcode_account _op_amcode_github_ref
  return 1
fi

echo "Loading GitHub SSH key from 1Password..."
if ! op read "$_op_amcode_github_ref" 2>/dev/null | ssh-add - >/dev/null 2>&1; then
  echo "ERROR: failed to load GitHub SSH key from 1Password" >&2
  echo "  Reference: $_op_amcode_github_ref" >&2
  ssh-add -D >/dev/null 2>&1 || true
  kill "$SSH_AGENT_PID" >/dev/null 2>&1 || true
  unset SSH_AUTH_SOCK SSH_AGENT_PID
  op signout --account "$_op_account" >/dev/null 2>&1 || true
  unset _op_script_dir _op_account_file _op_account _op_amcode_account _op_amcode_github_ref
  return 1
fi

# Bypass the global `Host * IdentityAgent` directive in ~/.ssh/config — only
# for git, so plain `ssh` to other hosts keeps using the 1Password SSH agent.
export GIT_SSH_COMMAND="ssh -o IdentityAgent=\"$SSH_AUTH_SOCK\" -o IdentitiesOnly=yes"

echo "Session active (1Password + GitHub SSH). Launch 'claude' to inherit."

# Unified cleanup: revokes 1Password session AND tears down ssh-agent.
# Idempotent — safe to re-source; the new trap replaces the prior one.
_op_amcode_cleanup() {
  op signout --account "$_op_amcode_account" >/dev/null 2>&1
  if [[ -n "${SSH_AGENT_PID:-}" ]]; then
    ssh-add -D >/dev/null 2>&1
    kill "$SSH_AGENT_PID" >/dev/null 2>&1
  fi
}
trap _op_amcode_cleanup EXIT

unset _op_script_dir _op_account_file _op_account _op_amcode_github_ref
