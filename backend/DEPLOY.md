# MusicFlow Backend - Deployment Guide

## Quick Start (Local Development)

```bash
cd backend
pip install -r requirements.txt
python api.py
# Server starts at http://localhost:8000
```

## Deploy to Render.com (Free - Recommended)

1. Create a free account at https://render.com
2. Click "New" → "Web Service"
3. Connect your GitHub repo
4. Set Root Directory to: `backend`
5. Build Command: `pip install -r requirements.txt`
6. Start Command: `uvicorn api:app --host 0.0.0.0 --port $PORT`
7. Instance Type: Free

After deploy, copy your Render URL (e.g. `https://musicflow-api.onrender.com`)

## Deploy to Railway (Alternative Free Tier)

1. Create account at https://railway.app
2. New Project → Deploy from GitHub Repo
3. Select the `backend/` folder
4. Railway auto-detects the Procfile

## After Deploying the Backend

Update the frontend to use your live backend URL.
In `app.js`, change:
```js
const API_BASE = window.MUSICFLOW_API || 'http://localhost:8002';
```
To your actual deployed URL, OR set `window.MUSICFLOW_API` via a config script.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/trending?limit=20` | GET | Trending music |
| `/search?q=QUERY&limit=30` | GET | Search tracks |
| `/stream?videoId=ID` | GET | Get audio stream URL |

## Notes

- Audio stream URLs from `/stream` expire after ~6 hours (YouTube server-side)
- The frontend caches stream URLs in session memory to avoid re-fetching
- yt-dlp automatically updates extraction logic; keep it up to date with `pip install -U yt-dlp`

