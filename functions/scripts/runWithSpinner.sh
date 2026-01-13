#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: runWithSpinner.sh <command...>" >&2
  exit 2
fi

cmd=("$@")
label="${UNMEN_SPINNER_LABEL:-${cmd[*]}}"

if [ -t 1 ]; then
  tmp="$(mktemp -t unmen.spinner.XXXXXX)"
  "${cmd[@]}" >"$tmp" 2>&1 &
  pid=$!

  frames=('|' '/' '-' '\')
  i=0

  while kill -0 "$pid" 2>/dev/null; do
    printf "\r%s %s" "${frames[$i]}" "$label"
    i=$(( (i + 1) % 4 ))
    sleep 0.12
  done

  wait "$pid"
  rc=$?

  if [ "$rc" -eq 0 ]; then
    printf "\r✓ %s\n" "$label"
  else
    printf "\r✗ %s (exit=%s)\n" "$label" "$rc"
  fi

  cat "$tmp"
  rm -f "$tmp"
  exit "$rc"
else
  exec "${cmd[@]}"
fi
