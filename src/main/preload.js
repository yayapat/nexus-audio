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
  reloadShortcuts: () => ipcRenderer.send('reload-shortcuts'),

  // Dialogs
  openFiles: () => ipcRenderer.invoke('dlg:open-files'),
  openFolder: () => ipcRenderer.invoke('dlg:open-folder'),
  selectDlFolder: () => ipcRenderer.invoke('dlg:select-dl-folder'),
  resolveDrop: (paths) => ipcRenderer.invoke('dlg:resolve-drop', paths),

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
  saveState: (d) => ipcRenderer.invoke('pl:save-state', d),
  loadState: () => ipcRenderer.invoke('pl:load-state'),

  // Download
  dlStart: (o) => {
    if (!o || !Array.isArray(o.urls) || typeof o.format !== 'string') throw new Error('dlStart: o must have urls (array) and format (string)');
    ipcRenderer.send('dl:start', o);
  },
  dlGetPath: () => ipcRenderer.invoke('dl:get-path'),
  dlChangePath: () => ipcRenderer.invoke('dl:change-path'),
  fsReaddir: (p) => ipcRenderer.invoke('fs:readdir', p),
  fsHomedir: () => ipcRenderer.invoke('fs:homedir'),
  fsParentdir: (p) => ipcRenderer.invoke('fs:parentdir', p),
  fsSetDlPath: (p) => ipcRenderer.invoke('fs:set-dl-path', p),
  fsQuickAccess: () => ipcRenderer.invoke('fs:quick-access'),
  dlCheckDeps: () => ipcRenderer.invoke('dl:check-deps'),
  checkYtdlp: () => ipcRenderer.invoke('dl:check-ytdlp'),
  updateYtdlp: () => ipcRenderer.invoke('dl:update-ytdlp'),
  cancelDownload: (url) => ipcRenderer.send('dl:cancel', url),
  dlOpenFile: (fp) => ipcRenderer.invoke('dl:open-file', fp),
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
