#!/usr/bin/env bash
# Establish a 1Password CLI session for this shell (and any children launched
# from it, including `claude`). One Touch ID prompt per dev session; session
# token lives in env vars only, no on-disk persistence.
#
# Daily workflow:
#   $ source scripts/op-claude-session.sh    # one Touch ID
#   $ claude                                  # inherits OP_SESSION_*
#   # ...all op calls Claude makes are auth'd from the cached session.
#
# Session expires after 30 minutes of inactivity (auto-refreshed on use).
# Closing the terminal clears it — nothing to revoke, nothing to clean up.
#
# MUST be sourced, not executed, so the export reaches the caller's shell.

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

# Confirm a session is actually active
if op whoami --account "$_op_account" >/dev/null 2>&1; then
  echo "Session active. Launch 'claude' from this terminal to inherit it."
  # Active server-side revocation when the shell exits — no orphaned session
  # tokens lingering in 1Password's session store after terminal close.
  # Replaces any prior EXIT trap; safe to re-source.
  trap "op signout --account '$_op_account' >/dev/null 2>&1" EXIT
else
  echo "WARNING: signin returned but 'op whoami' failed. If 1Password 8 desktop" >&2
  echo "integration is enabled, disable 'Always require Touch ID for CLI' in" >&2
  echo "Settings -> Developer, then re-source this script." >&2
fi

unset _op_script_dir _op_account_file _op_account
