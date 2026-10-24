#!/usr/bin/env python3
"""Final research pass: build-and-ship focus.
- Programming with Mosh + a few directly related dev/build channels
  (technical tutorials relevant to shipping Fungu as web + APK).
- Topical: startup mistakes/postmortems (avoid known failure modes).
- Topical: mobile app delivery choice (Flutter vs React Native vs PWA,
  APK publishing) — the user's explicit "ship it as an APK or web" goal.

Sized deliberately small — this runs after four prior research passes today
against a 10,000-unit daily YouTube Data API quota.

Usage:
    set -a && source ../.env && set +a && python3 youtube_search_buildability.py
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

SEED_HANDLES = [("programmingwithmosh", "Dev tutorials — full-stack, JS/TS, Python, mobile — flagged directly by user")]

RELATED_CHANNEL_QUERIES = [
    ("full stack web development tutorial channel", "programmingwithmosh"),
    ("React Native Flutter mobile app tutorial channel", "programmingwithmosh"),
]

TOPICAL_QUERIES = [
    ("startup mistakes founders make", "startup_mistakes"),
    ("why startups fail postmortem", "startup_mistakes"),
    ("fintech startup failure lessons learned", "startup_mistakes"),
    ("MVP mistakes early stage founders", "startup_mistakes"),
    ("Flutter vs React Native 2026 comparison", "mobile_delivery"),
    ("PWA vs native mobile app which to choose", "mobile_delivery"),
    ("how to publish app on Google Play Store APK", "mobile_delivery"),
    ("Next.js PWA installable web app tutorial", "mobile_delivery"),
]

TOPICAL_LABELS = {
    "startup_mistakes": "Startup Mistakes / Postmortems (avoid known failure modes)",
    "mobile_delivery": "Mobile App Delivery Choice (Flutter / React Native / PWA / APK)",
}

UPLOADS_PER_CHANNEL = 15
COMMENT_PICKS = 3
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


def resolve_handle(handle):
    d, err = api_get("channels", {"key": API_KEY, "part": "snippet,statistics,contentDetails", "forHandle": handle})
    if err or not d.get("items"):
        return None, err or "not found"
    it = d["items"][0]
    return {
        "id": it["id"], "title": html.unescape(it["snippet"]["title"]),
        "subs": it["statistics"].get("subscriberCount"),
        "video_count": it["statistics"].get("videoCount"),
        "uploads_playlist": it["contentDetails"]["relatedPlaylists"]["uploads"],
    }, None


def resolve_by_id(channel_id):
    d, err = api_get("channels", {"key": API_KEY, "part": "snippet,statistics,contentDetails", "id": channel_id})
    if err or not d.get("items"):
        return None, err or "not found"
    it = d["items"][0]
    return {
        "id": it["id"], "title": html.unescape(it["snippet"]["title"]),
        "subs": it["statistics"].get("subscriberCount"),
        "video_count": it["statistics"].get("videoCount"),
        "uploads_playlist": it["contentDetails"]["relatedPlaylists"]["uploads"],
    }, None


def search_channels(query, max_results=4):
    d, err = api_get("search", {"key": API_KEY, "part": "snippet", "q": query, "maxResults": max_results, "type": "channel"})
    if err:
        return [], err
    return [{"id": it["snippet"]["channelId"], "title": html.unescape(it["snippet"]["title"])} for it in d.get("items", [])], None


def search_videos(query, max_results=6):
    d, err = api_get("search", {"key": API_KEY, "part": "snippet", "q": query, "maxResults": max_results, "type": "video", "relevanceLanguage": "en"})
    if err:
        return [], err
    return d.get("items", []), None


def fetch_uploads(playlist_id, max_results=15):
    d, err = api_get("playlistItems", {"key": API_KEY, "part": "snippet", "playlistId": playlist_id, "maxResults": min(max_results, 50)})
    if err:
        return [], err
    out = []
    for it in d.get("items", []):
        sn = it["snippet"]
        vid = sn.get("resourceId", {}).get("videoId")
        if vid:
            out.append({"video_id": vid, "title": html.unescape(sn["title"]), "published": sn.get("publishedAt", "")[:10]})
    return out, None


def fetch_stats(video_ids):
    stats = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i + 50]
        d, err = api_get("videos", {"key": API_KEY, "part": "statistics,contentDetails", "id": ",".join(batch)})
        if err:
            continue
        for item in d.get("items", []):
            st, cd = item.get("statistics", {}), item.get("contentDetails", {})
            stats[item["id"]] = {"views": int(st.get("viewCount", 0)), "duration": cd.get("duration", "")}
    return stats


def fetch_top_comments(video_id, max_results=5):
    d, err = api_get("commentThreads", {"key": API_KEY, "part": "snippet", "videoId": video_id, "maxResults": max_results, "order": "relevance", "textFormat": "plainText"})
    if err:
        return [], err
    out = []
    for item in d.get("items", []):
        top = item["snippet"]["topLevelComment"]["snippet"]
        out.append({"author": html.unescape(top.get("authorDisplayName", "")), "text": html.unescape(top.get("textDisplay", "")).replace("\n", " ")[:300], "likes": top.get("likeCount", 0)})
    return out, None


def fmt_duration(iso):
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return ""
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return f"{h}:{mi:02d}:{s:02d}" if h else f"{mi}:{s:02d}"


def main():
    lines = [
        "# YouTube Research — Buildability: Dev Channels, Startup Mistakes, Mobile Delivery",
        "",
        "Final research pass, aimed squarely at the actual goal: ship Fungu as a "
        "stable real product (web + APK) without repeating known startup "
        "mistakes. Covers Programming with Mosh + related build-focused "
        "channels, startup-failure postmortems, and the Flutter/React "
        "Native/PWA/APK delivery decision. Deliberately small — run after "
        "four prior research passes today against the daily API quota.",
        "",
    ]

    errors = []
    channels = {}
    for handle, note in SEED_HANDLES:
        info, err = resolve_handle(handle)
        if err:
            errors.append((f"resolve @{handle}", err))
        else:
            info["source"] = f"seed (@{handle}) — {note}"
            channels[info["id"]] = info
        time.sleep(0.1)

    related_ids = set()
    for query, seed_tag in RELATED_CHANNEL_QUERIES:
        found, err = search_channels(query)
        if err:
            errors.append((f"search channels `{query}`", err))
            continue
        for c in found:
            if c["id"] not in channels:
                related_ids.add(c["id"])
        time.sleep(0.2)

    for cid in related_ids:
        info, err = resolve_by_id(cid)
        if info:
            info["source"] = "related to programmingwithmosh"
            channels[cid] = info

    lines.append(f"## Dev/build channels ({len(channels)})")
    lines.append("")
    lines.append("| Channel | Subs | Videos | Source |")
    lines.append("|---|---|---|---|")
    for cid, c in channels.items():
        subs = f"{int(c['subs']):,}" if c.get("subs") else "?"
        lines.append(f"| [{c['title']}](https://www.youtube.com/channel/{cid}) | {subs} | {c.get('video_count', '?')} | {c['source']} |")
    lines.append("")

    channel_uploads = {}
    all_ids = []
    for cid, c in channels.items():
        uploads, err = fetch_uploads(c["uploads_playlist"], UPLOADS_PER_CHANNEL)
        if err:
            errors.append((f"uploads for {c['title']}", err))
            continue
        channel_uploads[cid] = uploads
        all_ids += [u["video_id"] for u in uploads]
        time.sleep(0.1)

    topical_results = {}
    for q, cat in TOPICAL_QUERIES:
        items, err = search_videos(q)
        if err:
            errors.append((f"search `{q}`", err))
            continue
        topical_results[q] = {"category": cat, "items": items}
        all_ids += [it["id"]["videoId"] for it in items]
        time.sleep(0.2)

    stats = fetch_stats(list(dict.fromkeys(all_ids)))

    lines.append("## Dev/build channel uploads")
    lines.append("")
    for cid, c in channels.items():
        uploads = channel_uploads.get(cid, [])
        if not uploads:
            continue
        lines.append(f"### {c['title']}")
        lines.append("")
        lines.append("| Title | Published | Views | Duration | Link |")
        lines.append("|---|---|---|---|---|")
        for u in uploads:
            st = stats.get(u["video_id"], {})
            views = f"{st.get('views', 0):,}" if st else "?"
            dur = fmt_duration(st.get("duration", "")) if st else ""
            url = f"https://www.youtube.com/watch?v={u['video_id']}"
            title = u["title"].replace("|", "-")
            lines.append(f"| {title} | {u['published']} | {views} | {dur} | [{u['video_id']}]({url}) |")
        lines.append("")

    by_cat = {}
    for q, obj in topical_results.items():
        by_cat.setdefault(obj["category"], []).append((q, obj["items"]))

    for cat_key in ["startup_mistakes", "mobile_delivery"]:
        if cat_key not in by_cat:
            continue
        lines.append(f"## {TOPICAL_LABELS[cat_key]}")
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

    # comments: top video per topical category + top video for Mosh himself
    comment_targets = []
    for cat, qs in by_cat.items():
        ranked = []
        for q, items in qs:
            for it in items:
                vid = it["id"]["videoId"]
                ranked.append((stats.get(vid, {}).get("views", 0), vid, it["snippet"]["title"]))
        ranked.sort(reverse=True)
        for _, vid, title in ranked[:COMMENT_PICKS]:
            comment_targets.append((cat, vid, html.unescape(title)))

    for cid, c in channels.items():
        uploads = channel_uploads.get(cid, [])
        if not uploads:
            continue
        ranked = sorted(uploads, key=lambda u: stats.get(u["video_id"], {}).get("views", 0), reverse=True)
        for u in ranked[:2]:
            comment_targets.append((c["title"], u["video_id"], u["title"]))

    comments_by_video = {}
    comment_errors = []
    for cat, vid, title in comment_targets:
        comments, err = fetch_top_comments(vid, COMMENTS_PER_VIDEO)
        if err:
            comment_errors.append((title, err))
            continue
        if comments:
            comments_by_video[vid] = {"title": title, "category": cat, "comments": comments}
        time.sleep(0.15)

    if comments_by_video:
        lines.append("## Top comments")
        lines.append("")
        for vid, obj in comments_by_video.items():
            url = f"https://www.youtube.com/watch?v={vid}"
            lines.append(f"### [{obj['title']}]({url}) ({obj['category']})")
            lines.append("")
            for c in obj["comments"]:
                lines.append(f"- **{c['author']}** ({c['likes']} likes): {c['text']}")
            lines.append("")

    if errors or comment_errors:
        lines.append("## Errors")
        lines.append("")
        for label, e in errors:
            lines.append(f"- {label}: {e}")
        for title, e in comment_errors:
            lines.append(f"- comments for `{title}`: {e}")
        lines.append("")

    out_path = os.path.join(os.path.dirname(__file__), "youtube-research-buildability.md")
    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {out_path} — {len(channels)} channels, {len(topical_results)} topical queries, "
          f"{len(comments_by_video)} comment threads, {len(errors)} errors")


if __name__ == "__main__":
    main()
