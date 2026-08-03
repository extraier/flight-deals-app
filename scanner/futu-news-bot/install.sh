#!/usr/bin/env bash
# Install the futu-news-bot as a launchd hourly job.
#
# Idempotent — running twice won't duplicate the plist. Use uninstall.sh
# to remove.
#
# Required env vars (read from .env if present):
#   COMPRETIGER_WP_PASSWORD
#
# Optional:
#   BOT_INTERVAL_SECONDS  (default 3600 = hourly)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="comparetiger.futu-news-bot"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
PY="$(command -v python3)"
LOG_DIR="$HOME/.cache/comparetiger/logs"
mkdir -p "$LOG_DIR"

if [[ ! -x "$PY" ]]; then
  echo "python3 not found in PATH" >&2
  exit 1
fi

# Load .env if it exists (do not overwrite pre-existing env)
if [[ -f "$HERE/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$HERE/.env"
  set +a
fi

if [[ -z "${COMPRETIGER_WP_PASSWORD:-}" ]]; then
  echo "COMPRETIGER_WP_PASSWORD not set. Create $HERE/.env or export it." >&2
  exit 1
fi

INTERVAL="${BOT_INTERVAL_SECONDS:-3600}"

# Write the plist
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PY}</string>
    <string>${HERE}/main.py</string>
    <string>--limit</string>
    <string>5</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>COMPRETIGER_WP_PASSWORD</key>
    <string>${COMPRETIGER_WP_PASSWORD}</string>
    <key>COMPRETIGER_WP_USER</key>
    <string>Comparetiger</string>
    <key>COMPRETIGER_WP_BASE</key>
    <string>https://comparetiger.com</string>
  </dict>
  <key>WorkingDirectory</key><string>${HERE}</string>
  <key>StartInterval</key><integer>${INTERVAL}</integer>
  <key>StandardOutPath</key><string>${LOG_DIR}/futu-news-bot.out.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/futu-news-bot.err.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
EOF

# Unload if already loaded, then load
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "Installed: $PLIST_PATH"
echo "Logs: $LOG_DIR"
echo "Trigger now: launchctl start ${LABEL}"
echo "Stop & remove: $HERE/uninstall.sh"