const { contextBridge, ipcRenderer } = require('electron');
let safeRoot = '';
if (typeof location !== 'undefined' && location.protocol === 'file:') {
  const parts = location.pathname.split('/');
  parts.pop(); // index.html
  parts.pop(); // renderer
  parts.pop(); // src
  safeRoot = 'file://' + parts.join('/') + '/';
}
contextBridge.exposeInMainWorld('_appRoot', safeRoot);

const on = (ch, fn) => {
  const handler = (_, ...a) => fn(...a);
  ipcRenderer.on(ch, handler);
  return () => ipcRenderer.removeListener(ch, handler);
};

contextBridge.exposeInMainWorld('nexus', {
  // Window
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  toggleMiniPlayer: () => ipcRenderer.send('win:toggle-mini'),
  toggleAlwaysOnTop: () => ipcRenderer.send('win:toggle-always-on-top'),
  onMiniPlayerChanged: (fn) => on('win:mini-changed', fn),


  // Dialogs
  openFiles: () => ipcRenderer.invoke('dlg:open-files'),
  openFolder: () => ipcRenderer.invoke('dlg:open-folder'),


  // Player — metadata extraction via music-metadata (replaces ffmpeg cover extraction)
  extractMetadata: (fp) => {
    if (typeof fp !== 'string' || !fp.trim()) throw new Error('extractMetadata: fp must be a non-empty string');
    return ipcRenderer.invoke('player:metadata', fp);
  },
  notifySongChange: (info) => ipcRenderer.send('player:notify', info),
  onMediaPlayPause: (fn) => on('media:play-pause', fn),
  onMediaPause: (fn) => on('media:pause', fn),
  onMediaNext: (fn) => on('media:next', fn),
  onMediaPrev: (fn) => on('media:prev', fn),
  saveMetadata: (d) => ipcRenderer.invoke('player:save-metadata', d),

  // Playlist persistence
  saveState: (d) => ipcRenderer.invoke('pl:save-state', d),
  loadState: () => ipcRenderer.invoke('pl:load-state'),

  // Download
  dlStart: (o) => {
    if (!o || !Array.isArray(o.urls) || typeof o.format !== 'string') throw new Error('dlStart: o must have urls (array) and format (string)');
    ipcRenderer.send('dl:start', o);
  },
  dlGetPath: () => ipcRenderer.invoke('dl:get-path'),
  dlChangePath: () => ipcRenderer.invoke('dl:change-path'),
  dlCheckDeps: () => ipcRenderer.invoke('dl:check-deps'),
  dlScanPlaylist: (url) => ipcRenderer.invoke('dl:scan-playlist', url),
  cancelDownload: (url) => ipcRenderer.send('dl:cancel', url),
  onDlProgress: (fn) => on('dl:progress', fn),
  onDlSuccess: (fn) => on('dl:success', fn),
  onDlError: (fn) => on('dl:error', fn),
  onDlComplete: (fn) => on('dl:complete', fn),

  // Config
  getConfig: (k) => ipcRenderer.invoke('cfg:get', k),
  setConfig: (k, v) => {
    if (typeof k !== 'string') throw new Error('setConfig: k must be a string');
    ipcRenderer.send('cfg:set', k, v);
  },

  // Context Menu
  showContextMenu: () => ipcRenderer.send('ctx:menu'),

  // Tray
  updateTray: (i) => ipcRenderer.send('tray:update', i),
});
