// ============================================================================
// Nexus Audio — Electron Main Process
// ============================================================================
// Main process สำหรับแอป Nexus Audio: music player & downloader
// รองรับ: window management, tray, media keys, download (yt-dlp), metadata
// ============================================================================

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  Tray,
  Notification,
  nativeImage,
  globalShortcut,
  protocol,
  net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { spawn } = require('child_process');
const crypto = require('crypto');
const mm = require('music-metadata');

// Disable Wayland color manager to prevent error logs on Linux/Wayland (e.g. CachyOS)
app.commandLine.appendSwitch('disable-features', 'WaylandWpColorManagerV1');

// BUG-001 fix: Register custom protocol for safe local file access
protocol.registerSchemesAsPrivileged([{
  scheme: 'nexus-local',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    bypassCSP: true,
    corsEnabled: true,
  }
}]);

// ============================================================================
// Constants & Paths
// ============================================================================

const ICON_PATH = path.join(__dirname, '../assets/icon.png');
const AUDIO_EXTENSIONS = [
  '.mp3', '.wav', '.flac', '.m4a', '.ogg', '.wma', '.aac', '.opus', '.webm',
];
const AUDIO_FILTER = {
  name: 'Audio Files',
  extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'wma', 'aac', 'opus', 'webm'],
};

// ============================================================================
// Global State
// ============================================================================

let win = null;
let tray = null;
let config = {};
let isMiniplayer = false;
let previousBounds = null;   // เก็บ bounds ก่อนเข้า mini player
let saveBoundsTimer = null;  // debounce timer สำหรับ save window bounds
let currentDlPath = '';      // download path ปัจจุบัน
let isDownloading = false;   // guard flag to prevent concurrent download batches (B7)

// B13: Whitelist of allowed config keys for cfg:set
const ALLOWED_CONFIG_KEYS = ['theme', 'dlPath', 'volume', 'lastFolder', 'windowBounds', 'eqGains', 'eqPresetName', 'userEqPresets', 'autoNext'];

// I10: Maximum number of cached cover images before eviction
const COVER_CACHE_LIMIT = 500;

// ============================================================================
// Config Management
// ============================================================================

function getConfigPath() {
  return path.join(app.getPath('userData'), 'nexus_config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    config = JSON.parse(raw);
  } catch {
    // ไม่มีไฟล์ config หรืออ่านไม่ได้ — ใช้ค่า default
    config = {};
  }
  // ตั้ง download path default เป็น ~/Music ถ้าไม่มี
  if (!config.dlPath) {
    config.dlPath = path.join(app.getPath('music') || app.getPath('home'), 'NexusAudio');
  }
  currentDlPath = config.dlPath;
}

async function saveConfig(data) {
  if (data) Object.assign(config, data);
  try {
    await fs.promises.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Config] Save error:', err.message);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** ค้นหาไฟล์เสียงทั้งหมดใน directory แบบ recursive (Asynchronous) */
async function findAudioFiles(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map((entry) => {
      const res = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return findAudioFiles(res);
      } else if (AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        return res;
      }
      return null;
    }));
    return files.flat(Infinity).filter(f => f != null);
  } catch (err) {
    console.error('[Scan] Error reading directory:', err.message);
    return [];
  }
}

/**
 * Sanitize text สำหรับ log output.
 * IPC log messages are displayed via textContent in the renderer,
 * so HTML escaping is unnecessary and would show literal &amp; etc.
 * Instead, strip control characters that could cause display issues.
 */
function sanitize(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** Extract metadata จากไฟล์เสียง — return object สำหรับ renderer */
async function extractMetadata(filePath) {
  try {
    const metadata = await mm.parseFile(filePath);
    const pic = metadata.common.picture?.[0];
    let coverUrl = null;
    if (pic && pic.data) {
      const coversDir = path.join(app.getPath('userData'), 'covers');
      if (!fs.existsSync(coversDir)) await fs.promises.mkdir(coversDir, { recursive: true });
      
      const hash = crypto.createHash('md5').update(pic.data).digest('hex');
      const ext = pic.format === 'image/png' ? 'png' : 'jpg';
      const coverPath = path.join(coversDir, `${hash}.${ext}`);
      
      if (!fs.existsSync(coverPath)) {
        await fs.promises.writeFile(coverPath, pic.data);

        // I10: Evict oldest cover images if cache exceeds limit
        try {
          const allCovers = await fs.promises.readdir(coversDir);
          if (allCovers.length > COVER_CACHE_LIMIT) {
            const stats = await Promise.all(
              allCovers.map(async (f) => {
                const fp = path.join(coversDir, f);
                const st = await fs.promises.stat(fp);
                return { path: fp, mtimeMs: st.mtimeMs };
              })
            );
            stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
            const toDelete = stats.slice(0, stats.length - COVER_CACHE_LIMIT);
            await Promise.all(toDelete.map((f) => fs.promises.unlink(f.path).catch(() => {})));
          }
        } catch (evictErr) {
          console.error('[Covers] Cache eviction error:', evictErr.message);
        }
      }
      // B15: Properly encode file path to URL
      coverUrl = url.pathToFileURL(coverPath).href;
    }

    return {
      title: metadata.common.title || path.basename(filePath, path.extname(filePath)),
      artist: metadata.common.artist || 'Unknown Artist',
      album: metadata.common.album || 'Unknown Album',
      duration: metadata.format.duration || 0,
      cover: coverUrl,
    };
  } catch (err) {
    console.error('[Metadata] Error:', err.message);
    return {
      title: path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0,
      cover: null,
    };
  }
}

// ============================================================================
// Window Creation
// ============================================================================

function createWindow() {
  // ดึง bounds จาก config (จำตำแหน่ง/ขนาดหน้าต่าง)
  const bounds = config.windowBounds || {};

  win = new BrowserWindow({
    width: bounds.width || 1000,
    height: bounds.height || 650,
    x: bounds.x,
    y: bounds.y,
    minWidth: 850,
    minHeight: 450,
    frame: false,
    transparent: true,
    hasShadow: true,
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    // New Electron versions might pass a single object or old args depending on the version.
    // The warning says: Please use Event<WebContentsConsoleMessageEventParams> object instead.
    if (typeof level === 'object') {
      console.log(`[Renderer] ${level.message} (${level.sourceId}:${level.line})`);
    } else {
      console.log(`[Renderer] ${message} (${sourceId}:${line})`);
    }
  });

  // ---------- Window Events ----------

  // ปิดหน้าต่าง → ซ่อนไปที่ tray แทนการ quit (ถ้ามี tray)
  win.on('close', (e) => {
    if (tray && !app.isQuitting) {
      e.preventDefault();
      win.hide();
      win.webContents.send('media:pause'); // หยุดเพลงเมื่อปิดแอปไปที่ tray
    }
  });

  // Save bounds เมื่อ resize/move (debounce 500ms)
  const saveBounds = () => {
    if (isMiniplayer) return; // ไม่บันทึก bounds ตอนอยู่ใน mini mode
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(async () => {
      if (win && !win.isDestroyed()) {
        config.windowBounds = win.getBounds();
        await saveConfig();
      }
    }, 500);
  };

  win.on('resize', saveBounds);
  win.on('move', saveBounds);
}

// ============================================================================
// System Tray (F21)
// ============================================================================

function createTray() {
  try {
    const trayIcon = nativeImage
      .createFromPath(ICON_PATH)
      .resize({ width: 22, height: 22 });
    tray = new Tray(trayIcon);
    tray.setToolTip('Nexus Audio');
    buildTrayMenu('Not Playing', false);

    // คลิก tray icon → แสดง/focus หน้าต่าง
    tray.on('click', () => {
      if (win) {
        win.show();
        win.focus();
      }
    });
  } catch (err) {
    console.error('[Tray] Failed to create tray:', err.message);
    tray = null;
  }
}

function buildTrayMenu(title, isPlaying) {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isPlaying ? '⏸ Pause' : '▶ Play',
      click: () => win?.webContents.send('media:play-pause'),
    },
    {
      label: '⏭ Next',
      click: () => win?.webContents.send('media:next'),
    },
    {
      label: '⏮ Previous',
      click: () => win?.webContents.send('media:prev'),
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        if (win) { win.show(); win.focus(); }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip(title || 'Nexus Audio');
}

// ============================================================================
// Media Keys (F22)
// ============================================================================

function registerMediaKeys() {
  const keys = [
    { key: 'MediaPlayPause', channel: 'media:play-pause' },
    { key: 'MediaNextTrack', channel: 'media:next' },
    { key: 'MediaPreviousTrack', channel: 'media:prev' },
  ];

  for (const { key, channel } of keys) {
    try {
      globalShortcut.register(key, () => {
        win?.webContents.send(channel);
      });
    } catch (err) {
      // บาง key อาจ register ไม่ได้ในบาง platform
      console.error(`[MediaKey] Failed to register ${key}:`, err.message);
    }
  }
}

// ============================================================================
// IPC Handlers — Window
// ============================================================================

function setupWindowIPC() {
  ipcMain.on('win:minimize', () => {
    win?.minimize();
  });

  ipcMain.on('win:maximize', () => {
    if (!win) return;
    if (win.isMaximized()) {
      win.restore();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('win:close', () => {
    if (!win) return;
    if (tray) {
      win.hide();
      win.webContents.send('media:pause'); // หยุดเพลงเมื่อปิดแอปไปที่ tray
    } else {
      app.isQuitting = true;
      app.quit();
    }
  });

  ipcMain.on('win:toggle-mini', () => {
    if (!win) return;

    if (isMiniplayer) {
      // กลับสู่โหมดปกติ
      isMiniplayer = false;
      if (previousBounds) {
        win.setBounds(previousBounds);
      }
      win.setAlwaysOnTop(false);
      win.setSkipTaskbar(false);
      win.setMinimumSize(850, 450);
    } else {
      // เข้า mini player mode
      previousBounds = win.getBounds();
      isMiniplayer = true;
      win.setMinimumSize(300, 80);
      win.setSize(400, 90);
      win.setAlwaysOnTop(true);
      win.setSkipTaskbar(true);
    }
    win.webContents.send('win:mini-changed', isMiniplayer);
  });
}

// ============================================================================
// IPC Handlers — Dialogs
// ============================================================================

function setupDialogIPC() {
  ipcMain.handle('dlg:open-files', async () => {
    try {
      const result = await dialog.showOpenDialog(win, {
        title: 'Select Audio Files',
        filters: [AUDIO_FILTER],
        properties: ['openFile', 'multiSelections'],
      });
      return result.canceled ? [] : result.filePaths;
    } catch (err) {
      console.error('[Dialog] open-files error:', err.message);
      return [];
    }
  });

  ipcMain.handle('dlg:open-folder', async () => {
    try {
      const result = await dialog.showOpenDialog(win, {
        title: 'Select Folder',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths.length) return [];
      return findAudioFiles(result.filePaths[0]);
    } catch (err) {
      console.error('[Dialog] open-folder error:', err.message);
      return [];
    }
  });
}

// ============================================================================
// IPC Handlers — Player
// ============================================================================

function setupPlayerIPC() {
  ipcMain.handle('player:metadata', async (_event, filePath) => {
    return extractMetadata(filePath);
  });

  ipcMain.on('player:notify', (_event, { title, artist, cover }) => {
    try {
      if (Notification.isSupported()) {
        let iconImage = ICON_PATH;
        if (cover) {
          if (cover.startsWith('data:')) {
            iconImage = nativeImage.createFromDataURL(cover);
          } else if (cover.startsWith('file://')) {
            const coverPath = url.fileURLToPath(cover);
            iconImage = nativeImage.createFromPath(coverPath);
          }
        }
        const notif = new Notification({
          title: title || 'Nexus Audio',
          body: artist || 'Unknown Artist',
          icon: iconImage,
          silent: true,
        });
        notif.show();
      }
    } catch (err) {
      console.error('[Notification] Error:', err.message);
    }
  });
}

// ============================================================================
// IPC Handlers — Playlist
// ============================================================================

function setupPlaylistIPC() {
  const stateFile = () => path.join(app.getPath('userData'), 'playlist_state.json');
  const playlistsDir = () => path.join(app.getPath('userData'), 'playlists');

  // Save playlist state (ล่าสุด — tracks, position, etc.)
  ipcMain.on('pl:save-state', async (_event, data) => {
    try {
      await fs.promises.writeFile(stateFile(), JSON.stringify(data), 'utf-8');
    } catch (err) {
      console.error('[Playlist] save-state error:', err.message);
    }
  });

  // Load playlist state
  ipcMain.handle('pl:load-state', async () => {
    try {
      const raw = await fs.promises.readFile(stateFile(), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  // Save named playlist
  ipcMain.handle('pl:save-named', async (_event, name, tracks) => {
    try {
      // B6: Sanitize playlist name to prevent path traversal
      const safeName = path.basename(String(name)).replace(/[\/\\]/g, '').replace(/\.\./g, '');
      if (!safeName) return false;
      const dir = playlistsDir();
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const filePath = path.join(dir, safeName + '.json');
      await fs.promises.writeFile(filePath, JSON.stringify(tracks), 'utf-8');
      return true;
    } catch (err) {
      console.error('[Playlist] save-named error:', err.message);
      return false;
    }
  });

  // Get list of named playlists
  ipcMain.handle('pl:get-names', async () => {
    try {
      const dir = playlistsDir();
      if (!fs.existsSync(dir)) return [];
      const files = await fs.promises.readdir(dir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      
      const results = await Promise.all(jsonFiles.map(async (f) => {
        try {
          const raw = await fs.promises.readFile(path.join(dir, f), 'utf-8');
          const tracks = JSON.parse(raw);
          return {
            name: path.basename(f, '.json'),
            count: Array.isArray(tracks) ? tracks.length : 0,
          };
        } catch {
          return { name: path.basename(f, '.json'), count: 0 };
        }
      }));
      return results;
    } catch (err) {
      console.error('[Playlist] get-names error:', err.message);
      return [];
    }
  });

  // Load named playlist
  ipcMain.handle('pl:load-named', async (_event, name) => {
    try {
      // B6: Sanitize playlist name to prevent path traversal
      const safeName = path.basename(String(name)).replace(/[\/\\]/g, '').replace(/\.\./g, '');
      if (!safeName) return null;
      const filePath = path.join(playlistsDir(), safeName + '.json');
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[Playlist] load-named error:', err.message);
      return null;
    }
  });

  // Delete named playlist
  ipcMain.handle('pl:delete-named', async (_event, name) => {
    try {
      // B6: Sanitize playlist name to prevent path traversal
      const safeName = path.basename(String(name)).replace(/[\/\\]/g, '').replace(/\.\./g, '');
      if (!safeName) return false;
      const filePath = path.join(playlistsDir(), safeName + '.json');
      await fs.promises.unlink(filePath);
      return true;
    } catch (err) {
      console.error('[Playlist] delete-named error:', err.message);
      return false;
    }
  });
}

// ============================================================================
// IPC Handlers — Download
// ============================================================================

const activeDownloads = new Map();

function setupDownloadIPC() {
  // Get current download path
  ipcMain.handle('dl:get-path', async () => {
    return currentDlPath;
  });

  // Change download path ผ่าน folder picker
  ipcMain.handle('dl:change-path', async () => {
    try {
      const result = await dialog.showOpenDialog(win, {
        title: 'Select Download Folder',
        defaultPath: currentDlPath,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths.length) return null;
      currentDlPath = result.filePaths[0];
      config.dlPath = currentDlPath;
      await saveConfig();
      return currentDlPath;
    } catch (err) {
      console.error('[Download] change-path error:', err.message);
      return null;
    }
  });

  // Check if yt-dlp and ffmpeg are available in PATH
  ipcMain.handle('dl:check-deps', async () => {
    const check = (cmd) =>
      new Promise((resolve) => {
        const proc = spawn('which', [cmd]);
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });

    const [ytdlp, ffmpeg] = await Promise.all([check('yt-dlp'), check('ffmpeg')]);
    return { ytdlp, ffmpeg };
  });

  ipcMain.on('dl:cancel', (_event, url) => {
    const proc = activeDownloads.get(url);
    if (proc) {
      proc.kill('SIGKILL');
      activeDownloads.delete(url);
    }
  });

  // Start download — ใช้ spawn() เพื่อหลีกเลี่ยง command injection
  ipcMain.on('dl:start', async (_event, { urls, format, quality }) => {
    if (!Array.isArray(urls) || urls.length === 0) return;

    // B7: Prevent concurrent download batches
    if (isDownloading) {
      win?.webContents.send('dl:error', { url: urls[0], message: 'A download batch is already in progress. Please wait.' });
      return;
    }
    isDownloading = true;

    // B12: Validate all URLs before starting
    const validUrls = [];
    for (const u of urls) {
      const trimmed = String(u).trim();
      if (!trimmed) {
        win?.webContents.send('dl:error', { url: u, message: 'Empty URL' });
        continue;
      }
      if (trimmed.startsWith('--')) {
        win?.webContents.send('dl:error', { url: u, message: 'Invalid URL: flag injection attempt' });
        continue;
      }
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        win?.webContents.send('dl:error', { url: u, message: 'Invalid URL: must start with http:// or https://' });
        continue;
      }
      validUrls.push(trimmed);
    }

    if (validUrls.length === 0) {
      isDownloading = false;
      win?.webContents.send('dl:complete');
      return;
    }

    // B14: If mkdir fails, report error for all URLs and return early
    try {
      if (!fs.existsSync(currentDlPath)) {
        await fs.promises.mkdir(currentDlPath, { recursive: true });
      }
    } catch (err) {
      console.error('[Download] Cannot create directory:', err.message);
      for (const u of validUrls) {
        win?.webContents.send('dl:error', { url: u, message: `Cannot create download directory: ${err.message}` });
      }
      isDownloading = false;
      win?.webContents.send('dl:complete');
      return;
    }

    const CONCURRENCY_LIMIT = 3;
    let activeCount = 0;
    let index = 0;

    new Promise((resolve) => {
      function next() {
        if (index >= validUrls.length && activeCount === 0) {
          isDownloading = false;
          win?.webContents.send('dl:complete');
          resolve();
          return;
        }
        while (activeCount < CONCURRENCY_LIMIT && index < validUrls.length) {
          const dlUrl = validUrls[index++];
          activeCount++;
          downloadSingleURL(dlUrl, format, quality).then(() => {
            activeCount--;
            next();
          });
        }
      }
      next();
    });
  });
}

/**
 * ดาวน์โหลดไฟล์จาก URL เดียว ผ่าน yt-dlp (spawn)
 * - ใช้ --print after_move:filepath เพื่อจับ path ของไฟล์ที่ดาวน์โหลดเสร็จ
 * - Parse progress จาก stdout
 * - ส่ง events กลับไปที่ renderer
 */
function downloadSingleURL(url, format, quality) {
  return new Promise((resolve) => {
    const args = [
      '-x',
      '--audio-format', format || 'mp3',
      '--embed-thumbnail',
      '--add-metadata',
      '--newline',
      '-o', path.join(currentDlPath, '%(title)s.%(ext)s'),
      url,
    ];

    // เพิ่ม audio quality สำหรับ mp3/m4a
    if ((format === 'mp3' || format === 'm4a') && quality) {
      args.splice(args.indexOf('--newline') + 1, 0, '--audio-quality', quality + 'k');
    }

    let outputFilePath = null;
    const proc = spawn('yt-dlp', args);
    activeDownloads.set(url, proc);

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        // ส่ง log ทุกบรรทัดไปที่ renderer
        win?.webContents.send('dl:log', sanitize(line));

        // Parse progress: [download]   0.4% of  246.27KiB at  Unknown B/s ETA Unknown
        const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (progressMatch) {
          // Extract speed and ETA safely
          const speedMatch = line.match(/at\s+(.*?)\s+ETA/);
          const etaMatch = line.match(/ETA\s+(.*)/);
          
          win?.webContents.send('dl:progress', {
            url,
            percent: progressMatch[1],
            speed: speedMatch ? speedMatch[1].trim() : '--',
            eta: etaMatch ? etaMatch[1].trim() : '--',
          });
          continue;
        }

        // Parse final output file path
        if (line.includes('[ExtractAudio] Destination:')) {
          outputFilePath = line.split('[ExtractAudio] Destination:')[1].trim();
        } else if (line.includes('[download] Destination:')) {
          const dest = line.split('[download] Destination:')[1].trim();
          if (format && dest.endsWith('.' + format)) {
            outputFilePath = dest;
          } else if (!format) {
            outputFilePath = dest;
          }
        } else if (line.includes('has already been downloaded')) {
          const m = line.match(/\[download\]\s+(.*?)\s+has already been downloaded/);
          if (m) outputFilePath = m[1].trim();
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          win?.webContents.send('dl:log', sanitize(line));
        }
      }
    });

    proc.on('close', async (code) => {
      activeDownloads.delete(url);
      if (code === 0 && outputFilePath) {
        try {
          const metadata = await extractMetadata(outputFilePath);
          win?.webContents.send('dl:success', {
            url,
            filePath: outputFilePath,
            metadata: {
              title: metadata.title,
              artist: metadata.artist,
              album: metadata.album,
              cover: metadata.cover,
            },
          });
        } catch (err) {
          console.error('[Download] metadata extraction error:', err.message);
          win?.webContents.send('dl:success', { url, filePath: outputFilePath, metadata: null });
        }
      } else {
        win?.webContents.send('dl:error', { url, message: `Download failed with exit code ${code}` });
      }
      resolve();
    });

    proc.on('error', (err) => {
      console.error('[Download] spawn error:', err.message);
      // B8: Send dl:error event and clean up activeDownloads on spawn error
      win?.webContents.send('dl:log', `[Error] ${sanitize(err.message)}`);
      win?.webContents.send('dl:error', { url, message: `Spawn error: ${err.message}` });
      activeDownloads.delete(url);
      resolve();
    });
  });
}

// ============================================================================
// IPC Handlers — Config
// ============================================================================

function setupConfigIPC() {
  ipcMain.handle('cfg:get', async (_event, key) => {
    try {
      return config[key] ?? null;
    } catch {
      return null;
    }
  });

  ipcMain.on('cfg:set', async (_event, key, value) => {
    try {
      // B13: Only allow whitelisted config keys
      if (!ALLOWED_CONFIG_KEYS.includes(key)) {
        console.warn(`[Config] Blocked setting non-whitelisted key: ${key}`);
        return;
      }
      config[key] = value;
      await saveConfig();
    } catch (err) {
      console.error('[Config] set error:', err.message);
    }
  });
}

// ============================================================================
// IPC Handlers — Context Menu
// ============================================================================

function setupContextMenuIPC() {
  ipcMain.on('ctx:menu', () => {
    const menu = Menu.buildFromTemplate([
      { role: 'cut', label: 'Cut' },
      { role: 'copy', label: 'Copy' },
      { role: 'paste', label: 'Paste' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Select All' },
    ]);
    menu.popup({ window: win });
  });
}

// ============================================================================
// IPC Handlers — Tray Update
// ============================================================================

function setupTrayIPC() {
  ipcMain.on('tray:update', (_event, { title, isPlaying }) => {
    buildTrayMenu(title, isPlaying);
  });
}

// ============================================================================
// App Lifecycle
// ============================================================================

// ป้องกัน multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // เมื่อ user เปิด instance ที่ 2 → แสดงหน้าต่างของ instance แรก
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  protocol.handle('nexus-local', async (request) => {
    const rawUrl = request.url;
    let filePath = decodeURIComponent(rawUrl.slice('nexus-local://'.length));
    if (!/^[a-zA-Z]:/.test(filePath) && !filePath.startsWith('/')) {
      filePath = '/' + filePath;
    }
    
    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const rangeHeader = request.headers.get('Range');
      
      let start = 0;
      let end = fileSize - 1;
      let statusCode = 200;
      const headers = new Headers();
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Accept-Ranges', 'bytes');
      
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const partialStart = parts[0];
        const partialEnd = parts[1];
        
        start = parseInt(partialStart, 10);
        end = partialEnd ? parseInt(partialEnd, 10) : fileSize - 1;
        
        statusCode = 206;
        headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      }
      
      headers.set('Content-Length', (end - start + 1).toString());
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
      };
      headers.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      
      const nodeStream = fs.createReadStream(filePath, { start, end });
      const { Readable } = require('stream');
      const webStream = Readable.toWeb(nodeStream);
      
      return new Response(webStream, {
        status: statusCode,
        headers: headers
      });
    } catch (e) {
      console.error('[Protocol] Error reading file:', filePath, e);
      return new Response('File not found', { status: 404 });
    }
  });

  // โหลด config ก่อนสร้าง window
  loadConfig();

  // สร้างหน้าต่างหลัก
  createWindow();

  // สร้าง system tray
  createTray();

  // ลงทะเบียน media keys
  registerMediaKeys();

  // ตั้ง IPC handlers ทั้งหมด
  setupWindowIPC();
  setupDialogIPC();
  setupPlayerIPC();
  setupPlaylistIPC();
  setupDownloadIPC();
  setupConfigIPC();
  setupContextMenuIPC();
  setupTrayIPC();
});

// macOS: สร้างหน้าต่างใหม่เมื่อคลิก dock icon ถ้าไม่มี window
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    win?.show();
  }
});

// ปิดแอปเมื่อปิดหน้าต่างทั้งหมด (ยกเว้น macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup เมื่อ quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();

  // B17: Kill all active download processes on quit
  for (const [dlUrl, proc] of activeDownloads) {
    try {
      proc.kill('SIGKILL');
    } catch (err) {
      console.error(`[Download] Failed to kill process for ${dlUrl}:`, err.message);
    }
  }
  activeDownloads.clear();
});

// จับ flag สำหรับ quit จริงๆ (ไม่ใช่แค่ hide)
app.isQuitting = false;
app.on('before-quit', () => {
  app.isQuitting = true;
});
