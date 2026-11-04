const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');

let mainWindow;
let ytdlInstance = null;
let ytdlChooseFormat = null;
const streamCache = new Map();

async function initYtdl() {
  if (!ytdlInstance) {
    const { Ytdl, chooseFormat } = await import('@distube/ytdl-core');
    ytdlInstance = new Ytdl();
    ytdlChooseFormat = chooseFormat;
  }
  return { ytdl: ytdlInstance, chooseFormat: ytdlChooseFormat };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 820,
    minWidth: 950,
    minHeight: 600,
    backgroundColor: '#121212',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      allowRunningInsecureContent: true
    },
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'src', 'icon.ico')
  });

  // Spoof Referer & Origin so YouTube embeds allow copyrighted / label tracks
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.youtube.com/*', '*://*.googlevideo.com/*'] }, (details, callback) => {
    details.requestHeaders['Referer'] = 'https://www.youtube.com/';
    details.requestHeaders['Origin'] = 'https://www.youtube.com';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  // Allow all CSP so YouTube API and streams load fine
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: mediastream:;"
        ]
      }
    });
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('maximize',   () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', 'normal'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });

// ── Window controls ───────────────────────────────────────────
ipcMain.on('minimize-window', () => mainWindow && mainWindow.minimize());
ipcMain.on('maximize-window', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('close-window',   () => mainWindow && mainWindow.close());
ipcMain.on('open-external',  (_, url) => shell.openExternal(url));

// ── Direct audio stream extraction ────────────────────────────
ipcMain.handle('get-stream-url', async (_, videoId) => {
  const cached = streamCache.get(videoId);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  try {
    const { ytdl, chooseFormat } = await initYtdl();
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await ytdl.getInfo(url);

    let format;
    try {
      format = chooseFormat(info.formats, {
        quality: 'highestaudio',
        filter: f => f.hasAudio && !f.hasVideo
      });
    } catch (_) {}

    if (!format || !format.url) {
      format = info.formats.find(f => f.hasAudio && f.url);
    }

    if (!format || !format.url) {
      return { error: 'No playable stream found' };
    }

    const result = {
      url: format.url,
      mimeType: format.mimeType || 'audio/mp4',
      duration: parseInt(info.videoDetails.lengthSeconds, 10) || 0,
      title: info.videoDetails.title
    };

    streamCache.set(videoId, { data: result, expires: Date.now() + 60 * 60 * 1000 });
    return result;
  } catch (err) {
    return { error: err.message };
  }
});
