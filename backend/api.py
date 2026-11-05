"""
MusicFlow Backend API  -  api.py
Extracts direct, ad-free audio stream URLs via yt-dlp.
"""

import os
import re
import asyncio
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import yt_dlp

app = FastAPI(title="MusicFlow Audio API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ─── yt-dlp options ───────────────────────────────────────────────────────────
_FLAT_OPTS = {
    "quiet": True,
    "extract_flat": True,
    "skip_download": True,
    "noplaylist": False,
    "socket_timeout": 15,
}

_STREAM_OPTS = {
    "format": "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "noplaylist": True,
    "socket_timeout": 15,
}


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _pick_best_audio(info: dict) -> dict:
    """Find the best direct audio-only format from a yt-dlp info dict."""
    formats = info.get("formats", [])
    audio = [
        f for f in formats
        if f.get("acodec") != "none" and f.get("vcodec") in (None, "none", "")
    ]
    audio.sort(key=lambda x: (x.get("tbr") or x.get("abr") or 0), reverse=True)

    # Prefer high-quality non-manifest formats
    for f in audio:
        url = f.get("url", "")
        if url and "manifest" not in url and "googlevideo.com" in url:
            return f
    # Fallback to any audio
    for f in audio:
        if f.get("url"):
            return f
    # Last resort: use info-level url
    return info


def _do_search(query: str, limit: int) -> list:
    with yt_dlp.YoutubeDL(_FLAT_OPTS) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    entries = info.get("entries", []) if info else []
    results = []
    for e in entries or []:
        if not e:
            continue
        thumb = (
            e.get("thumbnail")
            or ((e.get("thumbnails") or [{}])[-1].get("url", ""))
        )
        results.append({
            "videoId": e.get("id", ""),
            "title": e.get("title", ""),
            "channelTitle": e.get("channel") or e.get("uploader") or "",
            "duration": e.get("duration", 0),
            "thumbnail": thumb,
        })
    return results


def _do_stream(video_id: str) -> dict:
    url = "https://www.youtube.com/watch?v=" + video_id
    with yt_dlp.YoutubeDL(_STREAM_OPTS) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise ValueError("No info returned")

    best = _pick_best_audio(info)
    thumb = (
        info.get("thumbnail")
        or ((info.get("thumbnails") or [{}])[-1].get("url", ""))
    )
    audio_url = best.get("url", "")
    return {
        "videoId": info.get("id", video_id),
        "title": info.get("title", ""),
        "channelTitle": info.get("channel") or info.get("uploader") or "",
        "duration": info.get("duration", 0),
        "thumbnail": thumb,
        "audioUrl": audio_url,
        "ext": best.get("ext", "webm"),
        "bitrate": best.get("abr") or best.get("tbr"),
    }


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "MusicFlow API v2 running"}


@app.get("/stream")
async def get_stream(videoId: str = Query(...)):
    """Return a direct, ad-free audio stream URL for a YouTube video ID."""
    if not videoId or len(videoId) < 5:
        raise HTTPException(400, "Invalid videoId")
    try:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _do_stream, videoId)
        if not data.get("audioUrl"):
            raise HTTPException(502, "Could not extract audio URL")
        return JSONResponse(data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {e}")


@app.get("/search")
async def search(q: str = Query(...), limit: int = Query(20, ge=1, le=50)):
    """Search YouTube for tracks (metadata only, no audio URLs yet)."""
    if not q.strip():
        raise HTTPException(400, "Empty query")
    try:
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, _do_search, q.strip(), limit)
        return JSONResponse({"items": results, "query": q.strip()})
    except Exception as e:
        raise HTTPException(500, f"Search failed: {e}")


@app.get("/trending")
async def trending(limit: int = Query(20, ge=1, le=50)):
    """Return trending music via yt-dlp search."""
    queries = ["trending hindi bollywood songs 2024", "top pop songs 2024"]
    all_results = []
    loop = asyncio.get_event_loop()
    try:
        for q in queries:
            items = await loop.run_in_executor(None, _do_search, q, limit // 2 + 5)
            all_results.extend(items)
        seen, unique = set(), []
        for r in all_results:
            if r["videoId"] not in seen:
                seen.add(r["videoId"])
                unique.append(r)
        return JSONResponse({"items": unique[:limit]})
    except Exception as e:
        raise HTTPException(500, f"Trending failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), reload=False)
