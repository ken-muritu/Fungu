#!/usr/bin/env python3
"""Second-pass YouTube research: broader Kenya/Africa startup ecosystem,
African fintech beyond Kenya, and global consumer money-app patterns.
Separate from youtube_search.py (which stays scoped to Fungu's specific
peer-debt/IOU themes) to avoid re-burning quota on already-covered ground
and to keep the two research angles distinct in the repo.

Usage:
    set -a && source ../.env && set +a && python3 youtube_search_expansion.py
"""
import html
import json
import os
import re
import subprocess
import sys
import time

API_KEY = os.environ.get("YOUTUBE_API_KEY")
if not API_KEY:
    sys.exit("YOUTUBE_API_KEY not set — source ../.env first")

QUERIES = [
    # --- Kenya startup ecosystem (broad, beyond lending) ---
    ("Kenya startup ecosystem 2026", "kenya_startups"),
    ("Kenya tech startup funding round venture capital", "kenya_startups"),
    ("Nairobi Silicon Savannah startups", "kenya_startups"),
    ("Kenya startup accelerator iHub Nailab", "kenya_startups"),
    ("Kenya unicorn startup story", "kenya_startups"),
    ("Kenya startup founder interview", "kenya_startups"),
    # --- African fintech beyond Kenya ---
    ("Flutterwave Nigeria fintech story", "africa_fintech"),
    ("Paystack fintech Africa story", "africa_fintech"),
    ("Chipper Cash Africa payments app", "africa_fintech"),
    ("OPay Nigeria super app", "africa_fintech"),
    ("Africa fintech unicorn funding 2026", "africa_fintech"),
    ("African mobile money interoperability", "africa_fintech"),
    # --- Global consumer money apps (feature/UX inspiration) ---
    ("Venmo app review features", "global_money_apps"),
    ("Cash App peer to peer payments review", "global_money_apps"),
    ("Revolut app review features", "global_money_apps"),
    ("best personal finance apps 2026", "global_money_apps"),
    ("buy now pay later app explained", "global_money_apps"),
    # --- Broader money-tech / infrastructure ---
    ("embedded finance explained", "money_tech_infra"),
    ("USSD vs app banking Africa", "money_tech_infra"),
    ("super app strategy Africa", "money_tech_infra"),
    ("neobank Africa 2026", "money_tech_infra"),
]

CAT_LABELS = {
    "kenya_startups": "Kenya Startup Ecosystem (Broad)",
    "africa_fintech": "African Fintech Beyond Kenya",
    "global_money_apps": "Global Consumer Money Apps (Feature/UX Inspiration)",
    "money_tech_infra": "Broader Money-Tech Infrastructure",
}

COMMENT_PICKS_PER_CATEGORY = 2
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

    comment_targets = []
    for cat in by_cat:
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
        "# YouTube Research — Expansion: Kenya/Africa Startups & Global Money Apps",
        "",
        "Second-pass research, broader than Fungu's specific peer-debt/IOU niche: "
        "the wider Kenya startup ecosystem, African fintech beyond Kenya "
        "(Nigeria/Ghana/pan-African players), and global consumer money-app "
        "patterns worth stealing UX/feature ideas from. Companion to "
        "`youtube-research.md`, which stays scoped to peer-lending specifics. "
        "Same caveat applies: discovery pass, not vetted — watch before citing.",
        "",
        f"**Queries run:** {len(results)} · **Videos found:** {len(all_ids)} "
        f"({len(set(all_ids))} unique) · **Comment threads pulled:** {len(comments_by_video)}",
        "",
    ]

    for cat_key in ["kenya_startups", "africa_fintech", "global_money_apps", "money_tech_infra"]:
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
        lines.append("## Top comments — highest-viewed video per category")
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

    out_path = os.path.join(os.path.dirname(__file__), "youtube-research-expansion.md")
    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {out_path} ({len(results)} queries ok, {len(errors)} errors, "
          f"{len(comments_by_video)} comment threads, {len(comment_errors)} comment errors)")


if __name__ == "__main__":
    main()
