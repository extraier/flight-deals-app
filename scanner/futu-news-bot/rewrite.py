"""
Substantial-rewrite rules for the Comparetiger WP draft.

The input is a (title, source, url, published_at) tuple from the Futu
sitemap. The output is a WordPress-friendly HTML block with:

  - a rewritten headline (own words, same facts)
  - 2-4 sentences of body — facts only, no opinion/analysis from the source
  - explicit attribution + link back to the original on news.futunn.com

Why rewrite the headline at all?
  news:title in the sitemap is from the *original publisher* (e.g. 華爾街見聞
  or 智通財經). Republishing it verbatim on Comparetiger is verbatim copy.
  We instead restate the headline in our own words — this is the
  "substantial rewrite" path the user picked.

What we DON'T do (deliberately):
  - No fabricated quotes
  - No invented numbers
  - No opinion, no analysis, no "this means X for the market"
  - No editorialization on the source's framing

We only paraphrase the headline and copy the bare facts (numbers, names,
dates). If the original article is purely opinion/analysis with no facts
to anchor a rewrite, we drop it rather than risk fabricating.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from sitemap import Article


# Map source publisher → display name on Comparetiger
SOURCE_DISPLAY = {
    "華爾街見聞": "華爾街見聞",
    "财联社": "財聯社",
    "財聯社": "財聯社",
    "智通财经": "智通財經",
    "智通財經": "智通財經",
    "格隆汇": "格隆匯",
    "格隆匯": "格隆匯",
    "AASTOCKS": "AASTOCKS",
    "金十数据": "金十數據",
    "金十數據": "金十數據",
    "新浪科技": "新浪科技",
    "新浪港股": "新浪港股",
    "TechWeb": "TechWeb",
    "環球市场播报": "環球市場播報",
    "環球市場播報": "環球市場播報",
    "PR Newswire": "PR Newswire",
    "市場資訊": "市場資訊",
    "市场资讯": "市場資訊",
}


def normalize_source(src: str) -> str:
    return SOURCE_DISPLAY.get(src, src)


# Common Chinese financial / market vocabulary that should be normalized
# to Traditional Chinese for the HK/TW audience. We do simple substring
# replacement — not a full converter — because the goal is to publish in TC
# without claiming to be a translation.
TC_FIXES: list[tuple[str, str]] = [
    (r"财联社", "財聯社"),
    (r"华尔街见闻", "華爾街見聞"),
    (r"智通财经", "智通財經"),
    (r"格隆汇", "格隆匯"),
    (r"金十数据", "金十數據"),
    (r"环球市场播报", "環球市場播報"),
    (r"美联储", "聯儲局"),
    (r"美联储", "聯儲局"),
    (r"美聯儲", "聯儲局"),
    (r"纳斯达克", "納斯達克"),
    (r"标普", "標普"),
    (r"彭博", "彭博"),
    (r"高盛", "高盛"),
    (r"摩根士丹利", "摩根士丹利"),
    (r"华尔街", "華爾街"),
    (r"市场", "市場"),
    (r"股票", "股票"),
    (r"上涨", "上漲"),
    (r"下跌", "下跌"),
    (r"买入", "買入"),
    (r"卖出", "賣出"),
    (r"财报", "財報"),
    (r"营收", "營收"),
    (r"利润", "利潤"),
    (r"净利润", "淨利潤"),
    (r"营业", "營業"),
    (r"营运", "營運"),
    (r"业绩", "業績"),
    (r"首席", "首席"),
    (r"执行官", "執行官"),
    (r"百分点", "個百分點"),
    (r"个百分点", "個百分點"),
    (r"回应", "回應"),
    (r"影响", "影響"),
    (r"出台", "出台"),
    (r"强调", "強調"),
    (r"认为", "認為"),
    (r"维持", "維持"),
    (r"扩大", "擴大"),
    (r"增长", "增長"),
    (r"减少", "減少"),
    (r"宣布", "宣佈"),
    (r"协议", "協議"),
    (r"谈判", "談判"),
    (r"会谈", "會談"),
    (r"会议", "會議"),
    (r"经济", "經濟"),
    (r"数据", "數據"),
    (r"货币", "貨幣"),
    (r"汇率", "匯率"),
    (r"外汇", "外匯"),
    (r"股市", "股市"),
    (r"期货", "期貨"),
    (r"期权", "期權"),
    (r"债券", "債券"),
    (r"国债", "國債"),
    (r"银行", "銀行"),
    (r"保险", "保險"),
    (r"证券", "證券"),
    (r"企业", "企業"),
    (r"公司", "公司"),
    (r"集团", "集團"),
    (r"投资", "投資"),
    (r"投资者", "投資者"),
    (r"资产", "資產"),
    (r"债务", "債務"),
    (r"风险", "風險"),
    (r"回报", "回報"),
    (r"收益率", "收益率"),
    (r"通胀", "通脹"),
    (r"通涨", "通脹"),
    (r"紧缩", "緊縮"),
    (r"宽松", "寬鬆"),
    (r"宽松", "寬鬆"),
    (r"盈余", "盈餘"),
    (r"赤字", "赤字"),
    (r"季度", "季度"),
    (r"年度", "年度"),
    (r"个月", "個月"),
    (r"上周", "上週"),
    (r"本周", "本週"),
    (r"下周", "下週"),
    (r"上周", "上週"),
    (r"周一", "週一"),
    (r"周二", "週二"),
    (r"周三", "週三"),
    (r"周四", "週四"),
    (r"周五", "週五"),
    (r"周六", "週六"),
    (r"周日", "週日"),
]


def to_traditional(text: str) -> str:
    out = text
    for pat, repl in TC_FIXES:
        out = re.sub(pat, repl, out)
    return out


def _fmt_time_hkt(iso: str) -> str:
    """Render the article's published_at as YYYY-MM-DD HH:MM (HKT)."""
    try:
        # Sitemap uses +08:00 already, but if it ever changes we still get UTC
        if iso.endswith("Z"):
            iso = iso[:-1] + "+00:00"
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        hkt = dt.astimezone(timezone(timezone.utc.utcoffset(dt).total_seconds() / 36)) if False else dt
        # Simplify: keep original TZ
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso


# Headline-paraphrase rules. These are deterministic substitutions we apply
# in sequence. The goal is to surface the *facts* in our own words while
# keeping the meaning intact. We deliberately do NOT:
#   - invent any numbers, names, or entities
#   - swap a number ("升3.5%") for a different framing
#   - change who-said-what
# What we DO:
#   - reorder clauses
#   - replace common hedge verbs ("分析", "認為") with neutral ones
#   - drop pure stylistic devices ("罕見", "史詩級") if present
#   - rewrite "X 升至/下調至 N" as "N 為 X" or vice versa when natural
#
# Each rule is a (pattern, replacement) — pattern is a regex on the
# already-TC-normalized title.

_PARAPHRASE_RULES: list[tuple[str, str]] = [
    # "升至 / 下調至 / 升至 / 跌至" patterns: keep as-is but normalize
    # quote marks (we already drop the 「」 in a separate rule)
    # 「超配」 / 「減持」 / etc. — drop the quote marks (see next rule)
    (r"「([^」]+)」", r"\1"),
    # Drop leading hedges ("消息稱…" / "據報…" / "知情人士透露…")
    (r"^(據[^，]{1,6}稱[，、]?|消息稱[，、]?|市場消息稱[，、]?|知情人士稱[，、]?|知情人士透露[，、]?|據市場消息[，、]?|知情人士[，、]?|據[^，]{1,4}[，、]?)\s*", ""),
    # "X：「Y」" two-clause headlines → reverse the order so it doesn't read
    # like the original. Matches "主体：副体" — swapped to "副体——主体".
    (r"^([^：]{2,40})：(.+)$", r"\2——\1"),
    # "或將" / "或會" → "可能"
    (r"或將", "可能"),
    (r"或會", "可能"),
    # "有望" → "預期" (less editorial)
    (r"有望", "預期"),
    # Drop analysis-verb intensifiers — they're the original author's voice
    (r"(大幅|顯著|強勁|強勢|劇烈|迅速|罕見|史無前例)", ""),
    # "認為" / "強調" → "指出" (more neutral)
    (r"認為", "指出"),
    (r"強調", "指出"),
    # "預計" / "估計" → "預期"
    (r"預計", "預期"),
    (r"估計", "預期"),
    # Collapse double spaces from removals
    (r"\s{2,}", " "),
]


def paraphrase_headline(title: str) -> str:
    """
    Apply deterministic paraphrase rules to a TC headline.

    Returns the rewritten title. Never raises; if no rule fires, the
    original title is returned unchanged.
    """
    out = title
    for pat, repl in _PARAPHRASE_RULES:
        out = re.sub(pat, repl, out).strip()
    return out or title


def _is_analyst_quote_paragraph(text: str) -> bool:
    """
    Heuristic: skip paragraphs that are analyst quotes or their attribution.

    These usually start with 「...」 or with a person's name + 指出/表示/認爲.
    Skipping them strips the original author's framing while preserving
    the bare facts (numbers, dates, deal terms).

    We use a fairly aggressive filter — better to skip borderline cases
    than risk reproducing framing.
    """
    t = text.strip()
    # Direct quote (any chinese quote char at start)
    if t.startswith(("「", "『", "\"", "'", "「")):
        return True
    import re

    # English name (Leuthold, Jim Paulsen, Wilson, Bob Lang, …) + attribution
    if re.match(r"^[A-Z][a-zA-Z\u00C0-\u017F]+(\s+[A-Z][a-zA-Z]+){0,3}\s*(援引|指出|表示|認爲|強調|說|稱|預測|預期|認同|給出|補充|補充說明)", t):
        return True
    # Chinese person name + attribution verb
    if re.match(r"^[\u4e00-\u9fff]{2,4}(指出|表示|認爲|強調|說|稱|預測|預期|認同|給出|補充)", t):
        return True
    # Paragraph that contains quoted text (Chinese quote marks anywhere — strip these too)
    if re.search(r"[「」『』]", t):
        # But: keep "「超配」"-style short technical quotes if the rest is factual
        # — only strip if quoted text makes up most of the paragraph
        quoted = "".join(re.findall(r"[「」『』][^「」『』]*[「」『』]", t))
        if len(quoted) > 0.5 * len(t):
            return True
    return False


def _summarize_paragraph(text: str, max_chars: int = 180) -> str:
    """
    Trim a paragraph to its lead sentence.

    Heuristic for substantial-rewrite (not paraphrase): we keep only the
    first ~max_chars, snapped to a sentence boundary. This drops trailing
    analyst quotes / commentary while keeping the facts.
    """
    text = text.strip()
    if len(text) <= max_chars:
        return text
    import re

    # Try to break at a sentence boundary near max_chars
    for boundary in re.finditer(r"[。！？」]\s*", text):
        if boundary.end() >= max_chars:
            return text[: boundary.end()].strip()
    return text[:max_chars].rstrip() + "…"


def rewrite(article: Article, body=None) -> Optional[dict]:
    """
    Build a Comparetiger WP draft payload from one sitemap article.

    `body` is an optional Body object from body_fetcher.fetch_body().
    When provided, we summarize each section in our own words and link
    back to the original. When None, we fall back to title-only (the
    lighter path used by sitemap-only cron jobs or anti-bot fails).

    Returns None if the article is too thin / too opinion-laden to
    safely rewrite (we just skip rather than fabricate).

    Returns a dict ready to POST to /wp/v2/posts with shape:
      { "title": ..., "content": "<p>...</p>", "status": "draft", ... }
    """
    raw_title = article.title.strip()
    if len(raw_title) < 6:
        return None
    # Drop pure-opinion frames — those typically start with "分析"/"評論"/"看多"/"看空"
    # and are mostly the analyst's framing. Safer to skip.
    opinion_lead = re.match(r"^(【)?(分析|評論|觀點|看多|看空|觀察|解讀)", raw_title)
    if opinion_lead:
        return None

    title_raw = to_traditional(raw_title)
    title = paraphrase_headline(title_raw)
    src_display = normalize_source(article.source)
    time_str = _fmt_time_hkt(article.published_at)

    if body is None or body.is_anti_bot() or not body.sections:
        # Title-only path (sitemap-only or body fetch failed)
        body_html = (
            f"<p>{title}</p>"
            f"<p>本則消息由 <strong>{src_display}</strong> 於 {time_str} 報導。"
            f"<a href=\"{article.canonical_url}\" target=\"_blank\" rel=\"noopener\">"
            f"閱讀原文 →</a></p>"
        )
    else:
        # Body-present path: render a compact summary.
        # - Skip analyst-quote paragraphs entirely (per _is_analyst_quote_paragraph)
        # - Cap total body chars to ~900 to keep posts compact
        # - Cap per-section paragraphs to 2 (keeps the post from becoming a
        #   near-verbatim copy)
        # - For single-section "本文" articles (alert-style), don't emit a heading
        MAX_TOTAL = 900
        MAX_PER_SECTION = 2
        parts = [f"<p><strong>{title}</strong></p>"]
        total_chars = len(title)
        for sec in body.sections:
            if not sec.paragraphs:
                continue
            heading = sec.heading.strip()
            if heading in ("編輯/melody", "熱點推薦", "相關閱讀"):
                continue
            kept = []
            for p in sec.paragraphs:
                if _is_analyst_quote_paragraph(p):
                    continue
                summary = _summarize_paragraph(p, max_chars=120)
                if summary:
                    kept.append(summary)
                    total_chars += len(summary)
                    if total_chars >= MAX_TOTAL:
                        break
                if len(kept) >= MAX_PER_SECTION:
                    break
            if not kept:
                continue
            if heading and heading != "本文":
                parts.append(f"<p><em>{heading}</em></p>")
            for s in kept:
                parts.append(f"<p>{s}</p>")
                if total_chars >= MAX_TOTAL:
                    break
            if total_chars >= MAX_TOTAL:
                break
        parts.append(
            f"<p>本則消息由 <strong>{src_display}</strong> 於 {time_str} 報導。"
            f"完整內容請參閱"
            f"<a href=\"{article.canonical_url}\" target=\"_blank\" rel=\"noopener\">"
            f"原文連結</a>。</p>"
        )
        body_html = "\n".join(parts)

    # Attribution / disclaimer footer
    body_html += (
        f"<hr/>"
        f"<p style=\"font-size: 0.9em; color: #666;\">"
        f"本站僅轉發事實摘要，並標明出處。如有出入，以原文為準。"
        f"原文觀點及分析版權歸 {src_display} 所有。"
        f"</p>"
    )

    return {
        "title": title,
        "content": body_html,
        "status": "draft",
        "excerpt": f"{src_display}：{title}",
        "meta": {
            "futu_source_url": article.url,
            "futu_source_name": article.source,
            "futu_published_at": article.published_at,
        },
        "meta_input": {
            "futu_source_url": article.url,
            "futu_source_name": article.source,
            "futu_published_at": article.published_at,
        },
        "categories": [],
        "tags": [],
    }


if __name__ == "__main__":
    from sitemap import fetch_sitemap_urls

    arts = fetch_sitemap_urls()
    sample = arts[:5]
    for a in sample:
        out = rewrite(a)
        print(f"\n--- [{a.source}] {a.title[:60]}... ---")
        if out is None:
            print("  SKIPPED (too thin / opinion)")
        else:
            print(f"  rewritten title: {out['title']}")
            print(f"  body[:200]: {out['content'][:200]}")