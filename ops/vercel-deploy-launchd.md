# Comparetiger 財經新聞 — Vercel deploy schedule

The Vercel SPA at `flight-deals-app-seven.vercel.app/news` is auto-deployed
5x per day (6AM, 10AM, 2PM, 6PM, 10PM HKT) via macOS launchd. The script
also has a skip-if-no-new-content guard so quota is not wasted.

## Files

| Path | Purpose |
|---|---|
| `~/.vercel-deploy/deploy-news.sh` | The deploy script (idempotent skip + deploy) |
| `~/.vercel-deploy/token` | Vercel CLI auth token (mode 600) |
| `~/.vercel-deploy/last-deploy.txt` | ISO 8601 timestamp of last successful deploy |
| `~/.vercel-deploy/log/deploy.log` | Append-only deploy log |
| `~/Library/LaunchAgents/com.comparetiger.vercel-deploy-news.plist` | launchd schedule |

## Schedule

```
Hour  Minute
06    00    (morning)
10    00    (mid-morning)
14    00    (afternoon)
18    00    (evening)
22    00    (late evening)
```

`WakeFromSleep = false` — if the Mac is asleep at a slot, the run is skipped;
the next slot picks up. So 6 AM HKT may not run if the lid is closed overnight.

## Skip logic

```
WP latest post date_gmt > last-deploy timestamp? → DEPLOY
WP latest post date_gmt <= last-deploy timestamp? → SKIP (no Vercel quota spent)
WP fetch failed? → DEPLOY (safe fallback)
```

## Quota

- 5 deploys/day × ~1 min each = 5 min/day × 30 = **150 min/month**
- Vercel free tier: 5,000 min/month
- **3% of quota** even with skip disabled. With skip enabled, typically 0–50 min/month.

## How to inspect

```bash
# Is the job loaded?
launchctl list | grep comparetiger

# Recent deploy log
tail -50 ~/.vercel-deploy/log/deploy.log

# Force a deploy now
~/.vercel-deploy/deploy-news.sh

# Force a skip (test the skip path)
python3 -c "
from datetime import datetime, timezone, timedelta
print((datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(timespec='seconds'))
" > ~/.vercel-deploy/last-deploy.txt
~/.vercel-deploy/deploy-news.sh
```

## How to disable

```bash
launchctl unload ~/Library/LaunchAgents/com.comparetiger.vercel-deploy-news.plist
```

## How to re-enable

```bash
launchctl load -w ~/Library/LaunchAgents/com.comparetiger.vercel-deploy-news.plist
```

## Why this exists

The Vercel SPA mirrors the WP page 10215 contents. WP page 10215 re-bakes
hourly via the cron on the NAS (`--publish-page` flag). The Vercel SPA
needs a redeploy to pick up the new content because Vercel ISR
`revalidate=300s` only refreshes the cached HTML after a new request —
the *build output* is still stale until `vercel deploy` runs.

Without this schedule, you would have to manually run `npx vercel --prod`
every time you want new articles on the SPA. With this schedule, the SPA
auto-refreshes 5x per day and skips when there's nothing new.

## Restart loop note

If launchd jobs keep dying, see `~/.hermes/skills/hermes-gateway-restart-race.md`.
The Mac's launchd should be stable if the user is logged in.
