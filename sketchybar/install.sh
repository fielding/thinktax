#!/bin/bash

# ─────────────────────────────────────────────────────────────────────────────
# Thinktax Sketchybar Module Installer
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THINKTAX_ROOT="$(dirname "$SCRIPT_DIR")"
SKETCHYBAR_CONFIG="${HOME}/.config/sketchybar"
LAUNCHD_DIR="${HOME}/Library/LaunchAgents"

echo "Installing thinktax sketchybar module..."

# Check prerequisites
if ! command -v sketchybar &> /dev/null; then
  echo "Error: sketchybar not found. Install with: brew install FelixKratz/formulae/sketchybar"
  exit 1
fi

if [ ! -f "$THINKTAX_ROOT/dist/cli.js" ]; then
  echo "Error: thinktax not built. Run 'npm run build' in $THINKTAX_ROOT first."
  exit 1
fi

# Create directories
mkdir -p "$SKETCHYBAR_CONFIG/items"
mkdir -p "$SKETCHYBAR_CONFIG/plugins"
mkdir -p "$LAUNCHD_DIR"
mkdir -p "${HOME}/.local/state/thinktax"

# Copy sketchybar files
cp "$SCRIPT_DIR/items/thinktax.sh" "$SKETCHYBAR_CONFIG/items/"
cp "$SCRIPT_DIR/plugins/thinktax.sh" "$SKETCHYBAR_CONFIG/plugins/"
chmod +x "$SKETCHYBAR_CONFIG/items/thinktax.sh"
chmod +x "$SKETCHYBAR_CONFIG/plugins/thinktax.sh"

echo "✓ Installed sketchybar items and plugins"

# Update plugin with correct path to thinktax CLI
THINKTAX_BIN="node $THINKTAX_ROOT/dist/cli.js"
sed -i '' "s|^THINKTAX_BIN=.*|THINKTAX_BIN=\"$THINKTAX_BIN\"|" "$SKETCHYBAR_CONFIG/plugins/thinktax.sh"

echo "✓ Configured thinktax CLI path: $THINKTAX_BIN"

# Find node path
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
  echo "Error: node not found in PATH"
  exit 1
fi

# Install launchd job for periodic refresh
PLIST_FILE="$LAUNCHD_DIR/com.thinktax.refresh.plist"
cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.thinktax.refresh</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${THINKTAX_BIN}</string>
        <string>refresh</string>
    </array>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${HOME}/.local/state/thinktax/refresh.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/.local/state/thinktax/refresh.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF

# Load the launchd job
launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load "$PLIST_FILE"

echo "✓ Installed launchd job for periodic refresh (every 5 minutes)"

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Add to your sketchybarrc:"
echo "     source \"\$ITEM_DIR/thinktax.sh\""
echo ""
echo "  2. Restart sketchybar:"
echo "     sketchybar --reload"
echo ""
echo "  3. Run initial data collection:"
echo "     node $THINKTAX_BIN refresh"
