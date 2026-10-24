#!/usr/bin/env python3
"""Fetch actual transcript text for every video indexed in
transcripts/_manifest_input.json — not just titles/metadata.

Resumable: skips any video that already has a transcript file OR is
already logged as a definitive failure (transcripts disabled / unavailable)
in the status log. Safe to kill and re-run at any point.

Honest logging: every video gets an explicit status row in
transcripts/_status.jsonl — "ok", "disabled", "not_found", "unavailable",
"blocked", or "error:<msg>". Nothing is silently skipped or assumed.

Rate-limited deliberately conservatively to avoid IP blocking from the
unofficial transcript endpoint. If blocking is detected (RequestBlocked /
IpBlocked), the script backs off hard and eventually stops cleanly so the
run can resume later rather than burning through failures.

Usage:
    .venv/bin/python3 fetch_transcripts.py
"""
import json
import os
import time

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled, NoTranscriptFound, VideoUnavailable,
    RequestBlocked, IpBlocked, CouldNotRetrieveTranscript,
)

BASE = os.path.dirname(__file__)
MANIFEST_PATH = os.path.join(BASE, "transcripts", "_manifest_input.json")
STATUS_PATH = os.path.join(BASE, "transcripts", "_status.jsonl")
TRANSCRIPT_DIR = os.path.join(BASE, "transcripts")

REQUEST_DELAY = 5.0          # seconds between requests — slowed down after hitting a block at 1.0s
BLOCK_BACKOFF = 120          # seconds to wait after a detected block before retrying once
MAX_CONSECUTIVE_BLOCKS = 2   # stop sooner this time — don't burn through more of the block window

api = YouTubeTranscriptApi()


def load_manifest():
    with open(MANIFEST_PATH) as f:
        return json.load(f)


def load_done():
    """Video IDs already resolved (success or definitive failure) from prior runs."""
    done = {}
    if os.path.exists(STATUS_PATH):
        with open(STATUS_PATH) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                    done[row["id"]] = row["status"]
                except Exception:
                    continue
    return done


def append_status(video_id, status, detail=""):
    with open(STATUS_PATH, "a") as f:
        f.write(json.dumps({"id": video_id, "status": status, "detail": detail}) + "\n")


def save_transcript(video_id, title, sources, transcript):
    text = "\n".join(f"[{seg.start:.1f}s] {seg.text}" for seg in transcript)
    header = (
        f"video_id: {video_id}\n"
        f"title: {title}\n"
        f"url: https://www.youtube.com/watch?v={video_id}\n"
        f"sources: {', '.join(sources)}\n"
        f"language: {transcript.language} ({'auto-generated' if transcript.is_generated else 'manual'})\n"
        f"---\n\n"
    )
    path = os.path.join(TRANSCRIPT_DIR, f"{video_id}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + text)


def main():
    manifest = load_manifest()
    done = load_done()

    all_ids = list(manifest.keys())
    remaining = [vid for vid in all_ids if vid not in done]

    print(f"total videos: {len(all_ids)} | already resolved: {len(done)} | remaining: {len(remaining)}")

    consecutive_blocks = 0
    ok_count = sum(1 for s in done.values() if s == "ok")
    fail_count = len(done) - ok_count
    processed_this_run = 0

    for video_id in remaining:
        meta = manifest[video_id]
        title = meta.get("title", "")
        sources = meta.get("sources", [])

        try:
            fetched = api.fetch(video_id)
            save_transcript(video_id, title, sources, fetched)
            append_status(video_id, "ok", f"{len(fetched)} segments, lang={fetched.language_code}")
            ok_count += 1
            consecutive_blocks = 0
        except TranscriptsDisabled:
            append_status(video_id, "disabled")
            fail_count += 1
            consecutive_blocks = 0
        except NoTranscriptFound:
            append_status(video_id, "not_found")
            fail_count += 1
            consecutive_blocks = 0
        except VideoUnavailable:
            append_status(video_id, "unavailable")
            fail_count += 1
            consecutive_blocks = 0
        except (RequestBlocked, IpBlocked) as e:
            consecutive_blocks += 1
            append_status(video_id, "blocked", f"attempt {consecutive_blocks}: {e}")
            if consecutive_blocks >= MAX_CONSECUTIVE_BLOCKS:
                print(f"STOPPING: {consecutive_blocks} consecutive blocks detected — "
                      f"processed {processed_this_run} this run, {ok_count} ok / {fail_count} failed total. "
                      f"Re-run this script later to resume (it will skip everything already logged).")
                return
            print(f"blocked ({consecutive_blocks}/{MAX_CONSECUTIVE_BLOCKS}) on {video_id}, "
                  f"backing off {BLOCK_BACKOFF}s...")
            time.sleep(BLOCK_BACKOFF)
        except CouldNotRetrieveTranscript as e:
            append_status(video_id, f"error:{type(e).__name__}", str(e)[:200])
            fail_count += 1
            consecutive_blocks = 0
        except Exception as e:
            append_status(video_id, f"error:{type(e).__name__}", str(e)[:200])
            fail_count += 1
            consecutive_blocks = 0

        processed_this_run += 1
        if processed_this_run % 50 == 0:
            print(f"progress: {processed_this_run}/{len(remaining)} this run | "
                  f"totals: {ok_count} ok, {fail_count} failed")

        time.sleep(REQUEST_DELAY)

    print(f"DONE. This run processed {processed_this_run}. "
          f"Totals: {ok_count} ok, {fail_count} failed, out of {len(all_ids)} total.")


if __name__ == "__main__":
    main()
