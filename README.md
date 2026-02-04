# thinktax

A multi-provider LLM cost tracker for developers using Claude Code, Cursor, and Codex CLI.

Track your AI coding assistant spending across all your tools in one place, with timezone-aware reporting, per-project attribution, and macOS menu bar integration via Sketchybar.

![output](https://github.com/user-attachments/assets/61236fcb-1d64-4a34-9300-50bed269f360)


## Features

- **Multi-provider support** - Claude Code, Cursor (Team API), Codex CLI
- **Actual-spend-first philosophy** - Uses reported costs when available, falls back to estimates
- **Timezone-aware reporting** - Today/MTD/YTD windows respect your local timezone
- **Multiple breakdowns** - By provider, project, model, or source
- **Sketchybar integration** - Live spending in your macOS menu bar with animated breakdowns
- **Offline-first** - All data stored locally, works without network

## Installation

```bash
# Clone and build
git clone https://github.com/fielding/thinktax.git
cd thinktax
npm install
npm run build

# Link globally (optional)
npm link
```

## Quick Start

```bash
# 1. Create config file
cp config.sample.toml ~/.config/thinktax/config.toml  # Linux
cp config.sample.toml ~/Library/Application\ Support/thinktax/config.toml  # macOS

# 2. Edit config with your settings (see Configuration below)

# 3. Collect usage data
thinktax refresh

# 4. View your spending
thinktax status
```

## CLI Reference

### `thinktax refresh`

Collect latest usage from all configured providers and write normalized events.

```bash
thinktax refresh
# Collected 1234 events (56 new). Claude 800, Codex 400, Cursor 34.
```

### `thinktax status`

Show usage totals with optional breakdowns.

```bash
# Default: today and month-to-date
thinktax status

# JSON output
thinktax status --json

# Breakdown by provider, project, model, or source
thinktax status --breakdown provider
thinktax status --breakdown project

# Specific time windows
thinktax status --today
thinktax status --mtd
thinktax status --ytd
thinktax status --all
```

### `thinktax sketchybar`

Output payload for Sketchybar integration.

```bash
thinktax sketchybar              # Plain text: "today $12.34"
thinktax sketchybar --format json  # JSON with full breakdown
```

### `thinktax popup`

Detailed breakdown for popup displays.

```bash
thinktax popup
thinktax popup --format json
thinktax popup --today --mtd
```

### `thinktax graph`

Display cost over time as an ASCII chart in the terminal.

```bash
# Default: last 30 days, all providers
thinktax graph

# Last 7 days
thinktax graph --days 7

# Filter by provider
thinktax graph --provider anthropic
thinktax graph --provider cursor
thinktax graph --provider openai

# Adjust chart height
thinktax graph --height 20
```

Example output:
```
Total cost - last 30 days
──────────────────────────────────────────────────
 $273.09 ┼╮
 $185.22 ┤│││  ╭╮ ╭╮        ╭╮        ╭
  $97.35 ┤  ╰─╯ │╭╯│  ││  ╭╮││ │││╰╮  │
   $9.48 ┤                           ╰╯
  01-04                  02-02
──────────────────────────────────────────────────
Total: $2818.26  |  Avg: $93.94/day  |  Max: $273.09
```

### `thinktax doctor`

Diagnostics for troubleshooting.

```bash
thinktax doctor
# Config: ~/.config/thinktax/config.toml (found)
# Data dir: ~/.local/share/thinktax
# Last claude refresh: 2026-02-02T10:30:00Z
# Last codex refresh: 2026-02-02T10:30:00Z
```

### Global Options

```bash
--config <path>    # Override config file path
--timezone <tz>    # Override timezone (e.g., "America/New_York")
```

## Configuration

Create a config file at:
- **Linux:** `~/.config/thinktax/config.toml`
- **macOS:** `~/Library/Application Support/thinktax/config.toml`

```toml
[ui]
timezone = "America/Los_Angeles"
includeUnknown = false  # Include unknown models in totals

[claude]
projectsDir = "~/.claude/projects"

[codex]
home = "~/.codex"

# Cursor - typically no config needed! Auth is auto-extracted from Cursor's state.vscdb
# Uncomment only if you need Team Admin API fallback or custom paths

# [cursor.team]
# # Team Admin API (optional, for team admins only)
# apiKey = "${CURSOR_API_KEY}"
# etagTtlMinutes = 15

# [cursor.local]
# # Custom state.vscdb path (only if non-standard Cursor installation)
# stateVscdbPath = "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb"

# Project mappings (optional)
[[projects.mappings]]
match.instanceId = "claude-instance-folder"
id = "my-project"
name = "My Project"
root = "/path/to/project"

[[projects.mappings]]
match.pathPrefix = "/path/to/another-project"
name = "Another Project"
```

### Environment Variable Interpolation

Config values support environment variables:

```toml
[cursor.team]
apiKey = "${CURSOR_API_KEY}"
token = "$CURSOR_TOKEN"
```

## Data Storage

All data is stored locally:

| Location | Linux | macOS |
|----------|-------|-------|
| Config | `~/.config/thinktax/` | `~/Library/Application Support/thinktax/` |
| Data | `~/.local/share/thinktax/` | `~/Library/Application Support/thinktax/data/` |

Data directory structure:
```
data/
├── events/
│   └── YYYY-MM-DD.jsonl    # Daily normalized events
├── snapshots/
│   └── YYYY-MM-DD.summary.json  # Pre-aggregated summaries
└── state/
    ├── sync.json           # Last refresh timestamps
    └── etag.json           # API response cache
```

## Sketchybar Integration (macOS)

thinktax includes a Sketchybar module for live spending in your menu bar.

### Install

```bash
cd thinktax
./sketchybar/install.sh
```

This will:
1. Copy plugin files to `~/.config/sketchybar/`
2. Install a launchd job for automatic data refresh every 5 minutes
3. Configure the CLI path

### Configure Sketchybar

Add to your `~/.config/sketchybar/sketchybarrc`:

```bash
source "$ITEM_DIR/thinktax.sh"
```

Then reload:
```bash
sketchybar --reload
```

### Features

- Click to expand provider breakdown (Cursor, Claude, Codex)
- Auto-collapse after 5 seconds
- Color indicators:
  - Red label = stale data (>24h since refresh)
  - Normal = fresh data
- Shows today's total and MTD in parentheses

### Uninstall

```bash
./sketchybar/uninstall.sh
```

## Collectors

### Claude Code

Discovers JSONL files under `~/.claude/projects/` and extracts usage from assistant responses.

**Supported data:**
- Token counts (input, output, cache read/write)
- Model names
- Timestamps
- Project attribution via instance folder

### Codex CLI

Parses session logs from `~/.codex/` with cumulative-to-delta token conversion.

**Supported data:**
- Token counts per session
- Model names
- Project attribution via git root detection

### Cursor

**Primary: Dashboard API** (automatic, zero config!)

thinktax automatically extracts your session token from Cursor's internal SQLite database (`state.vscdb`) and uses it to fetch your actual billing data from Cursor's dashboard API. This means:

- **No API keys to configure** - just install and run
- **Actual spend in cents** - reported costs, not estimates
- **Per-request granularity** - every API call with token counts and costs
- **30-day lookback** - fetches full usage history with pagination
- **ETag caching** - respects rate limits, 15-minute cache TTL

The auth token is automatically refreshed from your Cursor installation each time you run `thinktax refresh`.

**Fallback: Team Admin API** (optional, for team admins)

If you have team admin credentials, you can configure the Team API as a fallback:

```toml
[cursor.team]
apiKey = "${CURSOR_API_KEY}"
# or: email + token for Basic auth
```

**Supported data:**
- Token counts (input, output, cache read/write)
- Model breakdown (claude-3-5-sonnet, gpt-4o, agent_review, etc.)

## Pricing

Pricing data for 58+ models is included in `pricing/models.json`. Models are matched by substring, so variants like `claude-3-5-sonnet-20241022` match `claude-3-5-sonnet`.

To update pricing:
1. Edit `pricing/models.json`
2. Rebuild: `npm run build`

Unknown models are excluded from totals by default. Set `includeUnknown = true` in config to include them with zero cost.

## Troubleshooting

### "No events collected"

1. Check collector paths in config match your actual installations
2. Run `thinktax doctor` to verify paths exist
3. Ensure you have usage data (run some prompts first)

### "Stale data" indicator

Data older than 24 hours shows as stale. Run `thinktax refresh` or check if the launchd job is running:

```bash
launchctl list | grep thinktax
```

### Cursor API errors

1. Ensure Cursor is installed and you've logged in at least once
2. Run `thinktax doctor` to check if auth extraction is working
3. If using a non-standard Cursor path, set `cursor.local.stateVscdbPath` in config
4. Team Admin API is optional and only needed for team-level data

### Sketchybar not updating

1. Check the refresh log: `tail -f ~/.local/state/thinktax/refresh.log`
2. Manually trigger: `sketchybar --trigger thinktax`
3. Verify launchd job: `launchctl list | grep thinktax`

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test
```

## License

MIT - see [LICENSE](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.
