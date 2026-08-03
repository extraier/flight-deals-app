"""
Bake the Comparetiger 財經新聞 page (WP page 10215) as static HTML.

Why static HTML instead of iframe/Vite?
- Users stay on comparetiger.com (better ad revenue, page views, SEO)
- No iframe scroll quirks, no Vercel dependency, no JS bundle
- Looks native next to the existing flight-deal scanner pages
- Auto-rebuilt hourly by the cron (just add `--publish-page` flag)

Output goes into WP page 10215's `content` field. The page already
exists (slug: 財經新聞) but is empty.

Design language matches the rest of Comparetiger:
- max-width 900px centered (matches the HK Express Scanner page)
- Cards in a 2-col grid on desktop, 1-col on mobile (CSS @media)
- Navy header (#1a1a2e) at top, blue accents (#1a88ff) on titles
- Source badge per publisher (color-coded, mirrors the Vite SPA)
"""
from __future__ import annotations

import re
from datetime import datetime

import wp


# —— Source colors (same palette as Vite SPA) ——————————————————
SOURCE_COLORS: dict[str, str] = {
    "華爾街見聞":  "#dbeafe",  # blue-100
    "財聯社":      "#ffe4e6",  # rose-100
    "智通財經":    "#d1fae5",  # emerald-100
    "格隆匯":      "#ede9fe",  # violet-100
    "AASTOCKS":    "#fef3c7",  # amber-100
    "金十數據":    "#ffedd5",  # orange-100
    "PR Newswire": "#e0f2fe",  # sky-100
    "新浪科技":    "#fce7f3",  # pink-100
    "新浪港股":    "#fce7f3",
    "TechWeb":     "#e0e7ff",  # indigo-100
    "環球市場播報": "#ccfbf1",  # teal-100
    "市場資訊":    "#f1f5f9",  # slate-100
}
DEFAULT_BG = "#f1f5f9"

KNOWN_SOURCES = list(SOURCE_COLORS.keys())


def extract_source(excerpt_html: str) -> str:
    """Parse "{Source}：..." or "{Source}: ..." prefix from the WP excerpt."""
    text = re.sub(r"<[^>]+>", "", excerpt_html or "").strip()
    for name in KNOWN_SOURCES:
        if text.startswith(name + "：") or text.startswith(name + ":"):
            return name
    return "Comparetiger"


def _fmt_hkt(iso: str) -> str:
    """Render ISO timestamp as YYYY-MM-DD HH:MM (best-effort HKT)."""
    if not iso:
        return ""
    try:
        iso2 = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
        dt = datetime.fromisoformat(iso2)
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso


def _strip_excerpt_source_prefix(excerpt_html: str) -> str:
    """Drop the '{Source}：' prefix from the excerpt so cards don't show
    the source twice (we already render a badge for that)."""
    text = re.sub(r"<[^>]+>", "", excerpt_html or "").strip()
    for name in KNOWN_SOURCES:
        for sep in ("：", ":"):
            if text.startswith(name + sep):
                return text[len(name) + len(sep) :].strip()
    return text


def _html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _truncate_words(text: str, max_chars: int = 180) -> str:
    """Take the lead sentence(s), snap to ~max_chars."""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    slice_ = text[:max_chars]
    last_break = max(slice_.rfind("。"), slice_.rfind("！"), slice_.rfind("？"))
    if last_break > max_chars * 0.6:
        return slice_[: last_break + 1]
    return slice_ + "…"


# —— HTML template ————————————————————————————————————

def _page_css() -> str:
    """Embedded styles. Inline because Comparetiger pages don't load external CSS."""
    return """
<style>
.ct-news-wrap { max-width: 960px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", Arial, sans-serif; }
.ct-news-header { background: linear-gradient(135deg, #1a1a2e 0%, #1a88ff 100%); color: white; padding: 12px 20px; border-radius: 12px; margin-bottom: 18px; box-shadow: 0 4px 12px rgba(26,34,46,0.15); }
.ct-news-header h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
.ct-news-header p { margin: 0; font-size: 12px; opacity: 0.92; }
.ct-news-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 720px) { .ct-news-grid { grid-template-columns: 1fr; } }
.ct-news-card { background: white; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.04); display: flex; flex-direction: column; }
.ct-news-card:hover { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(0,0,0,0.08); border-color: #1a88ff; }
.ct-news-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.ct-news-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.ct-news-time { font-size: 11px; color: #6b7280; }
.ct-news-title { font-size: 15px; font-weight: 600; line-height: 1.4; margin: 0 0 8px; color: #1a1a2e; }
.ct-news-title a { color: #1a1a2e; text-decoration: none; }
.ct-news-title a:hover { color: #1a88ff; text-decoration: underline; }
.ct-news-excerpt { font-size: 13px; line-height: 1.55; color: #4b5563; margin: 0 0 12px; flex-grow: 1; }
.ct-news-foot { padding-top: 10px; border-top: 1px solid #f3f4f6; font-size: 11px; color: #6b7280; display: flex; justify-content: space-between; align-items: center; }
.ct-news-foot a { color: #1a88ff; text-decoration: none; }
.ct-news-foot a:hover { text-decoration: underline; }
.ct-news-footer { text-align: center; padding: 24px 16px 8px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; margin-top: 24px; line-height: 1.6; }
.ct-news-empty { text-align: center; padding: 40px 20px; color: #6b7280; background: #f9fafb; border-radius: 10px; border: 1px dashed #d1d5db; }
</style>
"""


def render_card(post: dict) -> str:
    """Render one news article as a card."""
    title = post.get("title", {}).get("rendered", "")
    link = post.get("link", "")
    excerpt_html = post.get("excerpt", {}).get("rendered", "")
    date_gmt = post.get("date_gmt", "")

    # Source from excerpt prefix
    source = extract_source(excerpt_html)
    bg = SOURCE_COLORS.get(source, DEFAULT_BG)

    # Excerpt body (without source prefix, truncated)
    excerpt_clean = _strip_excerpt_source_prefix(excerpt_html)
    excerpt = _truncate_words(excerpt_clean, max_chars=200)
    excerpt = _html_escape(excerpt)

    # Time
    time_str = _fmt_hkt(date_gmt)

    # Title — strip HTML
    title_clean = _html_escape(re.sub(r"<[^>]+>", "", title))

    return (
        f'<article class="ct-news-card">'
        f'<div class="ct-news-meta">'
        f'<span class="ct-news-badge" style="background: {bg};">{_html_escape(source)}</span>'
        f'<span class="ct-news-time">{_html_escape(time_str)}</span>'
        f'</div>'
        f'<h3 class="ct-news-title"><a href="{_html_escape(link)}">{title_clean}</a></h3>'
        f'<p class="ct-news-excerpt">{excerpt}</p>'
        f'<div class="ct-news-foot">'
        f'<a href="{_html_escape(link)}">閱讀全文 →</a>'
        f'<span>#{post.get("id", "?")}</span>'
        f'</div>'
        f'</article>'
    )


def render_page_html(limit: int = 15) -> str:
    """
    Build the full HTML body for WP page 10215.

    Returns a single string suitable for the WP page `content` field.
    Cards stay on Comparetiger when clicked (link target = same tab).
    """
    status, posts = wp.list_recent_finance_posts(limit=limit)
    if status != 200 or not posts:
        return (
            '<div class="ct-news-empty">'
            '<p>暫無財經新聞</p>'
            '<p>稍後再試，或查看其他分類</p>'
            '</div>'
        )

    # Header — Comparetiger navy→blue gradient. No <h1> here because
    # the WP theme already renders "財經新聞" as the page title (the
    # rendered HTML <article><h1>). We just add the gradient banner with
    # source list + auto-update note so the page has visual identity.
    header = (
        '<div class="ct-news-wrap">'
        '<div class="ct-news-header">'
        '<p>即時摘要 · 來源：華爾街見聞、財聯社、智通財經、格隆匯、AASTOCKS、金十數據 等'
        ' · 每小時自動更新</p>'
        '</div>'
    )

    # Cards
    cards = "\n".join(render_card(p) for p in posts)
    grid = f'<div class="ct-news-grid">{cards}</div>'

    # Footer
    footer = (
        '<div class="ct-news-footer">'
        '<p>本頁為 Comparetiger 自動轉發之事實摘要。'
        '原文觀點及分析版權歸各原發佈機構所有。如有出入，以原文為準。</p>'
        '<p>資料來源：<a href="https://news.futunn.com" target="_blank" rel="noopener">'
        '富途牛牛財經新聞</a></p>'
        '</div>'
        '</div>'  # close ct-news-wrap
    )

    # Full page = css + body
    return _page_css() + header + grid + footer


if __name__ == "__main__":
    import os, sys

    if not os.environ.get("COMPRETIGER_WP_PASSWORD"):
        print("COMPRETIGER_WP_PASSWORD env var is required", file=sys.stderr)
        sys.exit(2)

    html = render_page_html(limit=15)
    print(f"rendered {len(html)} chars")
    # Uncomment to preview in stdout:
    # print(html)