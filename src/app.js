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
  net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const mm = require('music-metadata');

// Disable Wayland color manager to prevent error logs on Linux/Wayland (e.g. CachyOS)
app.commandLine.appendSwitch('disable-features', 'WaylandWpColorManagerV1');

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

function saveConfig(data) {
  if (data) Object.assign(config, data);
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
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

/** Sanitize text สำหรับ log output — escape HTML characters */
function sanitize(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      }
      coverUrl = `file://${coverPath}`;
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
      webSecurity: false, // จำเป็นสำหรับ file:// audio playback
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
    saveBoundsTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        config.windowBounds = win.getBounds();
        saveConfig();
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
      win.setMinimumSize(700, 450);
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
        const iconImage = cover ? nativeImage.createFromDataURL(cover) : ICON_PATH;
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
      const dir = playlistsDir();
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const filePath = path.join(dir, name + '.json');
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
      const filePath = path.join(playlistsDir(), name + '.json');
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
      const filePath = path.join(playlistsDir(), name + '.json');
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
      saveConfig();
      return currentDlPath;
    } catch (err) {
      console.error('[Download] change-path error:', err.message);
      return null;
    }
  });

  // Auto-download yt-dlp function
  async function ensureYtDlp() {
    const binDir = path.join(app.getPath('userData'), 'bin');
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
    
    let ytdlpName = 'yt-dlp';
    if (process.platform === 'win32') ytdlpName = 'yt-dlp.exe';
    else if (process.platform === 'darwin') ytdlpName = 'yt-dlp_macos';
    
    const ytdlpPath = path.join(binDir, ytdlpName);
    if (fs.existsSync(ytdlpPath)) return ytdlpPath;

    win?.webContents.send('dl:log', '[System] Downloading yt-dlp binary for the first time... Please wait.');
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpName}`;
    
    return new Promise((resolve) => {
      const request = net.request(url);
      request.on('response', (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // Follow redirect manually if needed, but net.request usually handles it.
          // Just in case, let's follow the first redirect explicitly if net.request doesn't.
        }
        if (response.statusCode !== 200 && response.statusCode !== 302) {
          win?.webContents.send('dl:log', `[Error] Failed to download yt-dlp: HTTP ${response.statusCode}`);
          return resolve(null);
        }
        const file = fs.createWriteStream(ytdlpPath);
        response.on('data', (chunk) => file.write(chunk));
        response.on('end', () => {
          file.end();
          if (process.platform !== 'win32') fs.chmodSync(ytdlpPath, '755');
          win?.webContents.send('dl:log', '[System] yt-dlp downloaded successfully!');
          resolve(ytdlpPath);
        });
      });
      request.on('error', (err) => {
        win?.webContents.send('dl:log', `[Error] ${err.message}`);
        resolve(null);
      });
      request.end();
    });
  }

  ipcMain.handle('dl:check-deps', async () => {
    win?.webContents.send('dl:log', '[System] Checking dependencies...');
    const ytdlpPath = await ensureYtDlp();
    let ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath && ffmpegPath.includes('app.asar')) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
    return { ytdlp: !!ytdlpPath, ffmpeg: !!ffmpegPath };
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

    try {
      if (!fs.existsSync(currentDlPath)) {
        await fs.promises.mkdir(currentDlPath, { recursive: true });
      }
    } catch (err) {
      console.error('[Download] Cannot create directory:', err.message);
    }

    const CONCURRENCY_LIMIT = 3;
    let activeCount = 0;
    let index = 0;

    return new Promise((resolve) => {
      function next() {
        if (index >= urls.length && activeCount === 0) {
          win?.webContents.send('dl:complete');
          resolve();
          return;
        }
        while (activeCount < CONCURRENCY_LIMIT && index < urls.length) {
          const url = urls[index++];
          activeCount++;
          downloadSingleURL(url, format, quality).then(() => {
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
  return new Promise(async (resolve) => {
    // ดึง path ปัจจุบันของ yt-dlp และ ffmpeg
    const binDir = path.join(app.getPath('userData'), 'bin');
    let ytdlpName = 'yt-dlp';
    if (process.platform === 'win32') ytdlpName = 'yt-dlp.exe';
    else if (process.platform === 'darwin') ytdlpName = 'yt-dlp_macos';
    const ytdlpPath = path.join(binDir, ytdlpName);

    let ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath && ffmpegPath.includes('app.asar')) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }

    if (!fs.existsSync(ytdlpPath)) {
      win?.webContents.send('dl:log', '[Error] yt-dlp binary is missing.');
      return resolve();
    }

    const args = [
      '--ffmpeg-location', ffmpegPath,
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
    const proc = spawn(ytdlpPath, args);
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
        win?.webContents.send('dl:error', { url });
      }
      resolve();
    });

    proc.on('error', (err) => {
      console.error('[Download] spawn error:', err.message);
      win?.webContents.send('dl:log', `[Error] ${sanitize(err.message)}`);
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

  ipcMain.on('cfg:set', (_event, key, value) => {
    try {
      config[key] = value;
      saveConfig();
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
  // โหลด config ก่อนสร้าง window
  loadConfig();

  // สร้างหน้าต่างหลัก
  createWindow();

  // สร้าง system tray
  createTray();



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



// จับ flag สำหรับ quit จริงๆ (ไม่ใช่แค่ hide)
app.isQuitting = false;
app.on('before-quit', () => {
  app.isQuitting = true;
});
