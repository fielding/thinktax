#!/bin/bash

# ─────────────────────────────────────────────────────────────────────────────
# Thinktax Sketchybar Module Uninstaller
# ─────────────────────────────────────────────────────────────────────────────

SKETCHYBAR_CONFIG="${HOME}/.config/sketchybar"
LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
PLIST_FILE="$LAUNCHD_DIR/com.thinktax.refresh.plist"

echo "Uninstalling thinktax sketchybar module..."

# Unload launchd job
if [ -f "$PLIST_FILE" ]; then
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  rm -f "$PLIST_FILE"
  echo "✓ Removed launchd job"
fi

# Remove sketchybar files
if [ -f "$SKETCHYBAR_CONFIG/items/thinktax.sh" ]; then
  rm -f "$SKETCHYBAR_CONFIG/items/thinktax.sh"
  echo "✓ Removed items/thinktax.sh"
fi

if [ -f "$SKETCHYBAR_CONFIG/plugins/thinktax.sh" ]; then
  rm -f "$SKETCHYBAR_CONFIG/plugins/thinktax.sh"
  echo "✓ Removed plugins/thinktax.sh"
fi

echo ""
echo "Uninstall complete!"
echo ""
echo "Note: You may want to:"
echo "  1. Remove 'source \"\$ITEM_DIR/thinktax.sh\"' from your sketchybarrc"
echo "  2. Restart sketchybar: sketchybar --reload"
