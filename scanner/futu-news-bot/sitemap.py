"""
Fetch news article metadata from news.futunn.com's sitemap.

news.futunn.com exposes Google News-format sitemaps at:
  https://news.futunn.com/sitemap.xml
which contains <sitemap> entries to language-specific last-48h sitemaps.

We pull the Traditional Chinese sitemap (`-zhhant-`) because Comparetiger's
audience is HK/TW. Each <url> in that sitemap has:

  <news:publication><news:name>財聯社</news:name></news:publication>
  <news:publication_date>2026-08-03T09:12:35+08:00</news:publication_date>
  <news:title>築底階段結構分化加劇...</news:title>
  <loc>https://news.futunn.com/post/.../...</loc>

Why sitemap instead of HTML scraping?
  - Plain XML, no anti-bot JS challenge (article pages do have one)
  - 48h rolling window refreshed automatically by Futu
  - ~200 entries on a quiet day, more when busy
  - Title is the news:title — already cleaned, no cruft

Article bodies are behind a JS anti-bot challenge that urllib can't solve,
so we don't fetch bodies in this bot. We post a title + source + URL card
and link back to the original — same shape as a "front page link roundup"
newsletter. This is also the most defensible on copyright grounds.
"""
from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Primary sitemap index, fallback to alternate if missing
SITEMAP_INDEX = "https://news.futunn.com/sitemap.xml"
ZHANT_NEWS_SITEMAP = (
    "https://news.futunn.com/sitemap-news-zhhant-index-test-48hours.xml"
)


@dataclass
class Article:
    url: str
    title: str
    source: str
    published_at: str  # ISO with TZ
    # Converted URL — Futu's sitemap uses /post/<id>/<slug> but the human
    # reader expects /hk/post/<id>/<slug>?lang=zh-hk. We canonicalize.
    canonical_url: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, sort_keys=True)


# Match a single <url>...</url> block from the news sitemap
_URL_RE = re.compile(
    r"<url>\s*"
    r"<loc>(?P<url>[^<]+)</loc>\s*"
    r"<news:news>\s*"
    r"<news:publication>\s*"
    r"<news:name>(?P<source>[^<]+)</news:name>\s*"
    r"<news:language>[^<]+</news:language>\s*"
    r"</news:publication>\s*"
    r"<news:publication_date>(?P<date>[^<]+)</news:publication_date>\s*"
    r"<news:title>(?P<title>[^<]+)</news:title>\s*"
    r"</news:news>\s*"
    r"</url>"
)


def _fetch(url: str, *, timeout: int = 15) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        # news.futunn.com sometimes gzips — urllib handles that transparently
        return resp.read().decode("utf-8", errors="replace")


def _canonicalize(url: str) -> str:
    """
    Sitemap uses /post/<id>/<slug> but the reader URL is /hk/post/<id>/<slug>.

    Some slugs include the source name in the URL — we strip query noise
    (utm_source etc.) but keep the slug. Resulting URL is human-readable.
    """
    url = url.replace("://news.futunn.com/post/", "://news.futunn.com/hk/post/")
    # Strip utm_*, futusource, etc. — purely cosmetic
    if "?" in url:
        from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

        parsed = urlparse(url)
        kept = [
            (k, v)
            for k, v in parse_qsl(parsed.query, keep_blank_values=True)
            if not (k.startswith("utm_") or k in ("futusource", "from", "source"))
        ]
        url = urlunparse(parsed._replace(query=urlencode(kept)))
    return url


def fetch_sitemap_urls(sitemap_url: str = ZHANT_NEWS_SITEMAP) -> list[Article]:
    """
    Parse a news sitemap and return a list of Article objects.

    Tries the explicit URL first (the zhhant 48h sitemap), and falls back
    to discovering it via the sitemap index if that 404s.
    """
    body = _fetch(sitemap_url)
    if not body.strip().startswith("<?xml"):
        raise ValueError(f"unexpected response from {sitemap_url}: not XML")

    articles: list[Article] = []
    for m in _URL_RE.finditer(body):
        url = m.group("url").strip()
        articles.append(
            Article(
                url=url,
                canonical_url=_canonicalize(url),
                title=m.group("title").strip(),
                source=m.group("source").strip(),
                published_at=m.group("date").strip(),
            )
        )

    if not articles:
        # Try the index fallback
        index = _fetch(SITEMAP_INDEX)
        # Find the zhant sitemap in the index
        for loc_m in re.finditer(r"<loc>([^<]+)</loc>", index):
            candidate = loc_m.group(1)
            if "zhhant" in candidate and "quality" not in candidate:
                body = _fetch(candidate)
                for m in _URL_RE.finditer(body):
                    url = m.group("url").strip()
                    articles.append(
                        Article(
                            url=url,
                            canonical_url=_canonicalize(url),
                            title=m.group("title").strip(),
                            source=m.group("source").strip(),
                            published_at=m.group("date").strip(),
                        )
                    )
                break

    # Newest first
    articles.sort(key=lambda a: a.published_at, reverse=True)
    return articles


# —— Seen-URL persistence ——————————————————————————————————

SEEN_PATH = Path.home() / ".cache" / "comparetiger" / "futu_seen_urls.json"


def load_seen() -> set[str]:
    if SEEN_PATH.exists():
        try:
            data = json.loads(SEEN_PATH.read_text())
            if isinstance(data, list):
                return set(data)
        except Exception:
            pass
    return set()


def save_seen(seen: set[str]) -> None:
    SEEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEEN_PATH.write_text(json.dumps(sorted(seen), ensure_ascii=False, indent=2))


def filter_new(articles: list[Article], seen: set[str]) -> list[Article]:
    """Return articles whose URL we haven't seen before."""
    return [a for a in articles if a.url not in seen]


# —— CLI ————————————————————————————————————————————————

if __name__ == "__main__":
    import sys

    arts = fetch_sitemap_urls()
    print(f"Total articles in sitemap: {len(arts)}")
    if arts:
        print("\nNewest 3:")
        for a in arts[:3]:
            print(f"  [{a.published_at}] [{a.source}] {a.title}")
            print(f"    {a.canonical_url}")
    seen = load_seen()
    new = filter_new(arts, seen)
    print(f"\nSeen: {len(seen)}, new: {len(new)}")
    sys.exit(0)