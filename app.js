/* ============================================================
   MUSICFLOW — Clean Ad-Free Native HTML5 Audio Player
   Powered by Python FastAPI + yt-dlp Backend (Zero Ads, No Iframes)
   ============================================================ */

'use strict';

// ── BACKEND API CONFIG ────────────────────────────────────────
// Local default: http://localhost:8002. In production set window.MUSICFLOW_API to Render/Railway URL.
const API_BASE = window.MUSICFLOW_API || 'https://musicify-pqq8.onrender.com';

// ── STATE ────────────────────────────────────────────────────
let currentTrack      = null;
let isPlaying         = false;
let isShuffled        = false;
let repeatMode        = 0;        // 0=off 1=all 2=one
let volume            = 80;
let isMuted           = false;
let queue             = [];       // array of track objects
let queueIndex        = -1;
let playlists         = [];       // [{id, name, desc, tracks:[], createdAt}]
let likedSongs        = [];       // array of track objects
let currentPage       = 'home';
let currentPlaylistId = null;
let progressTimer     = null;
let searchTimeout     = null;
let contextTarget     = null;     // track object for context menu
let _streamCache      = {};       // cache stream URLs for session

// ── NATIVE HTML5 AUDIO ENGINE ─────────────────────────────────
const audioEl = new Audio();
audioEl.preload = 'auto';

// ── GENRES ───────────────────────────────────────────────────
const GENRES = [
  { name: 'Pop',           query: 'pop music 2024',         color: '#E91E63' },
  { name: 'Hip-Hop',       query: 'hip hop rap 2024',       color: '#9C27B0' },
  { name: 'Rock',          query: 'rock music classic',     color: '#E53935' },
  { name: 'Electronic',    query: 'electronic EDM 2024',    color: '#1565C0' },
  { name: 'R&B / Soul',    query: 'r&b soul music',         color: '#4A148C' },
  { name: 'Bollywood',     query: 'bollywood hits 2024',    color: '#E65100' },
  { name: 'Indie',         query: 'indie music 2024',       color: '#2E7D32' },
  { name: 'Lo-Fi Chill',   query: 'lofi hip hop chill beats',color: '#37474F' },
  { name: 'Acoustic',      query: 'acoustic songs guitar',  color: '#8D6E63' },
  { name: 'Dance / Club',  query: 'club dance party mix',   color: '#00838F' },
  { name: 'Workout',       query: 'workout motivation music',color: '#C2185B' },
  { name: 'Study / Focus', query: 'deep focus study music', color: '#1A237E' },
];

// ── API CLIENT ────────────────────────────────────────────────
async function apiFetch(endpoint, params = {}) {
  const url = new URL(API_BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  setupAudioListeners();
  setupTitlebar();
  setupNav();
  setupSidebar();
  setupPlayer();
  setupKeyboard();
  renderSidebar();
  showPage('home');
});

// ── AUDIO LISTENERS ──────────────────────────────────────────
function setupAudioListeners() {
  audioEl.addEventListener('play', () => {
    isPlaying = true;
    updatePlayBtn();
    startProgressTimer();
    updateNowPlayingBars(true);
  });

  audioEl.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayBtn();
    stopProgressTimer();
    updateNowPlayingBars(false);
  });

  audioEl.addEventListener('ended', onTrackEnded);
  audioEl.addEventListener('timeupdate', updateProgress);

  audioEl.addEventListener('error', (e) => {
    console.warn('Audio playback error:', e);
    showToast('⚠️ Audio error. Skipping to next song...');
    if (currentTrack && queue.length > 1) {
      setTimeout(() => playNext(), 1500);
    }
  });
}

// ── STORAGE ──────────────────────────────────────────────────
function loadStorage() {
  try {
    playlists  = JSON.parse(localStorage.getItem('mfy_playlists')  || '[]');
    likedSongs = JSON.parse(localStorage.getItem('mfy_liked')      || '[]');
    volume     = parseInt(localStorage.getItem('mfy_volume')       || '80', 10);
    const theme = localStorage.getItem('mfy_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
    audioEl.volume = volume / 100;
  } catch(e) { console.warn('Storage load failed', e); }
}

function saveStorage() {
  try {
    localStorage.setItem('mfy_playlists', JSON.stringify(playlists));
    localStorage.setItem('mfy_liked',     JSON.stringify(likedSongs));
    localStorage.setItem('mfy_volume',    String(volume));
  } catch(e) {}
}

// ── PLAYBACK ENGINE ──────────────────────────────────────────
async function playTrack(track) {
  if (!track) return;
  currentTrack = track;
  updateNowPlayingBar(track);
  updateLikeBtn();
  updateQueuePanel();
  updateActiveRows();
  document.title = track.title + ' — MusicFlow';

  audioEl.pause();
  audioEl.currentTime = 0;
  audioEl.src = '';

  showToast('⏳ Loading ad-free stream...');
  updatePlayBtn();
  updateNowPlayingBars(false);

  try {
    let streamUrl = _streamCache[track.videoId];
    if (!streamUrl) {
      const data = await apiFetch('/stream', { videoId: track.videoId });
      if (!data || !data.audioUrl) throw new Error('No stream URL');
      streamUrl = data.audioUrl;
      _streamCache[track.videoId] = streamUrl;
      if (data.duration) track.duration = data.duration;
    }

    audioEl.src = streamUrl;
    audioEl.volume = isMuted ? 0 : (volume / 100);
    await audioEl.play();
    showToast('▶ Playing: ' + shortenTitle(track.title, 25));
  } catch (err) {
    console.error('Audio stream fetch failed:', err);
    showToast('❌ Backend offline. Start Python backend server.');
    setTimeout(() => { if (queue.length > 1) playNext(); }, 2000);
  }
}

function togglePlayPause() {
  if (!currentTrack) {
    showToast('Select a song first!');
    return;
  }
  if (isPlaying) {
    audioEl.pause();
  } else {
    audioEl.play().catch(e => console.warn('Play error:', e));
  }
}

function playNext() {
  if (!queue.length) return;
  if (isShuffled) {
    queueIndex = Math.floor(Math.random() * queue.length);
  } else if (repeatMode === 2) {
    // repeat one handled on ended
  } else {
    queueIndex = (queueIndex + 1) % queue.length;
  }
  playTrack(queue[queueIndex]);
}

function playPrev() {
  if (!currentTrack) return;
  if (audioEl.currentTime > 3) {
    audioEl.currentTime = 0;
    return;
  }
  if (!queue.length) return;
  queueIndex = Math.max(0, queueIndex - 1);
  playTrack(queue[queueIndex]);
}

function onTrackEnded() {
  isPlaying = false;
  if (repeatMode === 2) {
    audioEl.currentTime = 0;
    audioEl.play().catch(() => {});
    return;
  }
  if (repeatMode === 1 || queueIndex < queue.length - 1) {
    playNext();
  } else {
    updatePlayBtn();
    stopProgressTimer();
    updateNowPlayingBars(false);
  }
}

function playFromQueue(index) {
  if (index < 0 || index >= queue.length) return;
  queueIndex = index;
  playTrack(queue[index]);
}

function addToQueue(track, playNow = false) {
  const exists = queue.findIndex(t => t.videoId === track.videoId);
  if (exists === -1) {
    queue.push(track);
    const idx = queue.length - 1;
    if (playNow) { queueIndex = idx; playTrack(track); }
    else { showToast('Added "' + shortenTitle(track.title) + '" to queue'); }
  } else {
    if (playNow) { queueIndex = exists; playTrack(track); }
  }
  updateQueuePanel();
}

function playTracksFromList(tracks, startIndex = 0) {
  queue      = [...tracks];
  queueIndex = startIndex;
  if (isShuffled) shuffleQueue(startIndex);
  playTrack(queue[queueIndex]);
}

function shuffleQueue(currentIdx) {
  const current = queue[currentIdx];
  queue.splice(currentIdx, 1);
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  queue.unshift(current);
  queueIndex = 0;
}

// ── PROGRESS TIMER ────────────────────────────────────────────
function startProgressTimer() {
  stopProgressTimer();
  progressTimer = setInterval(updateProgress, 350);
}

function stopProgressTimer() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}

function updateProgress() {
  const cur = audioEl.currentTime || 0;
  const dur = audioEl.duration || (currentTrack && currentTrack.duration) || 0;
  if (!dur || isNaN(dur)) return;
  const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
  const fill = document.getElementById('progress-fill');
  const thumb = document.getElementById('progress-thumb');
  if (fill) fill.style.width = pct + '%';
  if (thumb) thumb.style.left = `calc(${pct}% - 6px)`;
  const ct = document.getElementById('current-time');
  const tt = document.getElementById('total-time');
  if (ct) ct.textContent = formatTime(cur);
  if (tt) tt.textContent = formatTime(dur);
}

// ── UI UPDATES ────────────────────────────────────────────────
function updateNowPlayingBar(track) {
  document.getElementById('np-title').textContent  = track.title;
  document.getElementById('np-artist').textContent = track.channelTitle || '—';
  const thumb = document.getElementById('np-thumb');
  thumb.src = track.thumbnail || '';
  thumb.onerror = () => { thumb.src = 'data:image/svg+xml,...'; };
}

function updatePlayBtn() {
  const pi = document.getElementById('play-icon');
  const pa = document.getElementById('pause-icon');
  if (!pi || !pa) return;
  if (isPlaying) {
    pi.style.display = 'none';
    pa.style.display = 'block';
  } else {
    pi.style.display = 'block';
    pa.style.display = 'none';
  }
}

function updateNowPlayingBars(playing) {
  document.querySelectorAll('.track-row.playing .now-playing-bars').forEach(el => {
    el.style.opacity = playing ? '1' : '0.4';
  });
}

function updateLikeBtn() {
  const btn = document.getElementById('like-btn');
  if (!btn) return;
  const isLiked = currentTrack && likedSongs.some(t => t.videoId === currentTrack.videoId);
  btn.classList.toggle('liked', !!isLiked);
  btn.title = isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs';
}

function updateActiveRows() {
  document.querySelectorAll('.track-row').forEach(row => {
    const id = row.getAttribute('data-id');
    const isThis = currentTrack && id === currentTrack.videoId;
    row.classList.toggle('playing', isThis);
    const numEl = row.querySelector('.track-num');
    if (numEl) {
      if (isThis) {
        numEl.innerHTML = '<div class="now-playing-bars"><span></span><span></span><span></span></div>';
      } else {
        const origIdx = row.getAttribute('data-idx');
        numEl.textContent = (parseInt(origIdx, 10) + 1) || '';
      }
    }
  });
}

function updateQueuePanel() {
  const nowEl = document.getElementById('queue-now-playing');
  if (nowEl) {
    if (currentTrack) {
      nowEl.innerHTML = queueItemHTML(currentTrack, true, queueIndex);
    } else {
      nowEl.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">No song playing</p>';
    }
  }

  const nextEl = document.getElementById('queue-next-list');
  if (!nextEl) return;
  const upcoming = queue.slice(queueIndex + 1, queueIndex + 20);
  if (!upcoming.length) {
    nextEl.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Queue is empty</p>';
  } else {
    nextEl.innerHTML = upcoming.map((t, i) => queueItemHTML(t, false, queueIndex + 1 + i)).join('');
  }
  nextEl.querySelectorAll('.queue-item').forEach(el => {
    el.addEventListener('click', () => playFromQueue(parseInt(el.getAttribute('data-idx'))));
  });
}

function queueItemHTML(track, isActive, idx) {
  return `<div class="queue-item${isActive ? ' active' : ''}" data-idx="${idx}">
    <img class="queue-item-thumb" src="${escHtml(track.thumbnail)}" onerror="this.style.display='none'" />
    <div class="queue-item-info">
      <div class="queue-item-title">${escHtml(shortenTitle(track.title))}</div>
      <div class="queue-item-artist">${escHtml(track.channelTitle || '—')}</div>
    </div>
  </div>`;
}

// ── SIDEBAR ───────────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('playlists-list');
  if (!list) return;
  const items = [
    { id: 'liked', name: 'Liked Songs', desc: `${likedSongs.length} songs`, type: 'liked' },
    ...playlists.map(p => ({ id: p.id, name: p.name, desc: `Playlist · ${p.tracks.length} songs`, type: 'playlist' }))
  ];

  list.innerHTML = items.map(item => `
    <div class="playlist-item" data-id="${item.id}" data-type="${item.type}">
      <div class="playlist-item-thumb">
        ${item.type === 'liked'
          ? '<svg viewBox="0 0 24 24" fill="currentColor" style="color:#8B5CF6"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'
        }
      </div>
      <div class="playlist-item-info">
        <div class="playlist-item-name">${escHtml(item.name)}</div>
        <div class="playlist-item-meta">${escHtml(item.desc)}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.playlist-item').forEach(el => {
    el.addEventListener('click', () => {
      const id   = el.getAttribute('data-id');
      const type = el.getAttribute('data-type');
      if (type === 'liked') showLikedPage();
      else                  showPlaylistPage(id);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const id   = el.getAttribute('data-id');
      const type = el.getAttribute('data-type');
      if (type === 'playlist') showPlaylistContextMenu(e, id);
    });
  });
}

// ── NAV SETUP ─────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const page = el.getAttribute('data-page');
      showPage(page);
    });
  });

  document.querySelectorAll('.mob-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.getAttribute('data-page');
      if (page === 'liked') {
        showLikedPage();
        document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      } else {
        showPage(page);
      }
    });
  });
}

function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.getAttribute('data-page') === page)
  );
  document.querySelectorAll('.mob-nav-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-page') === page);
  });
  if (page === 'home')   showHomePage();
  if (page === 'search') showSearchPage();
}

// ── HOME PAGE ─────────────────────────────────────────────────
async function showHomePage() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <h1 class="page-title" id="greeting-text">Good evening 👋</h1>
      <p class="page-subtitle">What do you want to listen to?</p>
    </div>
    <div class="page-body">
      ${playlists.length || likedSongs.length ? `
      <section class="section">
        <div class="section-header"><h2 class="section-title">Quick Picks</h2></div>
        <div class="quick-picks" id="quick-picks">
          ${likedSongs.slice(0, 6).map(t => `
            <div class="quick-pick-item" data-id="${t.videoId}">
              <img class="quick-pick-thumb" src="${escHtml(t.thumbnail)}" onerror="this.style.display='none'" />
              <span class="quick-pick-name">${escHtml(shortenTitle(t.title))}</span>
              <svg style="width:18px;height:18px;color:var(--text-muted);flex-shrink:0" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </div>
          `).join('')}
        </div>
      </section>` : ''}

      <section class="section">
        <div class="section-header">
          <h2 class="section-title">🔥 Trending Music</h2>
        </div>
        <div class="spinner-wrap"><div class="spinner"></div></div>
      </section>

      <section class="section" id="genre-section">
        <div class="section-header"><h2 class="section-title">Browse Categories</h2></div>
        <div class="genre-grid">
          ${GENRES.map(g => `
            <div class="genre-card" data-query="${escHtml(g.query)}" style="background:${g.color}">
              <span>${escHtml(g.name)}</span>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;

  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning ☀️' : h < 17 ? 'Good afternoon 🌤️' : 'Good evening 🌙';
  const gt = document.getElementById('greeting-text');
  if (gt) gt.textContent = greet;

  document.querySelectorAll('.quick-pick-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      const track = likedSongs.find(t => t.videoId === id);
      if (track) addToQueue(track, true);
    });
  });

  document.querySelectorAll('.genre-card').forEach(el => {
    el.addEventListener('click', () => {
      const q = el.getAttribute('data-query');
      showPage('search');
      setTimeout(() => triggerSearch(q), 50);
    });
  });

  loadTrending();
}

async function loadTrending() {
  try {
    const res = await apiFetch('/trending', { limit: 20 });
    const tracks = res.items || [];
    const sections = document.querySelectorAll('.section');
    const trendSection = sections[playlists.length || likedSongs.length ? 1 : 0];
    if (trendSection) {
      trendSection.innerHTML = `
        <div class="section-header"><h2 class="section-title">🔥 Trending Music</h2></div>
        <div class="cards-grid">
          ${tracks.map((t, i) => trackCardHTML(t, i)).join('')}
        </div>
      `;
      bindCardEvents(trendSection, tracks);
    }
  } catch(e) {
    console.warn('Trending load failed', e);
  }
}

// ── SEARCH PAGE ───────────────────────────────────────────────
function showSearchPage() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header search-header">
      <div class="search-input-wrap">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input type="text" id="search-input" class="search-input" placeholder="Search any song, artist or album..." autofocus />
      </div>
    </div>
    <div class="page-body">
      <div id="search-results">
        <section class="section">
          <div class="section-header"><h2 class="section-title">Browse All</h2></div>
          <div class="genre-grid">
            ${GENRES.map(g => `
              <div class="genre-card" data-query="${escHtml(g.query)}" style="background:${g.color}">
                <span>${escHtml(g.name)}</span>
              </div>
            `).join('')}
          </div>
        </section>
      </div>
    </div>
  `;

  const inp = document.getElementById('search-input');
  inp.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = inp.value.trim();
    if (q.length < 2) {
      showBrowseGenres();
      return;
    }
    searchTimeout = setTimeout(() => doSearch(q), 450);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(searchTimeout); doSearch(inp.value.trim()); }
  });

  document.querySelectorAll('.genre-card').forEach(el => {
    el.addEventListener('click', () => triggerSearch(el.getAttribute('data-query')));
  });
}

function triggerSearch(q) {
  const inp = document.getElementById('search-input');
  if (inp) { inp.value = q; }
  doSearch(q);
}

function showBrowseGenres() {
  const sr = document.getElementById('search-results');
  if (!sr) return;
  sr.innerHTML = `
    <section class="section">
      <div class="section-header"><h2 class="section-title">Browse All</h2></div>
      <div class="genre-grid">
        ${GENRES.map(g => `
          <div class="genre-card" data-query="${escHtml(g.query)}" style="background:${g.color}">
            <span>${escHtml(g.name)}</span>
          </div>
        `).join('')}
      </div>
    </section>`;
  document.querySelectorAll('.genre-card').forEach(el => {
    el.addEventListener('click', () => triggerSearch(el.getAttribute('data-query')));
  });
}

async function doSearch(q) {
  if (!q) return;
  const sr = document.getElementById('search-results');
  if (!sr) return;
  sr.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  try {
    const res = await apiFetch('/search', { q, limit: 30 });
    const tracks = res.items || [];
    if (!tracks.length) {
      sr.innerHTML = '<div class="empty-state"><h3>No results found</h3><p>Try different keywords</p></div>';
      return;
    }
    sr.innerHTML = `
      <section class="section">
        <div class="section-header"><h2 class="section-title">Results for "${escHtml(q)}"</h2></div>
        <div class="track-list">
          <div class="track-list-header"><span>#</span><span>Title</span><span>Channel</span><span>⏱</span></div>
          ${tracks.map((t, i) => trackRowHTML(t, i)).join('')}
        </div>
      </section>
      <section class="section" style="margin-top:16px">
        <div class="section-header"><h2 class="section-title">As Cards</h2></div>
        <div class="cards-grid">
          ${tracks.map((t, i) => trackCardHTML(t, i)).join('')}
        </div>
      </section>
    `;
    bindTrackRowEvents(sr, tracks);
    bindCardEvents(sr, tracks);
  } catch(e) {
    sr.innerHTML = `<div class="empty-state"><h3>Search failed</h3><p>${escHtml(e.message)}</p></div>`;
  }
}

// ── PLAYLIST PAGE ─────────────────────────────────────────────
function showPlaylistPage(id) {
  const pl = playlists.find(p => p.id === id);
  if (!pl) return;
  currentPlaylistId = id;
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="playlist-page-header">
      <div class="playlist-cover">
        ${pl.tracks[0]
          ? `<img src="${escHtml(pl.tracks[0].thumbnail)}" alt="" />`
          : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'
        }
      </div>
      <div class="playlist-info">
        <div class="playlist-type">Playlist</div>
        <div class="playlist-title">${escHtml(pl.name)}</div>
        ${pl.desc ? `<div class="playlist-desc">${escHtml(pl.desc)}</div>` : ''}
        <div class="playlist-meta">MusicFlow · ${pl.tracks.length} songs</div>
      </div>
    </div>
    <div class="playlist-actions">
      ${pl.tracks.length ? `
        <button class="play-all-btn" id="play-all-btn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>` : ''}
      <button class="ctrl-btn dots-btn" id="playlist-menu-btn" style="font-size:28px">···</button>
    </div>
    <div class="page-body">
      ${pl.tracks.length ? `
        <div class="track-list">
          <div class="track-list-header"><span>#</span><span>Title</span><span>Channel</span><span>⏱</span></div>
          ${pl.tracks.map((t, i) => trackRowHTML(t, i, true)).join('')}
        </div>` : `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          <h3>This playlist is empty</h3>
          <p>Search for songs and add them here</p>
        </div>`
      }
    </div>
  `;

  const playAllBtn = document.getElementById('play-all-btn');
  if (playAllBtn) playAllBtn.addEventListener('click', () => playTracksFromList(pl.tracks, 0));

  const menuBtn = document.getElementById('playlist-menu-btn');
  menuBtn.addEventListener('click', (e) => showPlaylistContextMenu(e, id));

  if (pl.tracks.length) {
    bindTrackRowEvents(main, pl.tracks, true);
  }
  renderSidebar();
}

function showLikedPage() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="playlist-page-header" style="background:linear-gradient(to bottom,#4A1DB5 0%,var(--bg-base) 100%)">
      <div class="playlist-cover" style="background:linear-gradient(135deg,#450AF5,#8E8EE5)">
        <svg viewBox="0 0 24 24" fill="white" style="width:60px;height:60px"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
      </div>
      <div class="playlist-info">
        <div class="playlist-type">Playlist</div>
        <div class="playlist-title">Liked Songs</div>
        <div class="playlist-meta">MusicFlow · ${likedSongs.length} songs</div>
      </div>
    </div>
    <div class="playlist-actions">
      ${likedSongs.length ? `
        <button class="play-all-btn" id="play-all-btn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>` : ''}
    </div>
    <div class="page-body">
      ${likedSongs.length ? `
        <div class="track-list">
          <div class="track-list-header"><span>#</span><span>Title</span><span>Channel</span><span>⏱</span></div>
          ${likedSongs.map((t, i) => trackRowHTML(t, i, false, true)).join('')}
        </div>` : `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          <h3>Songs you like will appear here</h3>
          <p>Save songs by tapping the heart icon</p>
        </div>`
      }
    </div>
  `;

  const playAllBtn = document.getElementById('play-all-btn');
  if (playAllBtn) playAllBtn.addEventListener('click', () => playTracksFromList(likedSongs, 0));

  if (likedSongs.length) bindTrackRowEvents(main, likedSongs, false, true);
}

// ── PLAYLIST MANAGEMENT ───────────────────────────────────────
function setupSidebar() {
  document.getElementById('add-playlist-btn').addEventListener('click', () => openCreatePlaylistModal());

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

function openCreatePlaylistModal(prefillName = '') {
  const overlay = document.getElementById('modal-overlay');
  const nameInp = document.getElementById('playlist-name-input');
  const descInp = document.getElementById('playlist-desc-input');
  document.getElementById('modal-title').textContent = 'Create Playlist';
  nameInp.value = prefillName || `My Playlist #${playlists.length + 1}`;
  descInp.value = '';
  overlay.style.display = 'flex';
  nameInp.focus();
  nameInp.select();

  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn  = document.getElementById('modal-cancel');
  const closeBtn   = document.getElementById('modal-close');

  const doCreate = () => {
    const name = nameInp.value.trim();
    if (!name) { showToast('Please enter a playlist name'); return; }
    createPlaylist(name, descInp.value.trim());
    overlay.style.display = 'none';
  };

  const doCancel = () => { overlay.style.display = 'none'; };

  confirmBtn.onclick = doCreate;
  cancelBtn.onclick  = doCancel;
  closeBtn.onclick   = doCancel;
  overlay.onclick    = (e) => { if (e.target === overlay) doCancel(); };
  nameInp.onkeydown  = (e) => { if (e.key === 'Enter') doCreate(); };
}

function createPlaylist(name, desc = '') {
  const pl = { id: 'pl_' + Date.now(), name, desc, tracks: [], createdAt: Date.now() };
  playlists.push(pl);
  saveStorage();
  renderSidebar();
  showPlaylistPage(pl.id);
  showToast(`Playlist "${name}" created`);
  return pl;
}

function deletePlaylist(id) {
  playlists = playlists.filter(p => p.id !== id);
  saveStorage();
  renderSidebar();
  showPage('home');
  showToast('Playlist deleted');
}

function addTrackToPlaylist(track, playlistId) {
  const pl = playlists.find(p => p.id === playlistId);
  if (!pl) return;
  if (pl.tracks.some(t => t.videoId === track.videoId)) {
    showToast(`Already in "${pl.name}"`);
    return;
  }
  pl.tracks.push(track);
  saveStorage();
  renderSidebar();
  if (currentPlaylistId === pl.id) showPlaylistPage(pl.id);
  showToast(`Added to "${pl.name}"`);
}

function removeTrackFromPlaylist(videoId, playlistId) {
  const pl = playlists.find(p => p.id === playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter(t => t.videoId !== videoId);
  saveStorage();
  renderSidebar();
  showPlaylistPage(pl.id);
  showToast('Removed from playlist');
}

function toggleLike(track) {
  const idx = likedSongs.findIndex(t => t.videoId === track.videoId);
  if (idx === -1) {
    likedSongs.unshift(track);
    showToast('💜 Added to Liked Songs');
  } else {
    likedSongs.splice(idx, 1);
    showToast('Removed from Liked Songs');
  }
  saveStorage();
  renderSidebar();
  updateLikeBtn();
}

// ── CONTEXT MENUS ─────────────────────────────────────────────
function showTrackContextMenu(e, track, inPlaylistId = null, inLiked = false) {
  e.preventDefault();
  contextTarget = track;
  const liked = likedSongs.some(t => t.videoId === track.videoId);

  const items = [
    { label: '▶ Play now',      icon: 'play',   action: () => addToQueue(track, true) },
    { label: '+ Add to queue',  icon: 'queue',  action: () => addToQueue(track) },
    { type: 'separator' },
    { label: liked ? '💔 Remove from Liked' : '♡ Like', icon: 'like', action: () => toggleLike(track) },
    ...(playlists.length ? [
      { label: 'Add to Playlist ▶', icon: 'playlist', submenu: playlists.map(pl => ({
        label: pl.name, action: () => addTrackToPlaylist(track, pl.id)
      }))},
    ] : [
      { label: '+ Create playlist & add', icon: 'playlist', action: () => {
        const pl = createPlaylist(`My Playlist #${playlists.length + 1}`);
        addTrackToPlaylist(track, pl.id);
      }}
    ]),
    ...(inPlaylistId ? [
      { type: 'separator' },
      { label: '🗑 Remove from playlist', icon: 'del', action: () => removeTrackFromPlaylist(track.videoId, inPlaylistId) }
    ] : []),
    ...(inLiked ? [
      { type: 'separator' },
      { label: '🗑 Remove from liked', icon: 'del', action: () => toggleLike(track) }
    ] : []),
  ];

  showContextMenu(e.clientX, e.clientY, items);
}

function showPlaylistContextMenu(e, playlistId) {
  e.preventDefault ? e.preventDefault() : null;
  const items = [
    { label: '▶ Play',           action: () => { const pl = playlists.find(p=>p.id===playlistId); if(pl) playTracksFromList(pl.tracks,0); } },
    { type: 'separator' },
    { label: '🗑 Delete playlist', action: () => { if(confirm('Delete this playlist?')) deletePlaylist(playlistId); } }
  ];
  const x = e.clientX || e.pageX || 200;
  const y = e.clientY || e.pageY || 200;
  showContextMenu(x, y, items);
}

function showContextMenu(x, y, items) {
  const menu = document.getElementById('context-menu');
  const list = document.getElementById('context-menu-list');

  list.innerHTML = items.map(item => {
    if (item.type === 'separator') return '<li class="separator"></li>';
    return `<li data-action="__fn">${escHtml(item.label)}</li>`;
  }).join('');

  const lis = list.querySelectorAll('li:not(.separator)');
  const actionItems = items.filter(i => i.type !== 'separator');
  lis.forEach((li, i) => {
    li.addEventListener('click', () => {
      closeContextMenu();
      if (actionItems[i] && actionItems[i].action) actionItems[i].action();
    });
  });

  menu.style.display = 'block';
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  const rect = menu.getBoundingClientRect();
  if (rect.right  > window.innerWidth)  menu.style.left = (x - rect.width)  + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + 'px';

  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 10);
}

function closeContextMenu() {
  document.getElementById('context-menu').style.display = 'none';
}

// ── HTML BUILDERS ─────────────────────────────────────────────
function trackCardHTML(track, idx) {
  return `
    <div class="track-card" data-id="${track.videoId}" data-idx="${idx}">
      <div class="card-thumb-wrap">
        <img class="card-thumb" src="${escHtml(track.thumbnail)}" loading="lazy" onerror="this.style.display='none'" />
        <button class="card-play-btn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <div class="card-title">${escHtml(shortenTitle(track.title))}</div>
      <div class="card-sub">${escHtml(track.channelTitle || '')}</div>
    </div>`;
}

function trackRowHTML(track, idx, inPlaylist = false, inLiked = false) {
  const isCurrentlyPlaying = currentTrack && currentTrack.videoId === track.videoId;
  return `
    <div class="track-row${isCurrentlyPlaying ? ' playing' : ''}" data-id="${track.videoId}" data-idx="${idx}">
      <div class="track-num" data-id="${track.videoId}" data-idx="${idx + 1}">
        ${isCurrentlyPlaying
          ? '<div class="now-playing-bars"><span></span><span></span><span></span></div>'
          : (idx + 1)}
      </div>
      <div class="track-info-cell">
        <img class="track-cell-thumb" src="${escHtml(track.thumbnail)}" loading="lazy" onerror="this.style.display='none'" />
        <div>
          <div class="track-cell-name">${escHtml(shortenTitle(track.title))}</div>
          <div class="track-cell-artist">${escHtml(track.channelTitle || '—')}</div>
        </div>
      </div>
      <div class="track-cell-album">${escHtml(track.channelTitle || '—')}</div>
      <div class="track-cell-time">${typeof track.duration === 'number' ? formatTime(track.duration) : (track.duration || '—')}</div>
      <div class="track-cell-actions">
        <button class="icon-btn row-like-btn${likedSongs.some(t=>t.videoId===track.videoId)?' liked':''}" title="Like">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        <button class="icon-btn row-dots-btn" title="More">···</button>
      </div>
    </div>`;
}

function bindCardEvents(container, tracks) {
  container.querySelectorAll('.track-card').forEach(card => {
    const idx = parseInt(card.getAttribute('data-idx'), 10);
    card.addEventListener('click', () => playTracksFromList(tracks, idx));
  });
}

function bindTrackRowEvents(container, tracks, inPlaylist = false, inLiked = false) {
  container.querySelectorAll('.track-row').forEach(row => {
    const i = parseInt(row.getAttribute('data-idx'), 10);
    const track = tracks[i];
    if (!track) return;
    row.addEventListener('click', () => playTracksFromList(tracks, i));
    row.addEventListener('contextmenu', (e) => {
      showTrackContextMenu(e, track, inPlaylist ? currentPlaylistId : null, inLiked);
    });
  });
}

// ── PLAYER SETUP ──────────────────────────────────────────────
function setupPlayer() {
  document.getElementById('play-btn').addEventListener('click', togglePlayPause);
  document.getElementById('next-btn').addEventListener('click', playNext);
  document.getElementById('prev-btn').addEventListener('click', playPrev);

  document.getElementById('shuffle-btn').addEventListener('click', () => {
    isShuffled = !isShuffled;
    document.getElementById('shuffle-btn').classList.toggle('active', isShuffled);
    showToast(isShuffled ? '🔀 Shuffle on' : 'Shuffle off');
  });

  document.getElementById('repeat-btn').addEventListener('click', () => {
    repeatMode = (repeatMode + 1) % 3;
    const btn = document.getElementById('repeat-btn');
    btn.classList.toggle('active', repeatMode > 0);
    const labels = ['Repeat off', '🔁 Repeat all', '🔂 Repeat one'];
    btn.title = labels[repeatMode];
    showToast(labels[repeatMode]);
  });

  document.getElementById('like-btn').addEventListener('click', () => {
    if (currentTrack) toggleLike(currentTrack);
    else showToast('No song playing');
  });

  const volSlider = document.getElementById('volume-slider');
  volSlider.addEventListener('input', () => {
    volume = parseInt(volSlider.value, 10);
    audioEl.volume = volume / 100;
    isMuted = (volume === 0);
    updateVolIcons();
    updateVolumeSliderBg(volume);
    localStorage.setItem('mfy_volume', String(volume));
  });

  document.getElementById('mute-btn').addEventListener('click', () => {
    isMuted = !isMuted;
    audioEl.muted = isMuted;
    updateVolIcons();
  });

  document.getElementById('progress-container').addEventListener('click', (e) => {
    if (!currentTrack || !audioEl.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    audioEl.currentTime = pct * audioEl.duration;
  });

  document.getElementById('queue-toggle-btn').addEventListener('click', () => {
    const panel = document.getElementById('queue-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) updateQueuePanel();
  });

  document.getElementById('close-queue-btn').addEventListener('click', () => {
    document.getElementById('queue-panel').classList.remove('open');
  });

  document.getElementById('theme-btn').addEventListener('click', () => {
    const html  = document.documentElement;
    const theme = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', theme);
    localStorage.setItem('mfy_theme', theme);
    updateThemeIcon(theme);
  });
}

function updateVolIcons() {
  document.getElementById('vol-icon').style.display  = isMuted ? 'none' : '';
  document.getElementById('mute-icon').style.display = isMuted ? '' : 'none';
  updateVolumeSliderBg(isMuted ? 0 : volume);
}

function updateVolumeSliderBg(val) {
  const slider = document.getElementById('volume-slider');
  if (slider) slider.style.background = `linear-gradient(to right, var(--accent) ${val}%, var(--bg-highlight) ${val}%)`;
}

function updateThemeIcon(theme) {
  const moon = document.getElementById('moon-icon');
  const sun  = document.getElementById('sun-icon');
  if (!moon || !sun) return;
  moon.style.display = theme === 'dark' ? 'none' : 'block';
  sun.style.display  = theme === 'dark' ? 'block' : 'none';
}

// ── TITLEBAR ──────────────────────────────────────────────────
function setupTitlebar() {
  if (!window.electronAPI) return;
  document.getElementById('tb-min').addEventListener('click',   () => window.electronAPI.minimize());
  document.getElementById('tb-max').addEventListener('click',   () => window.electronAPI.maximize());
  document.getElementById('tb-close').addEventListener('click', () => window.electronAPI.close());
  window.electronAPI.onWindowState(state => {
    document.getElementById('tb-max').textContent = state === 'maximized' ? '❐' : '□';
  });
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch(e.code) {
      case 'Space':     e.preventDefault(); togglePlayPause();    break;
      case 'ArrowRight':
        if (e.shiftKey) { e.preventDefault(); playNext(); }
        else if (currentTrack && audioEl.duration) {
          e.preventDefault();
          audioEl.currentTime = Math.min(audioEl.duration, (audioEl.currentTime || 0) + 5);
        }
        break;
      case 'ArrowLeft':
        if (e.shiftKey) { e.preventDefault(); playPrev(); }
        else if (currentTrack) {
          e.preventDefault();
          audioEl.currentTime = Math.max(0, (audioEl.currentTime || 0) - 5);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        volume = Math.min(100, volume + 5);
        document.getElementById('volume-slider').value = volume;
        audioEl.volume = volume / 100;
        updateVolumeSliderBg(volume);
        break;
      case 'ArrowDown':
        e.preventDefault();
        volume = Math.max(0, volume - 5);
        document.getElementById('volume-slider').value = volume;
        audioEl.volume = volume / 100;
        updateVolumeSliderBg(volume);
        break;
      case 'KeyM':  document.getElementById('mute-btn').click(); break;
      case 'KeyL':  if (currentTrack) toggleLike(currentTrack);  break;
      case 'KeyS':  document.getElementById('shuffle-btn').click(); break;
      case 'KeyR':  document.getElementById('repeat-btn').click(); break;
    }
  });
}

// ── UTILS ─────────────────────────────────────────────────────
function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

function shortenTitle(title, max = 50) {
  if (!title) return '';
  title = title.replace(/\(Official.*?\)/gi, '')
               .replace(/\[Official.*?\]/gi, '')
               .replace(/\(Audio\)/gi, '')
               .replace(/\[Audio\]/gi, '')
               .replace(/\(Lyric.*?\)/gi, '')
               .replace(/\[Lyric.*?\]/gi, '')
               .replace(/\(Music Video\)/gi, '')
               .replace(/  +/g, ' ')
               .trim();
  if (title.length > max) return title.slice(0, max - 1) + '…';
  return title;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer = null;
function showToast(msg, duration = 2500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}
