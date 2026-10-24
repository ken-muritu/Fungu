#!/usr/bin/env python3
"""Channel-level deep dive: pull upload histories (with full descriptions),
stats, and comments from specific named channels the user pointed to, plus
discover related channels in the same niche.

Usage:
    set -a && source ../.env && set +a && python3 youtube_channels.py
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
    ("Financially_Incorrect", "Kenya personal finance / founder-interview podcast — already surfaced repeatedly in prior research passes"),
    ("matt-ari", "Building a startup in public vlog (spacefs.com) — connects to prior spacefs.com due-diligence research"),
    ("ycombinator", "Startup advice / accelerator / founder stories — general startup-building playbook"),
]

# Queries to discover channels related to each seed's niche.
RELATED_CHANNEL_QUERIES = [
    ("Kenya personal finance podcast", "Financially_Incorrect"),
    ("Kenya money podcast host", "Financially_Incorrect"),
    ("African financial literacy podcast", "Financially_Incorrect"),
    ("startup building in public vlog weekly", "matt-ari"),
    ("indie hacker vlog startup journey", "matt-ari"),
    ("startup podcast accelerator advice", "ycombinator"),
    ("first round review startup podcast", "ycombinator"),
    ("founder stories African startup podcast", "ycombinator"),
]

UPLOADS_PER_CHANNEL = 20
COMMENT_PICKS_PER_CHANNEL = 3
COMMENTS_PER_VIDEO = 6


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
    d, err = api_get("channels", {
        "key": API_KEY, "part": "snippet,statistics,contentDetails", "forHandle": handle,
    })
    if err or not d.get("items"):
        return None, err or "not found"
    it = d["items"][0]
    return {
        "id": it["id"],
        "title": html.unescape(it["snippet"]["title"]),
        "description": html.unescape(it["snippet"]["description"]),
        "subs": it["statistics"].get("subscriberCount"),
        "video_count": it["statistics"].get("videoCount"),
        "uploads_playlist": it["contentDetails"]["relatedPlaylists"]["uploads"],
    }, None


def search_channels(query, max_results=5):
    d, err = api_get("search", {
        "key": API_KEY, "part": "snippet", "q": query,
        "maxResults": max_results, "type": "channel",
    })
    if err:
        return [], err
    out = []
    for it in d.get("items", []):
        out.append({
            "id": it["snippet"]["channelId"],
            "title": html.unescape(it["snippet"]["title"]),
            "description": html.unescape(it["snippet"]["description"]),
        })
    return out, None


def fetch_uploads(playlist_id, max_results=20):
    d, err = api_get("playlistItems", {
        "key": API_KEY, "part": "snippet", "playlistId": playlist_id,
        "maxResults": min(max_results, 50),
    })
    if err:
        return [], err
    out = []
    for it in d.get("items", []):
        sn = it["snippet"]
        vid = sn.get("resourceId", {}).get("videoId")
        if not vid:
            continue
        out.append({
            "video_id": vid,
            "title": html.unescape(sn["title"]),
            "description": html.unescape(sn.get("description", "")),
            "published": sn.get("publishedAt", "")[:10],
        })
    return out, None


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


def fetch_top_comments(video_id, max_results=6):
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
            "text": html.unescape(top.get("textDisplay", "")).replace("\n", " ")[:350],
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
    lines = [
        "# YouTube Research — Channel Deep Dive",
        "",
        "User-directed: specific channels/podcasts flagged as relevant, plus "
        "channels discovered in the same niche. Pulls full upload histories "
        "(titles + descriptions, not just search-hit snippets), engagement "
        "stats, and top comments on the highest-signal videos — going a "
        "level deeper than the keyword-search passes in the other two docs.",
        "",
    ]

    all_channels = {}  # id -> {title, description, subs, video_count, source}
    errors = []

    # --- Resolve seed handles ---
    for handle, note in SEED_HANDLES:
        info, err = resolve_handle(handle)
        if err:
            errors.append((f"resolve @{handle}", err))
            continue
        info["source"] = f"seed (@{handle}) — {note}"
        all_channels[info["id"]] = info
        time.sleep(0.1)

    # --- Discover related channels ---
    related_found = {}
    for query, seed_tag in RELATED_CHANNEL_QUERIES:
        chans, err = search_channels(query)
        if err:
            errors.append((f"search channels `{query}`", err))
            continue
        for c in chans:
            if c["id"] in all_channels:
                continue
            related_found.setdefault(c["id"], c)
            related_found[c["id"]].setdefault("related_to", set()).add(seed_tag)
        time.sleep(0.2)

    # need contentDetails (uploads playlist) for related channels too
    for cid, c in related_found.items():
        info, err = resolve_handle_by_id(cid, API_KEY, api_get)
        if err or not info:
            continue
        info["source"] = f"related to {', '.join(sorted(c.get('related_to', [])))}"
        all_channels[cid] = info

    lines.append(f"## Channels covered ({len(all_channels)})")
    lines.append("")
    lines.append("| Channel | Subs | Videos | Source |")
    lines.append("|---|---|---|---|")
    for cid, c in all_channels.items():
        subs = f"{int(c['subs']):,}" if c.get("subs") else "?"
        lines.append(f"| [{c['title']}](https://www.youtube.com/channel/{cid}) | {subs} | {c.get('video_count', '?')} | {c['source']} |")
    lines.append("")

    # --- Pull uploads per channel ---
    all_video_ids = []
    channel_uploads = {}
    for cid, c in all_channels.items():
        uploads, err = fetch_uploads(c["uploads_playlist"], UPLOADS_PER_CHANNEL)
        if err:
            errors.append((f"uploads for {c['title']}", err))
            continue
        channel_uploads[cid] = uploads
        all_video_ids += [u["video_id"] for u in uploads]
        time.sleep(0.1)

    stats = fetch_stats(list(dict.fromkeys(all_video_ids)))

    lines.append("## Upload histories")
    lines.append("")
    for cid, c in all_channels.items():
        uploads = channel_uploads.get(cid, [])
        if not uploads:
            continue
        lines.append(f"### {c['title']}")
        lines.append("")
        lines.append(f"_{c['source']}_")
        lines.append("")
        lines.append("| Title | Published | Views | Duration | Link | Description (truncated) |")
        lines.append("|---|---|---|---|---|---|")
        for u in uploads:
            st = stats.get(u["video_id"], {})
            views = f"{st.get('views', 0):,}" if st else "?"
            dur = fmt_duration(st.get("duration", "")) if st else ""
            url = f"https://www.youtube.com/watch?v={u['video_id']}"
            desc = u["description"].replace("\n", " ").replace("|", "-")[:180]
            title = u["title"].replace("|", "-")
            lines.append(f"| {title} | {u['published']} | {views} | {dur} | [{u['video_id']}]({url}) | {desc} |")
        lines.append("")

    # --- Top comments: highest-view video per channel ---
    lines.append("## Top comments — highest-viewed upload per channel")
    lines.append("")
    lines.append("Sampled for real sentiment, not vetted for accuracy — treat as anecdote, not data.")
    lines.append("")
    comment_errors = []
    for cid, c in all_channels.items():
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

    out_path = os.path.join(os.path.dirname(__file__), "youtube-research-channels.md")
    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {out_path} — {len(all_channels)} channels, "
          f"{sum(len(v) for v in channel_uploads.values())} videos, {len(errors)} errors")


def resolve_handle_by_id(channel_id, api_key, api_get_fn):
    d, err = api_get_fn("channels", {
        "key": api_key, "part": "snippet,statistics,contentDetails", "id": channel_id,
    })
    if err or not d.get("items"):
        return None, err or "not found"
    it = d["items"][0]
    return {
        "id": it["id"],
        "title": html.unescape(it["snippet"]["title"]),
        "description": html.unescape(it["snippet"]["description"]),
        "subs": it["statistics"].get("subscriberCount"),
        "video_count": it["statistics"].get("videoCount"),
        "uploads_playlist": it["contentDetails"]["relatedPlaylists"]["uploads"],
    }, None


if __name__ == "__main__":
    main()
