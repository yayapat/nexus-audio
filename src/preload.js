const { contextBridge, ipcRenderer } = require('electron');

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

  // Playlist persistence
  saveState: (d) => ipcRenderer.send('pl:save-state', d),
  loadState: () => ipcRenderer.invoke('pl:load-state'),
  saveNamedPlaylist: (n, t) => ipcRenderer.invoke('pl:save-named', n, t),
  getNamedPlaylists: () => ipcRenderer.invoke('pl:get-names'),
  loadNamedPlaylist: (n) => ipcRenderer.invoke('pl:load-named', n),
  deleteNamedPlaylist: (n) => ipcRenderer.invoke('pl:delete-named', n),

  // Download
  dlStart: (o) => {
    if (!o || !Array.isArray(o.urls) || typeof o.format !== 'string') throw new Error('dlStart: o must have urls (array) and format (string)');
    ipcRenderer.send('dl:start', o);
  },
  dlGetPath: () => ipcRenderer.invoke('dl:get-path'),
  dlChangePath: () => ipcRenderer.invoke('dl:change-path'),
  dlCheckDeps: () => ipcRenderer.invoke('dl:check-deps'),
  cancelDownload: (url) => ipcRenderer.send('dl:cancel', url),
  onDlLog: (fn) => on('dl:log', fn),
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
