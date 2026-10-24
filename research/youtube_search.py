#!/usr/bin/env python3
"""Run topical YouTube searches, enrich with stats, and dump results as markdown.

Usage:
    set -a && source ../.env && set +a && python3 youtube_search.py

Reads YOUTUBE_API_KEY from the environment (loaded via .env, gitignored).
Edit QUERIES below to add/change search terms, then re-run.

Cost per full run (approx, YouTube Data API v3 quota units):
  - search.list: 100 units x len(QUERIES)
  - videos.list (stats): 1 unit per batch of up to 50 ids
  - commentThreads.list: 1 unit per video (only for COMMENT_PICKS)
Default daily quota is 10,000 units — a full run with ~30 queries is ~3,000-3,200 units.
"""
import html
import json
import os
import subprocess
import sys
import time

API_KEY = os.environ.get("YOUTUBE_API_KEY")
if not API_KEY:
    sys.exit("YOUTUBE_API_KEY not set — source ../.env first")

QUERIES = [
    # --- Market & competitive landscape ---
    ("Fuliza M-Pesa overdraft debt Kenya", "market"),
    ("digital lending apps Kenya debt trap", "market"),
    ("Kenya fintech peer to peer lending", "market"),
    ("chama group lending app Kenya", "market"),
    ("Splitwise alternative bill splitting app", "market"),
    ("Tala app review Kenya", "market"),
    ("Branch loan app Kenya review", "market"),
    ("M-Shwari review Kenya", "market"),
    ("Chamasoft review Kenya", "market"),
    ("M-Changa app review Kenya", "market"),
    # --- Legal / regulatory ---
    ("Central Bank Kenya Digital Credit Providers regulation", "legal"),
    ("Kenya startup fintech regulation CBK licensing", "legal"),
    ("CBK Digital Credit Providers Regulations explained", "legal"),
    ("Kenya digital lending law explained", "legal"),
    ("CRB listing Kenya explained", "legal"),
    ("Kenya Data Protection Act 2019 explained", "legal"),
    # --- Technical ---
    ("Safaricom Daraja API STK push tutorial", "tech"),
    ("M-Pesa API Node.js tutorial", "tech"),
    ("Airtel Money API Kenya integration", "tech"),
    ("Daraja API STK push Python tutorial", "tech"),
    # --- Financial literacy / behavior ---
    ("Kenya financial literacy debt young people", "finance"),
    ("black tax Kenya boundaries lending family", "finance"),
    ("good debt bad debt Kenya webinar", "finance"),
    ("Co-op Bank Foundation financial literacy webinar", "finance"),
    ("Dave Ramsey debt behavior money", "finance"),
    # --- Economy ---
    ("mobile money Kenya economy 2026", "economy"),
    ("Kenya youth unemployment side hustle economy", "economy"),
    # --- Politics / consumer protection ---
    ("Kenya politics digital lending consumer protection", "politics"),
    ("Kenya digital lending consumer protection bill parliament", "politics"),
]

CAT_LABELS = {
    "market": "Market & Competitive Landscape",
    "legal": "Legal / Regulatory",
    "tech": "Technical",
    "finance": "Financial Literacy / Behavior",
    "economy": "Economy",
    "politics": "Politics / Consumer Protection",
}

# After stats are fetched, pull top comments for the N highest-view videos
# per category (real audience sentiment — most useful for market/finance
# categories where the "debt trap" narrative and behavior claims need
# grounding in what people actually say, not just headline claims).
COMMENT_PICKS_PER_CATEGORY = 2
COMMENT_CATEGORIES = {"market", "finance", "legal"}
COMMENTS_PER_VIDEO = 5


def api_get(path, params, retries=2):
    cmd = ["curl", "-s", f"https://www.googleapis.com/youtube/v3/{path}", "-G"]
    for k, v in params.items():
        cmd += ["--data-urlencode", f"{k}={v}"]
    for attempt in range(retries + 1):
        out = subprocess.run(cmd, capture_output=True, text=True).stdout
        try:
            d = json.loads(out)
        except Exception as e:
            if attempt < retries:
                time.sleep(0.5)
                continue
            return None, f"parse error: {e}"
        if "error" in d:
            return None, d["error"].get("message", "unknown error")
        return d, None
    return None, "exhausted retries"


def search(query, max_results=6):
    d, err = api_get("search", {
        "key": API_KEY, "part": "snippet", "q": query,
        "maxResults": max_results, "type": "video", "relevanceLanguage": "en",
    })
    if err:
        return None, err
    return d.get("items", []), None


def fetch_stats(video_ids):
    """videos.list in batches of 50, returns {id: {viewCount, likeCount, duration}}"""
    stats = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i + 50]
        d, err = api_get("videos", {
            "key": API_KEY, "part": "statistics,contentDetails", "id": ",".join(batch),
        })
        if err:
            continue
        for item in d.get("items", []):
            st = item.get("statistics", {})
            cd = item.get("contentDetails", {})
            stats[item["id"]] = {
                "views": int(st.get("viewCount", 0)),
                "likes": int(st.get("likeCount", 0)) if "likeCount" in st else None,
                "duration": cd.get("duration", ""),
            }
    return stats


def fetch_top_comments(video_id, max_results=5):
    d, err = api_get("commentThreads", {
        "key": API_KEY, "part": "snippet", "videoId": video_id,
        "maxResults": max_results, "order": "relevance", "textFormat": "plainText",
    })
    if err:
        return [], err
    out = []
    for item in d.get("items", []):
        top = item["snippet"]["topLevelComment"]["snippet"]
        out.append({
            "author": html.unescape(top.get("authorDisplayName", "")),
            "text": html.unescape(top.get("textDisplay", "")).replace("\n", " ")[:300],
            "likes": top.get("likeCount", 0),
        })
    return out, None


def fmt_duration(iso):
    # crude ISO 8601 duration -> H:MM:SS / M:SS
    import re
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return ""
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    if h:
        return f"{h}:{mi:02d}:{s:02d}"
    return f"{mi}:{s:02d}"


def main():
    results = {}
    errors = []
    for q, cat in QUERIES:
        items, err = search(q)
        if err:
            errors.append((q, err))
            continue
        results[q] = {"category": cat, "items": items}
        time.sleep(0.2)

    all_ids = []
    for obj in results.values():
        all_ids += [it["id"]["videoId"] for it in obj["items"]]
    stats = fetch_stats(list(dict.fromkeys(all_ids)))

    by_cat = {}
    for q, obj in results.items():
        by_cat.setdefault(obj["category"], []).append((q, obj["items"]))

    # pick comment targets: top-viewed videos in the flagged categories
    comment_targets = []
    for cat in COMMENT_CATEGORIES:
        if cat not in by_cat:
            continue
        cat_videos = []
        for q, items in by_cat[cat]:
            for it in items:
                vid = it["id"]["videoId"]
                cat_videos.append((stats.get(vid, {}).get("views", 0), vid, html.unescape(it["snippet"]["title"])))
        cat_videos.sort(reverse=True)
        for _, vid, title in cat_videos[:COMMENT_PICKS_PER_CATEGORY]:
            comment_targets.append((cat, vid, title))

    comments_by_video = {}
    comment_errors = []
    for cat, vid, title in comment_targets:
        comments, err = fetch_top_comments(vid, COMMENTS_PER_VIDEO)
        if err:
            comment_errors.append((title, err))
            continue
        comments_by_video[vid] = {"title": title, "category": cat, "comments": comments}
        time.sleep(0.2)

    lines = [
        "# YouTube Research — Fungu (Peer Debt / IOU App)",
        "",
        "Pulled via YouTube Data API v3, scoped to queries mapped directly to "
        "open questions and themes in `BRAINSTORM.md`. Includes engagement "
        "stats (views/likes/duration) to help triage signal, plus top "
        "audience comments on the highest-viewed market/finance/legal videos "
        "for real sentiment — still needs a human watch-through before "
        "citing anything in a pitch or deck.",
        "",
        f"**Queries run:** {len(results)} · **Videos found:** {len(all_ids)} "
        f"({len(set(all_ids))} unique) · **Comment threads pulled:** {len(comments_by_video)}",
        "",
    ]

    for cat_key in ["market", "legal", "tech", "finance", "economy", "politics"]:
        if cat_key not in by_cat:
            continue
        lines.append(f"## {CAT_LABELS[cat_key]}")
        lines.append("")
        for q, items in by_cat[cat_key]:
            lines.append(f"### Query: \"{q}\"")
            lines.append("")
            if not items:
                lines.append("_No results._")
                lines.append("")
                continue
            lines.append("| Title | Channel | Published | Views | Duration | Link |")
            lines.append("|---|---|---|---|---|---|")
            for it in items:
                vid = it["id"]["videoId"]
                sn = it["snippet"]
                title = html.unescape(sn["title"]).replace("|", "-").replace("\n", " ")
                channel = html.unescape(sn["channelTitle"]).replace("|", "-")
                published = sn["publishedAt"][:10]
                url = f"https://www.youtube.com/watch?v={vid}"
                st = stats.get(vid, {})
                views = f"{st.get('views', 0):,}" if st else "?"
                dur = fmt_duration(st.get("duration", "")) if st else ""
                lines.append(f"| {title} | {channel} | {published} | {views} | {dur} | [{vid}]({url}) |")
            lines.append("")

    if comments_by_video:
        lines.append("## Top comments — highest-viewed market/finance/legal videos")
        lines.append("")
        lines.append("Sampled for real sentiment, not vetted for accuracy — treat as anecdote, not data.")
        lines.append("")
        for vid, obj in comments_by_video.items():
            url = f"https://www.youtube.com/watch?v={vid}"
            lines.append(f"### [{obj['title']}]({url}) ({obj['category']})")
            lines.append("")
            if not obj["comments"]:
                lines.append("_No comments returned (may be disabled)._")
            for c in obj["comments"]:
                lines.append(f"- **{c['author']}** ({c['likes']} likes): {c['text']}")
            lines.append("")

    if errors or comment_errors:
        lines.append("## Errors")
        lines.append("")
        for q, e in errors:
            lines.append(f"- search `{q}`: {e}")
        for title, e in comment_errors:
            lines.append(f"- comments for `{title}`: {e}")
        lines.append("")

    out_path = os.path.join(os.path.dirname(__file__), "youtube-research.md")
    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {out_path} ({len(results)} queries ok, {len(errors)} errors, "
          f"{len(comments_by_video)} comment threads, {len(comment_errors)} comment errors)")


if __name__ == "__main__":
    main()
