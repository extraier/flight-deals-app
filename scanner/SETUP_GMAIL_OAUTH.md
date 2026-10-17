# Google Flights digest poller — OAuth setup

## One-time setup (5-10 min)

### 1. Google Cloud project
- Go to https://console.cloud.google.com/
- Create a new project (or use an existing one)
- Note the project name (e.g. "comparetiger-flights")

### 2. Enable Gmail API
- APIs & Services → Library
- Search "Gmail API" → Enable

### 3. Configure OAuth consent screen
- APIs & Services → OAuth consent screen
- User type: External (or Internal if you have a Workspace)
- App name: "Comparetiger Flights"
- Scopes: Add `https://www.googleapis.com/auth/gmail.readonly`
- Test users: Add your email (`extraier@gmail.com`)

### 4. Create OAuth credentials
- APIs & Services → Credentials
- Create Credentials → OAuth client ID
- Application type: **Desktop app**
- Name: "Comparetiger Flights Poller"
- Download JSON
- Save to: `scanner/gflights_credentials.json`

### 5. Install dependencies
```
cd scanner
pip install google-api-python-client google-auth-oauthlib
```

### 6. One-time OAuth consent
```
python gflights_poller.py --auth
```
This opens a browser, you sign in to extraier@gmail.com, grant
read-only Gmail access. A `gflights_token.json` is saved with
a refresh token (valid 7 days, then auto-refreshed).

### 7. First poll
```
python gflights_poller.py
```
Polls last 7 days, parses emails, writes to
`src/data/gflights_digest.json`.

## Schedule
Run every 30 min via cron:
```
*/30 * * * * cd /Users/roger/flight-deals-app/scanner && python gflights_poller.py >> ~/Library/Logs/gflights_poller.log 2>&1
```

## Files
- `gflights_credentials.json` — OAuth client secrets (DO NOT commit)
- `gflights_token.json` — refresh token (DO NOT commit)
- `gflights_parser.py` — pure function, takes headers + body, returns dict
- `gflights_poller.py` — main entry point
- `test_gflights_parser.py` — unit tests
- `../src/data/gflights_digest.json` — output (committed to git)
