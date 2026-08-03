#!/usr/bin/env bash
# Remove the futu-news-bot launchd job (and its plist).

set -euo pipefail
LABEL="comparetiger.futu-news-bot"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"
echo "Removed $PLIST_PATH"