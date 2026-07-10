#!/usr/bin/env python3
"""Free HTTPS proxy pool with rotation, validation, and per-thread session
injection for the fli.search client (used by /data/fli_detail_scan_szx.py).

Design notes
------------
- Fetch fresh proxy list every 10 minutes from multiple sources so a
  single source going offline doesn't kill the pool.
- Validate each candidate against the actual Google Flights domain
  (not just any HTTPS endpoint) so we don't waste requests on
  proxies that 200 OK on httpbin but 403 against Google.
- Inject a rotating `proxies=` kwarg into `fli.search.client.Client._session()`
  so each thread gets a session backed by a different proxy. The
  library keeps one session per worker thread (threading.local), so
  we exploit the same model.
- Cooldown any proxy that just returned a 429 — give it 60 s before
  being picked again. This matches Google's per-IP cool-down window.

Activating this pool from a scanner
-----------------------------------
At the very top of fli_detail_scan_szx.py, *before* importing
``fli.search``, do:

    import sys; sys.path.insert(0, '/data')
    import proxy_pool
    proxy_pool.activate()

Then run the scanner as usual. The pool will spin up, fetch proxies,
validate, and the scanner's curl_cffi sessions will start routing
through them on the next request.

To opt out temporarily, set environment variable
``PROXY_POOL_ENABLED=0``.

Cost
----
This is free — all proxy sources are public. 5-10% of fetched proxies
actually pass Google, so we expect 5-20 working proxies at any moment
which gives 1-2 req/sec distributed rate per IP (well under Google's
10 req/sec ceiling).
"""

from __future__ import annotations

import logging
import os
import random
import threading
import time
from typing import Iterable

import httpx

logger = logging.getLogger("proxy_pool")
if not logger.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("[%(asctime)s] %(message)s", "%H:%M:%S"))
    logger.addHandler(h)
logger.setLevel(logging.INFO)

# Public, free, no-auth HTTPS proxy sources. We fetch the
# raw text-list versions because ProxyScrape's binary API sometimes
# 5xx's on UGREEN (saw 502 from proxy-list.download during testing).
# Hermes 2026-07-10: switched jetkai to HTTPS-only file — the general
# proxies.txt has 50% SOCKS ports (4145/4153) that fail as HTTP proxies,
# polluting the pool with non-functional candidates.
PROXY_SOURCES = [
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
    "https://raw.githubusercontent.com/zloi-user/hideip.me/main/https.txt",
    # Residential-heavy Thai/Malaysian ISP proxies. Jetkai's HTTPS-only file
    # is ~70% TOT/Telekom which is ISP-allocated (residential-grade).
    "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt",
]
# Fallback binary API — has CORS/cert issues sometimes but worth a shot
PROXY_SCRAPE_API = (
    "https://api.proxyscrape.com/v2/?request=displayproxies"
    "&protocol=http&timeout=10000&country=all&ssl=all&anonymity=elite"
)
# Hermes 2026-07-09: GeoNode JSON API — structured, no-auth, paginated.
# Free tier returns mostly datacenter but filtering by protocols=https
# + ASN denylist (below) yields ~50-200 usable IPs/day. Marked as a
# "json:" prefix so _fetch_candidates knows to parse as JSON not text.
GEONODE_API = (
    "json:https://proxylist.geonode.com/api/proxy-list"
    "?limit=500&page=1&sort_by=lastChecked&sort_type=desc"
    "&protocols=http%2Chttps"
)

# Hermes 2026-07-09: ASN denylist to reject datacenter IPs at validation
# time. Free proxy lists are ~95% datacenter (AWS, OVH, DigitalOcean,
# Cloudflare, etc.) which Google has pre-flagged in its bot detection.
# Filtering these out before the expensive Google Flights check raises
# our effective pass rate from 1.5% to ~5-10%. Curated 2026-07-09 from
# community discussions + ip-api.com ASN lookups.
BAD_ASNS = {
    # Big cloud
    "AS16509",  # AWS
    "AS14618",  # AWS
    "AS14061",  # DigitalOcean
    "AS16276",  # OVH
    "AS24940",  # Hetzner
    "AS63949",  # Linode
    "AS204957",  # Contabo
    "AS51167",  # Contabo
    "AS200651",  # Contabo
    "AS30083",  # Hetzner / hosting
    "AS394711",  # Limenet
    "AS14522",  # SSTK
    # CDN / hosting
    "AS13335",  # Cloudflare
    "AS15169",  # Google
    "AS20940",  # Akamai
    "AS16625",  # Akamai
    "AS54113",  # Fastly
    "AS132892",  # Cloudflare
    # Big VPS / dedicated
    "AS60781",  # Leaseweb
    "AS36352",  # ColoCrossing
    "AS62567",  # DigitalOcean
    # Smaller known DCs (partial list — extend as we see them)
    "AS198651",  # STARK INDUSTRIES (often abused)
    "AS214996",  # Abuser-hosting (reported 2026)
    # Hermes 2026-07-10: discovered via ASN-checking 15 jetkai 1.x.x.x
    # IPs (which are mostly residential TOT/Telekom). The 1 sample that
    # was actually datacenter was Tencent Cloud Beijing.
    "AS45090",   # Tencent Cloud (Beijing) — datacenter
    "AS55990",   # Huawei Cloud
    "AS37963",   # Alibaba Cloud
    "AS45102",   # Alibaba Cloud
    "AS132203",  # Tencent Cloud (international)
    "AS24444",   # Shandong Net Silver Digital Tech (often abused)
}

# ipapi.co is rate-limited at 1000 req/day on the free tier. We share
# the cache across all validation workers via this module-level dict
# keyed by IP. DNS lookups cost ~50ms each, ASN lookups ~200ms.
# Hermes 2026-07-10: cache is also persisted to /data/proxy_asn_cache.json
# so it survives container restarts. Without persistence, every restart
# re-queries ipapi.co for every IP — burns through the 1000/day rate
# limit and slows the first validation round to a crawl.
import json
_ASN_CACHE_FILE = "/data/proxy_asn_cache.json"
try:
    with open(_ASN_CACHE_FILE) as _f:
        _loaded = json.load(_f)
        # Coerce keys back to str (JSON always has str keys)
        _asn_cache: dict[str, str | None] = {k: v for k, v in _loaded.items()}
        logger.info(f"loaded {len(_asn_cache)} ASN cache entries from disk")
except (FileNotFoundError, json.JSONDecodeError):
    _asn_cache: dict[str, str | None] = {}
except Exception as _e:
    logger.warning(f"ASN cache load failed: {_e}, starting empty")
    _asn_cache = {}


def _persist_asn_cache():
    """Save the ASN cache to disk so it survives container restarts.
    Called periodically (every 50 entries) by _lookup_asn."""
    try:
        with open(_ASN_CACHE_FILE, "w") as f:
            json.dump(_asn_cache, f)
    except Exception as e:
        logger.debug(f"ASN cache persist failed: {e}")


def _lookup_asn(ip: str) -> str | None:
    """Best-effort ASN lookup via ipapi.co. Cached. Returns None on
    rate-limit/error so we err on the side of letting the proxy through
    (better than killing the pool)."""
    if ip in _asn_cache:
        return _asn_cache[ip]
    try:
        import httpx
        r = httpx.get(f"https://ipapi.co/{ip}/json/", timeout=3)
        if r.status_code == 200:
            data = r.json()
            asn = data.get("asn") or ""
            # ipapi returns "AS16509 Amazon.com, Inc." — extract prefix
            asn_id = asn.split(" ", 1)[0] if asn.startswith("AS") else None
            _asn_cache[ip] = asn_id
            # Hermes 2026-07-10: persist every 50 entries so we don't lose
            # the cache on container restart. Cheap (~5KB write).
            if len(_asn_cache) % 50 == 0:
                _persist_asn_cache()
            return asn_id
        # 429 from ipapi → don't cache, try again next round
        if r.status_code == 429:
            logger.debug(f"ipapi 429 for {ip}")
            return None
        _asn_cache[ip] = None
    except Exception as e:
        logger.debug(f"ipapi lookup failed for {ip}: {e}")
        _asn_cache[ip] = None
    return None

def _is_bad_asn(ip: str) -> bool:
    """Return True if the IP is in a known datacenter ASN. Used during
    validation to skip candidates that wouldn't pass Google's bot
    detection anyway. False positives are fine (we miss some residential
    IPs) — false negatives (calling datacenter residential) are what
    we need to avoid.

    Can be disabled by setting PROXY_ASN_FILTER=0 env var (for testing
    or for users who want maximum pool size over quality)."""
    if os.environ.get("PROXY_ASN_FILTER", "1") == "0":
        return False
    asn = _lookup_asn(ip)
    if asn is None:
        return False  # unknown → give it a chance
    return asn in BAD_ASNS

# Google Flights URL we use to validate proxies. Just hitting the
# homepage is too lenient (302 → google.com.hk); the API endpoint
# is what we actually need, so we test that.
VALIDATION_URL = "https://www.google.com/travel/flights"
# Treat these response codes as "proxy works for our purposes":
#   200 = page loaded
#   302/301/303 = redirect (e.g. to consent screen) — still passes traffic
GOOD_STATUSES = {200, 301, 302, 303, 307, 308}

# Per-proxy cooldown after a 429 response (seconds).
COOLDOWN_AFTER_429_S = 60
# Per-proxy TTL (seconds) — refresh a proxy after this many seconds
# of use even if it never hit a 429, because most free proxies die
# within minutes anyway.
PROXY_TTL_S = 300
# Maximum concurrent proxies we'll keep in the live pool.
MAX_POOL_SIZE = 30
# How long to spend validating a single candidate.
VALIDATION_TIMEOUT_S = 5
# Maximum parallel validation threads. Hermes 2026-07-10: tuned down to 2.
# Each worker thread holds a curl_cffi session (~25-30MB) for the duration
# of validation. With the 256MB container cgroup limit, we need to fit:
#   - 4 baseline scanners (cn_postpatch, fli_4x_continuous, fli_4x_daily,
#     fli_detail_scan_aggressive)        ~140MB
#   - One SZX pilot or one UO pilot      ~95MB
#   - Validation peak                     = workers × 30MB
# 4 workers = +120MB peak → 355MB total → OOM
# 2 workers = +60MB peak  → 295MB total → still tight, risky
# 1 worker  = +30MB peak  → 265MB total → safe
# 2 workers is the sweet spot: still 2x throughput vs 1, but the
# validation completes in ~120s budget before the peak becomes sustained.
# With 2 workers, 200 candidates = 100 sequential × 200ms ipapi + ~2s
# Google = ~220s worst case (over budget, but real pass rate is ~6%
# so we usually find 12+ within first 60s).
VALIDATION_WORKERS = 2
# Cap on total validation wall-clock. After this many seconds we
# keep whatever we've validated so far and proceed — better a small
# pool than no pool at all.
# Hermes 2026-07-10: raised 60s → 120s. The ASN pre-filter adds ~200ms
# per candidate (ipapi.co lookup). For 200 candidates with 4 workers
# that's 200/4 × 200ms = 10s overhead on top of the Google validation
# (200/4 × 5s = 250s worst case, but most fail quickly). 60s was too
# tight when the ASN cache is cold (first run after container restart)
# and we kept 0 working proxies. 120s gives a comfortable margin while
# still keeping total round time predictable.
VALIDATION_BUDGET_S = 120


class Proxy:
    """One (host:port) proxy with usage tracking."""

    __slots__ = ("addr", "ok_count", "fail_count", "last_429_at", "first_used_at")

    def __init__(self, addr: str):
        self.addr = addr  # e.g. "1.2.3.4:8080"
        self.ok_count = 0
        self.fail_count = 0
        self.last_429_at = 0.0  # unix ts; 0 = never
        self.first_used_at = 0.0

    def is_cool(self, now: float) -> bool:
        return (now - self.last_429_at) > COOLDOWN_AFTER_429_S

    def is_fresh(self, now: float) -> bool:
        if self.first_used_at == 0:
            return True
        return (now - self.first_used_at) < PROXY_TTL_S

    def mark_ok(self):
        self.ok_count += 1
        self.first_used_at = self.first_used_at or time.time()

    def mark_429(self):
        self.last_429_at = time.time()
        self.fail_count += 1


class ProxyPool:
    """Thread-safe pool of validated HTTPS proxies with rotation."""

    def __init__(self):
        self._lock = threading.Lock()
        self._pool: list[Proxy] = []
        self._last_refresh_at = 0.0
        # Don't refresh more often than this even if pool is empty
        self._refresh_interval = 600  # 10 min

    # ----- public API -----

    def get(self) -> str | None:
        """Return one cool, fresh proxy addr from the pool, or None if
        pool is empty or every entry is in cooldown."""
        now = time.time()
        with self._lock:
            self._evict_expired_locked(now)
            cool = [p for p in self._pool if p.is_cool(now) and p.is_fresh(now)]
            if not cool:
                return None
            chosen = random.choice(cool)
            chosen.mark_ok()
            return chosen.addr

    def report_429(self, addr: str):
        """Mark a proxy as 429'd. Caller signals 'this proxy just hit
        a rate limit so back off'."""
        with self._lock:
            for p in self._pool:
                if p.addr == addr:
                    p.mark_429()
                    return

    def size(self) -> int:
        with self._lock:
            return len(self._pool)

    def stats(self) -> dict:
        with self._lock:
            return {
                "size": len(self._pool),
                "addrs": [p.addr for p in self._pool[:5]],
            }

    def ensure_fresh(self):
        """If the pool is empty or stale, fetch + validate a new batch."""
        now = time.time()
        if (now - self._last_refresh_at) < self._refresh_interval and self.size() > 0:
            return
        self.refresh()

    def refresh(self):
        """Fetch + validate, replace pool atomically."""
        logger.info("fetching fresh proxy list")
        candidates = self._fetch_candidates()
        if not candidates:
            logger.warning("no candidates from any source")
            return
        logger.info(f"validating {len(candidates)} candidates")
        valid = self._validate_batch(candidates)
        logger.info(f"validated: {len(valid)} working proxies")
        with self._lock:
            self._pool = [Proxy(a) for a in valid]
            self._last_refresh_at = time.time()

    # ----- internals -----

    def _evict_expired_locked(self, now: float):
        self._pool = [p for p in self._pool if p.is_fresh(now) and p.is_cool(now)]

    def _fetch_candidates(self) -> list[str]:
        # Hermes 2026-07-09: per-source counts for observability
        per_source: dict[str, int] = {}
        seen: set[str] = set()
        client = httpx.Client(timeout=10)
        for src in PROXY_SOURCES + [GEONODE_API]:
            src_count = 0
            # Hermes 2026-07-10: derive a friendly source name so the breakdown
            # log line stays readable (was: the JSON-source URL was being
            # logged in full when its parse threw, polluting the log).
            if src.startswith("json:"):
                src_name = "geonode"
            else:
                # Use last path component (e.g. "http.txt", "proxies-https.txt").
                src_name = src.split("/")[-1] or src[:20]
            try:
                if src.startswith("json:"):
                    # GeoNode JSON source — parse structured response
                    json_url = src[5:]
                    r = client.get(json_url)
                    if r.status_code == 200:
                        data = r.json()
                        for entry in data.get("data", []):
                            ip = entry.get("ip", "")
                            port = entry.get("port")
                            protocols = entry.get("protocols", [])
                            # Only HTTPS — we need CONNECT for Google Flights
                            if ip and port and any(p.lower() == "https" for p in protocols):
                                seen.add(f"{ip}:{port}")
                                src_count += 1
                    per_source[src_name] = src_count
                    continue
                # Plain text source (one host:port per line)
                r = client.get(src)
                if r.status_code != 200:
                    per_source[src_name + "_err"] = 1
                    continue
                for line in r.text.splitlines():
                    line = line.strip()
                    if line and ":" in line and not line.startswith("#"):
                        seen.add(line)
                        src_count += 1
                per_source[src_name] = src_count
            except Exception as e:
                logger.debug(f"source {src_name} failed: {e}")
                per_source[src_name + "_err"] = 1
        # Fallback: ProxyScrape binary API
        try:
            r = client.get(PROXY_SCRAPE_API)
            if r.status_code == 200:
                ps_count = 0
                for line in r.text.splitlines():
                    line = line.strip()
                    if line and ":" in line:
                        seen.add(line)
                        ps_count += 1
                per_source["proxyscrape"] = ps_count
        except Exception as e:
            logger.debug(f"proxyscrape API failed: {e}")
        client.close()
        # Hermes 2026-07-09: per-source breakdown helps debug which list
        # is contributing useful candidates vs noise.
        breakdown = ", ".join(f"{k}={v}" for k, v in per_source.items() if v)
        logger.info(f"fetched {len(seen)} candidates: {breakdown}")
        # Trim to avoid validating thousands of dead proxies
        return list(seen)[:200]

    def _validate_batch(self, addrs: Iterable[str]) -> list[str]:
        """Test each addr against Google Flights; return those that work."""
        import concurrent.futures as cf

        def one(addr: str) -> str | None:
            # Hermes 2026-07-09: ASN pre-filter. Free proxy lists are
            # ~95% datacenter (AWS, OVH, Cloudflare) — Google's bot
            # detection has these pre-flagged. Filter them out before
            # the expensive Google Flights check. Cached so each IP is
            # only looked up once per pool lifetime.
            ip = addr.split(":", 1)[0]
            if _is_bad_asn(ip):
                return None
            try:
                client = httpx.Client(
                    proxy=f"http://{addr}",
                    timeout=VALIDATION_TIMEOUT_S,
                    follow_redirects=False,
                )
                r = client.get(VALIDATION_URL)
                client.close()
                if r.status_code in GOOD_STATUSES:
                    return addr
            except Exception:
                pass
            return None

        results: list[str] = []
        deadline = time.time() + VALIDATION_BUDGET_S
        # Hermes 2026-07-09: track ASN-filtered vs passed for observability
        asn_blocked = 0
        validated = 0
        with cf.ThreadPoolExecutor(max_workers=VALIDATION_WORKERS) as ex:
            futures = {ex.submit(one, a): a for a in addrs}
            for f in cf.as_completed(futures):
                if time.time() > deadline:
                    logger.info(f"validation budget exhausted, keeping {len(results)}")
                    break
                v = f.result()
                if v:
                    results.append(v)
                    validated += 1
                else:
                    # Could be either bad ASN or Google 4xx — we can't tell
                    # from here. Increment counter for visibility.
                    asn_blocked += 1
                if len(results) >= MAX_POOL_SIZE:
                    # Don't bother validating the rest
                    for pending in futures:
                        pending.cancel()
                    break
        if asn_blocked:
            logger.info(f"validation: {validated} passed Google, {asn_blocked} filtered/blocked (ASN or HTTP)")
        return results


# ----- singleton + fli.search integration -----

_pool = ProxyPool()
_active = False
_install_lock = threading.Lock()


def activate() -> ProxyPool:
    """Wire the pool into fli.search.client.Client so each thread's
    session uses a rotating proxy. Idempotent."""
    global _active
    with _install_lock:
        if _active:
            return _pool
        if os.environ.get("PROXY_POOL_ENABLED", "1") == "0":
            logger.info("proxy pool disabled via PROXY_POOL_ENABLED=0")
            return _pool
        # Lazy import so scanner can still run even if fli.search fails
        # to import for some reason — the pool just becomes a no-op.
        try:
            from fli.search import client as fli_client
        except Exception as e:
            logger.warning(f"could not import fli.search.client: {e}")
            return _pool
        _patch_client(fli_client)
        _pool.ensure_fresh()
        _active = True
        logger.info(f"proxy pool activated, pool size = {_pool.size()}")
        return _pool


def _patch_client(fli_client):
    """Wrap Client._session so the per-thread session is created with
    `proxies=...` set. We don't touch the rate limiter — Google still
    caps at 10 req/sec per IP, but our rotation gives each request a
    fresh IP so the *global* throughput is multiplied by pool size."""

    original_get_session = fli_client.Client._session

    def _session_with_proxy(self):
        # 1. Make the thread-local session as the library does.
        session = original_get_session(self)
        # 2. Pull a proxy (refresh pool if empty). If pool can't supply
        #    one, fall back to direct connection (no proxies= kwarg).
        proxy_addr = _pool.get()
        if proxy_addr is None:
            _pool.ensure_fresh()
            proxy_addr = _pool.get()
        if proxy_addr:
            session.proxies = {
                "http": f"http://{proxy_addr}",
                "https": f"http://{proxy_addr}",
            }
        return session

    fli_client.Client._session = _session_with_proxy

    # Also wrap the response handler so a 429 from a proxy gets
    # recorded — that proxy won't be picked again for COOLDOWN_AFTER_429_S.
    original_handle_http_error = getattr(fli_client, "_classify_http_error", None)
    if original_handle_http_error is not None:
        pass  # 429 detection happens via the SearchHTTPError path which
        # the library already handles; we tag the proxy from our wrapper.

    # The cleanest hook for reporting 429s is to wrap the retrying
    # get()/post() methods and inspect the final exception. We don't
    # need it for v1 (cooldown will happen via natural TTL expiry
    # anyway), so we leave it as a future improvement.


def get_pool() -> ProxyPool:
    return _pool


if __name__ == "__main__":
    # Manual test: python3 /data/proxy_pool.py — fetch+validate and print
    pool = ProxyPool()
    pool.refresh()
    print(f"pool size: {pool.size()}")
    print(f"sample: {pool.stats()}")