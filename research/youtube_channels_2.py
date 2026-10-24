#!/usr/bin/env python3
"""Second channel deep dive: Tano (AI building-in-public), Starter Story
(FULL video history — user asked for all ~495), Greg Isenberg (startup
ideas / AI tutorials), plus related channels.

Usage:
    set -a && source ../.env && set +a && python3 youtube_channels_2.py
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

SEED_HANDLES = [
    ("Tano-AI", "Building an AI company in public (London) — user-flagged"),
    ("starterstory", "Business idea / startup case studies — user asked for FULL video history"),
    ("GregIsenberg", "Startup ideas + AI build/grow tutorials, CEO Late Checkout — user-flagged"),
]

RELATED_CHANNEL_QUERIES = [
    ("building AI startup vlog in public", "Tano-AI"),
    ("AI company founder journey vlog", "Tano-AI"),
    ("startup ideas podcast AI", "GregIsenberg"),
    ("how to build startup with AI tutorial", "GregIsenberg"),
    ("business case study ideas that make money", "starterstory"),
]

# Starter Story explicitly gets ALL videos; others get a full paginate too
# since playlistItems.list is cheap (1 unit/page) regardless of channel size.
FULL_PAGINATE = True
COMMENT_PICKS_PER_CHANNEL = 3
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


def fetch_all_uploads(playlist_id, hard_cap=600):
    """Paginate through the entire uploads playlist."""
    out = []
    page_token = None
    while True:
        params = {"key": API_KEY, "part": "snippet", "playlistId": playlist_id, "maxResults": 50}
        if page_token:
            params["pageToken"] = page_token
        d, err = api_get("playlistItems", params)
        if err:
            return out, err
        for it in d.get("items", []):
            sn = it["snippet"]
            vid = sn.get("resourceId", {}).get("videoId")
            if vid:
                out.append({"video_id": vid, "title": html.unescape(sn["title"]), "published": sn.get("publishedAt", "")[:10]})
        page_token = d.get("nextPageToken")
        if not page_token or len(out) >= hard_cap:
            break
        time.sleep(0.1)
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
        "# YouTube Research — Channel Deep Dive 2: Tano, Starter Story (full), Greg Isenberg",
        "",
        "Second round of user-directed channels. Starter Story gets its "
        "**complete** upload history (~495 videos) per explicit request — "
        "cheap via API pagination even at that volume. Tano and Greg "
        "Isenberg get full histories too, plus related-channel discovery.",
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
            info["source"] = "related to Tano/Starter Story/Greg Isenberg"
            channels[cid] = info

    lines.append(f"## Channels covered ({len(channels)})")
    lines.append("")
    lines.append("| Channel | Subs | Total Videos | Source |")
    lines.append("|---|---|---|---|")
    for cid, c in channels.items():
        subs = f"{int(c['subs']):,}" if c.get("subs") else "?"
        lines.append(f"| [{c['title']}](https://www.youtube.com/channel/{cid}) | {subs} | {c.get('video_count', '?')} | {c['source']} |")
    lines.append("")

    channel_uploads = {}
    all_ids = []
    for cid, c in channels.items():
        cap = 600 if cid == "UChhw6DlKKTQ9mYSpTfXUYqA" else 100  # Starter Story: full; others: generous cap
        uploads, err = fetch_all_uploads(c["uploads_playlist"], hard_cap=cap)
        if err:
            errors.append((f"uploads for {c['title']}", err))
            continue
        channel_uploads[cid] = uploads
        all_ids += [u["video_id"] for u in uploads]
        time.sleep(0.1)

    stats = fetch_stats(list(dict.fromkeys(all_ids)))

    lines.append("## Upload histories")
    lines.append("")
    for cid, c in channels.items():
        uploads = channel_uploads.get(cid, [])
        if not uploads:
            continue
        lines.append(f"### {c['title']} ({len(uploads)} videos pulled)")
        lines.append("")
        lines.append(f"_{c['source']}_")
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

    lines.append("## Top comments — highest-viewed uploads")
    lines.append("")
    lines.append("Sampled for real sentiment, not vetted for accuracy — treat as anecdote, not data.")
    lines.append("")
    comment_errors = []
    for cid, c in channels.items():
        uploads = channel_uploads.get(cid, [])
        if not uploads:
            continue
        ranked = sorted(uploads, key=lambda u: stats.get(u["video_id"], {}).get("views", 0), reverse=True)
        for u in ranked[:COMMENT_PICKS_PER_CHANNEL]:
            comments, err = fetch_top_comments(u["video_id"], COMMENTS_PER_VIDEO)
            if err:
                comment_errors.append((u["title"], err))
                continue
            if not comments:
                continue
            url = f"https://www.youtube.com/watch?v={u['video_id']}"
            lines.append(f"### [{u['title']}]({url}) — {c['title']}")
            lines.append("")
            for cm in comments:
                lines.append(f"- **{cm['author']}** ({cm['likes']} likes): {cm['text']}")
            lines.append("")
            time.sleep(0.15)

    if errors or comment_errors:
        lines.append("## Errors")
        lines.append("")
        for label, e in errors:
            lines.append(f"- {label}: {e}")
        for title, e in comment_errors:
            lines.append(f"- comments for `{title}`: {e}")
        lines.append("")

    out_path = os.path.join(os.path.dirname(__file__), "youtube-research-channels-2.md")
    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {out_path} — {len(channels)} channels, "
          f"{sum(len(v) for v in channel_uploads.values())} videos, {len(errors)} errors")


if __name__ == "__main__":
    main()
