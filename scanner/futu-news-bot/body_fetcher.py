"""
Browser-based article body fetcher for news.futunn.com.

news.futunn.com serves article pages behind a JS anti-bot challenge that
urllib cannot solve. We use Playwright headless Chromium (already in
the container at /ms-playwright/chromium-1129/) to navigate, wait for
the challenge to clear, then extract structured content via DOM query.

Why Playwright (vs raw CDP via subprocess)?
  - The flight-deals-app images already include Playwright Python; same
    dependency surface
  - Auto-wait, retry, and clean DOM extraction in ~50 lines vs ~200 for
    direct CDP
  - PLAYWRIGHT_BROWSERS_PATH=/ms-playwright points at the bundled binary

Output: Body dataclass with the title, source attribution, and an
ordered list of (heading, paragraphs) sub-sections. Same shape as the
visible DOM structure — no LLM needed to chunk it.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Optional

# Set BEFORE importing playwright (the env var must be set at process start
# for the module-level browser-resolution to find /ms-playwright/chromium-1129/).
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/ms-playwright")

from playwright.sync_api import sync_playwright, Browser, TimeoutError as PWTimeout

log = logging.getLogger("futu.body")

# Anti-bot detection: the challenge page has <title>Document</title> and
# zero <h1> elements with meaningful text. We bail if we land there.
ANTI_BOT_TITLE = "Document"


@dataclass
class Section:
    heading: str
    paragraphs: list[str] = field(default_factory=list)


@dataclass
class Body:
    url: str
    title: str
    source_label: Optional[str] = None  # e.g. "富途資訊 · 08:15"
    published_label: Optional[str] = None  # e.g. "08:15"
    sections: list[Section] = field(default_factory=list)

    @property
    def total_chars(self) -> int:
        n = len(self.title)
        for s in self.sections:
            n += len(s.heading)
            for p in s.paragraphs:
                n += len(p)
        return n

    def is_anti_bot(self) -> bool:
        return self.title == ANTI_BOT_TITLE or not self.sections


# —— Single shared browser across fetches in one run ————————

_browser: Optional[Browser] = None


def _get_browser() -> Browser:
    """Lazy-init a headless Chromium browser, reuse across fetches."""
    global _browser
    if _browser is None or not _browser.is_connected():
        from playwright.sync_api import sync_playwright

        pw = sync_playwright().start()
        _browser = pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--lang=zh-HK,zh-Hant;q=0.9",
            ],
        )
    return _browser


def close_browser() -> None:
    global _browser
    if _browser is not None:
        try:
            _browser.close()
        except Exception:
            pass
        _browser = None


# —— Extraction ————————————————————————————————————————

# JS extracted via querySelectorAll — runs inside the page. Returns a
# JSON-serializable dict. We do the parsing in Python after.
_EXTRACT_JS = r"""
() => {
  // Anti-bot check: title == "Document" and no <h1>
  const t = (document.title || '').trim();
  if (t === 'Document') {
    return { anti_bot: true, title: t };
  }

  const h1 = document.querySelector('h1');
  const title = (h1 ? h1.textContent : t).trim();

  // Walk every <p> in document.body. We split into sections by:
  //   - H2 headings (most articles)
  //   - Bold leading paragraph (alert-style articles from 智通財經/AASTOCKS)
  //   - Source attribution paragraphs (skip these)
  //   - "編輯/<name>" / "譯文內容由..." / "以上內容僅用作..." footers (skip)

  const isSourceFooter = (txt) => {
    const t2 = txt.trim();
    if (t2.startsWith('編輯/')) return true;
    if (t2.startsWith('譯文內容由')) return true;
    if (t2.startsWith('以上內容僅用作')) return true;
    if (t2.includes('風險及免責聲明')) return true;
    if (t2 === '-') return true;
    if (t2.match(/^讚好\s*\d+/)) return true;
    if (t2.match(/^瀏覽\s*[\d.]+/)) return true;
    return false;
  };

  const cleanP = (node) => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('a').forEach(a => {
      const text = (a.textContent || '').trim();
      if (text) {
        a.replaceWith(document.createTextNode(text));
      } else {
        a.remove();
      }
    });
    return (clone.textContent || '').trim();
  };

  const sections = [];
  let current = null;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.tagName === 'H2') {
      const heading = (node.textContent || '').trim();
      if (heading && !heading.match(/^(熱點推薦|熱門話題|搶先評論|熱門市場機會|成交額|相關閱讀|編輯\/)/)) {
        if (current) sections.push(current);
        current = { heading, paragraphs: [] };
      }
      continue;
    }

    if (node.tagName !== 'P') continue;
    const text = cleanP(node);
    if (!text || text.length < 4) continue;
    if (isSourceFooter(text)) continue;

    // If we don't have a current section yet, treat this as a single-
    // section article. The first <p> is usually the lead/bold summary.
    if (!current) {
      // Skip the title-duplicate first paragraph (it's bolded = the headline)
      // and treat the second paragraph as the first content paragraph of an
      // implicit "本文" section.
      if (text === title) {
        current = { heading: '本文', paragraphs: [] };
        continue;
      }
      current = { heading: '本文', paragraphs: [] };
    }
    current.paragraphs.push(text);
  }
  if (current) sections.push(current);

  // Filter out sections with no paragraphs
  const filtered = sections.filter(s => s.paragraphs.length > 0);

  return {
    anti_bot: false,
    title,
    sections: filtered,
  };
}
"""


def fetch_body(url: str, *, timeout_ms: int = 30000) -> Optional[Body]:
    """
    Navigate to a news.futunn.com article and extract structured body.

    Returns None if the page is the anti-bot challenge, the request times
    out, or the page is missing a real title.
    """
    browser = _get_browser()
    page = browser.new_page(
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        ),
        locale="zh-HK",
    )
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        # Give the JS anti-bot + Nuxt hydration a moment to settle
        page.wait_for_timeout(2000)
        try:
            page.wait_for_selector("h1", timeout=timeout_ms - 2000)
        except PWTimeout:
            pass

        result = page.evaluate(_EXTRACT_JS)

        if not isinstance(result, dict):
            log.warning("extract returned non-dict for %s: %r", url, result)
            return None

        if result.get("anti_bot"):
            log.warning("anti-bot challenge at %s", url)
            return None

        title = (result.get("title") or "").strip()
        if not title or title == ANTI_BOT_TITLE:
            return None

        sections = [
            Section(heading=s["heading"], paragraphs=s.get("paragraphs", []))
            for s in result.get("sections", [])
        ]
        return Body(url=url, title=title, sections=sections)

    except PWTimeout as e:
        log.warning("timeout fetching %s: %s", url, e)
        return None
    except Exception as e:
        log.warning("error fetching %s: %s: %s", url, type(e).__name__, e)
        return None
    finally:
        page.close()


# —— CLI ————————————————————————————————————————————————

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if len(sys.argv) < 2:
        print("usage: body_fetcher.py <url> [<url>...]")
        sys.exit(1)

    for url in sys.argv[1:]:
        print(f"\n=== {url} ===")
        b = fetch_body(url)
        if b is None:
            print("(none — anti-bot or error)")
            continue
        print(f"title: {b.title}")
        print(f"total_chars: {b.total_chars}")
        print(f"sections: {len(b.sections)}")
        for s in b.sections[:3]:
            print(f"  [{s.heading}] {len(s.paragraphs)} paragraphs")
            for p in s.paragraphs[:2]:
                print(f"    - {p[:140]}")

    close_browser()