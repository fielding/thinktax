#!/bin/bash
# thinktax-billing-tag.sh — Claude Code SessionStart hook
#
# Detects whether the current session is using OAuth (subscription/Max plan)
# or an API key, and writes a billing tag to the thinktax registry.
#
# Detection: ANTHROPIC_API_KEY empty/unset → OAuth (subscription)
#            ANTHROPIC_API_KEY set         → API key (pay-per-token)
#
# Install: add to ~/.claude/settings.json hooks.SessionStart
# See: https://github.com/user/thinktax#subscription-billing

SESSION_ID=$(jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ -z "$ANTHROPIC_API_KEY" ]; then
  MODE="subscription"
else
  MODE="api"
fi

BILLING_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/thinktax"
mkdir -p "$BILLING_DIR"
printf '{"session_id":"%s","billing":"%s","ts":"%s"}\n' "$SESSION_ID" "$MODE" "$TS" >> "$BILLING_DIR/billing-sessions.jsonl"
