# CLAUDE.md — Project notes for AI assistants

## Billing design decisions

### `defaultMode = "subscription"` for Max plan users

The `[claude.billing] defaultMode` is set to `"subscription"`. This is correct because:

- The vast majority of Claude Code sessions use the Max plan (OAuth auth)
- The SessionStart hook (`hooks/thinktax-billing-tag.sh`) explicitly tags rare API-key sessions as `"api"` when `ANTHROPIC_API_KEY` is set
- Subagent sessions and older sessions that predate the hook don't fire SessionStart, so they'd otherwise show inflated estimated costs
- The hook only needs to catch the **exception** (API billing), not the **common case** (subscription)

If a user primarily uses API keys rather than a subscription plan, they should change `defaultMode` to `"estimate"` or `"api"` in their config.

### OpenClaw billing

OpenClaw sessions use `[openclaw.billing] defaultMode`, which defaults to `"subscription"` for Kimi plan users. This is independent of Claude billing config.
