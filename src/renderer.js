const nx = window.nexus;

// --- State ---
let playlist = [];
let currentIdx = -1;
let isPlaying = false;
let isShuffle = false;
let isLoop = false;
let isAutoNext = true;
let isDraggingSlider = false;

let metadataCache = new Map();
let theme = 'light';
let downloadQueue = [];

const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous";
const el = (id) => document.getElementById(id);

/** BUG-001/BUG-005 fix: Convert local file path to safe nexus-local:// URL */
function pathToSafeURL(filePath) {
  return 'nexus-local://' + encodeURI(filePath).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

// --- Context Menu ---
window.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    e.preventDefault();
    nx.showContextMenu();
  }
});

// --- Initialization ---
async function init() {
  try {
    theme = await nx.getConfig('theme') || 'light';
    if (theme === 'dark') document.documentElement.classList.add('dark');
    
    audioPlayer.volume = await nx.getConfig('volume') ?? 1;
    el('volSlider').value = audioPlayer.volume * 100;
    updateVolIcon(audioPlayer.volume);

    const state = await nx.loadState();
    if (state) {
      playlist = state.playlist || [];
      currentIdx = state.currentIdx ?? -1;
      isShuffle = state.isShuffle || false;
      isLoop = state.isLoop || false;
      isAutoNext = state.autoNext ?? true;
      
      updateControlStateUI();
      renderAllPlaylists();
      
      if (currentIdx >= 0 && currentIdx < playlist.length) {
        audioPlayer.src = pathToSafeURL(playlist[currentIdx].path);
        loadTrackUI(currentIdx, false);
      } else {
        progBar.disabled = true;
        el('btnPlay').disabled = true;
        el('btnNext').disabled = true;
        el('btnPrev').disabled = true;
      }
    
      // Background metadata fetch for all loaded tracks
      if (playlist.length > 0) {
        let initRenderTimeout;
        for (const t of playlist) {
          if (!metadataCache.has(t.path)) {
            nx.extractMetadata(t.path).then(meta => {
              metadataCache.set(t.path, meta);
              clearTimeout(initRenderTimeout);
              initRenderTimeout = setTimeout(() => renderAllPlaylists(), 300);
            }).catch(err => {
              console.error('Failed to extract metadata for', t.path, err);
            });
          }
        }
      }
    }

    loadNamedPlaylists();

    const p = await nx.dlGetPath();
    el('btnChangePath').innerText = p;

    const deps = await nx.dlCheckDeps();
    if (!deps.ytdlp || !deps.ffmpeg) {
      el('dlWarning').classList.remove('hidden');
    }

    // Register MediaSession handlers once
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => audioPlayer.play());
      navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
    }
  } catch (err) {
    console.error("Init Error:", err);
  }
}

// --- Save State Helper ---
let saveTimeout;
function requestSaveState() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    nx.saveState({ playlist, currentIdx, isShuffle, isLoop, autoNext: isAutoNext, volume: audioPlayer.volume });
  }, 500);
}

// --- Window & Theme Controls ---
el('closeBtn').onclick = () => nx.close();
el('maxBtn').onclick = () => nx.maximize();
el('minBtn').onclick = () => nx.minimize();
el('miniPlayerBtn').onclick = () => nx.toggleMiniPlayer();

el('themeBtn').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  if (theme === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  nx.setConfig('theme', theme);
};

// --- Mini Player Mode ---
nx.onMiniPlayerChanged((isMini) => {
  const mainApp = document.querySelector('.app-container');
  const miniApp = el('miniPlayerApp');
  
  if (isMini) {
    mainApp.classList.add('hidden');
    miniApp.classList.remove('hidden');
  } else {
    mainApp.classList.remove('hidden');
    miniApp.classList.add('hidden');
  }
});

// Mini Player Controls
el('miniBtnPrev').onclick = playPrev;
el('miniBtnNext').onclick = playNext;
el('miniBtnPlay').onclick = () => el('btnPlay').click();
el('miniBtnRestore').onclick = () => nx.toggleMiniPlayer();
el('miniBtnClose').onclick = () => nx.close();

// --- Tabs ---
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el(tabId).classList.add('active');
  const targetBtn = el('nav' + tabId.charAt(0).toUpperCase() + tabId.slice(1));
  if (targetBtn) targetBtn.classList.add('active');
}

el('navPlayer').onclick = () => switchTab('player');
el('navPlaylist').onclick = () => switchTab('playlist');
el('navDownloader').onclick = () => switchTab('downloader');
el('navSettings').onclick = () => switchTab('settings');

// --- Resizable Mini Queue ---
let isQueueOpen = true;
let currentQueueWidth = 256;
const qContainer = el('miniQueueContainer');
const toggleBtn = el('btnToggleQueue');
let qDragState = null;

function applyQueueWidth(newW) {
  const maxW = Math.max(0, Math.min(600, window.innerWidth - 80 - 320));
  newW = Math.max(0, Math.min(newW, maxW));
  qContainer.style.width = newW + 'px';
  currentQueueWidth = newW;
  const open = newW >= 50;
  el('miniQueueContent').style.opacity = open ? '1' : '0';
  el('toggleQueueIcon').className = 'ph-bold ' + (open ? 'ph-caret-left' : 'ph-caret-right');
  isQueueOpen = open;
}

toggleBtn.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  qDragState = { startX: e.clientX, startW: currentQueueWidth, pointerId: e.pointerId, moved: false };
  toggleBtn.setPointerCapture(e.pointerId);
  e.preventDefault();
});

toggleBtn.addEventListener('pointermove', (e) => {
  if (!qDragState || e.pointerId !== qDragState.pointerId) return;
  const dx = e.clientX - qDragState.startX;
  if (!qDragState.moved && Math.abs(dx) > 4) {
    qDragState.moved = true;
    qContainer.style.transition = 'none';
    document.body.style.cursor = 'col-resize';
  }
  if (qDragState.moved) applyQueueWidth(qDragState.startW + dx);
});

toggleBtn.addEventListener('pointerup', (e) => {
  if (!qDragState) return;
  const wasMoved = qDragState.moved;
  qDragState = null;
  document.body.style.cursor = 'default';
  qContainer.style.transition = 'width 0.3s ease';
  if (!wasMoved) {
    isQueueOpen = !isQueueOpen;
    applyQueueWidth(isQueueOpen ? (currentQueueWidth < 50 ? 256 : currentQueueWidth) : 0);
  }
});

toggleBtn.addEventListener('pointercancel', () => {
  if (!qDragState) return;
  qDragState = null;
  document.body.style.cursor = 'default';
  qContainer.style.transition = 'width 0.3s ease';
});


// --- Audio Engine ---
function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const getFilename = (path) => path.split(/[/\\]/).pop().replace(/\.(mp3|wav|flac|m4a|ogg|wma|aac|opus|webm)$/i, '');
const escapeHtml = (str) => {
  if (!str) return '';
  return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

audioPlayer.addEventListener('timeupdate', () => {
  if(isDraggingSlider || !audioPlayer.duration) return;
  const cur = audioPlayer.currentTime;
  const tot = audioPlayer.duration;
  el('currentTimeText').innerText = formatTime(cur);
  el('totalTimeText').innerText = formatTime(tot);
  const percent = (cur / tot) * 100;
  progBar.value = percent;
  progBar.style.setProperty('--val', `${percent}%`);
});

audioPlayer.addEventListener('ended', () => {
  if (isLoop) {
    audioPlayer.currentTime = 0;
    audioPlayer.play();
  } else if (isAutoNext) {
    playNext();
  } else {
    isPlaying = false;
    updatePlayPauseUI();
  }
});

let errorCount = 0;
audioPlayer.addEventListener('play', () => { 
  isPlaying = true; 
  errorCount = 0; 
  updatePlayPauseUI(); 
});
audioPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayPauseUI(); });
audioPlayer.addEventListener('error', (e) => {
  console.error("Audio playback error", e);
  errorCount++;
  showToast("Error: Cannot play track");
  if (errorCount > 5) {
    showToast("Too many playback errors, stopping.");
    isPlaying = false;
    updatePlayPauseUI();
    return;
  }
  if (isAutoNext && playlist.length > 1) {
    setTimeout(playNext, 1000);
  }
});

function updatePlayPauseUI() {
  el('fsPlayIcon').className = isPlaying ? 'ph-fill ph-pause text-2xl' : 'ph-fill ph-play text-2xl ml-[2px]';
  el('playTooltip').innerText = isPlaying ? 'Pause' : 'Play';
  
  el('miniPlayIcon').className = isPlaying ? 'ph-fill ph-pause text-lg ml-0.5' : 'ph-fill ph-play text-lg ml-0.5';

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
}

function updateControlStateUI() {
  el('btnShuffle').style.color = isShuffle ? '#0ea5e9' : '#94a3b8';
  el('btnLoop').style.color = isLoop ? '#0ea5e9' : '#94a3b8';
  el('btnAutoNext').style.color = isAutoNext ? '#0ea5e9' : '#94a3b8';
  el('autoNextTooltip').innerText = `Auto-Next: ${isAutoNext ? 'ON' : 'OFF'}`;
}

// --- Progress Bar Interaction ---
const progBar = el('progressBar');
// Add CSS for the progress bar blue fill
const style = document.createElement('style');
style.textContent = `
  .time-slider, .vol-slider-custom {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    outline: none;
    cursor: pointer;
    width: 100%;
  }
  
  .time-slider::-webkit-slider-runnable-track {
    height: 4px;
    background: linear-gradient(to right, #0ea5e9 var(--val, 0%), #cbd5e1 var(--val, 0%));
    border-radius: 99px;
  }
  .dark .time-slider::-webkit-slider-runnable-track {
    background: linear-gradient(to right, #0ea5e9 var(--val, 0%), #475569 var(--val, 0%));
  }
  
  .vol-slider-custom::-webkit-slider-runnable-track {
    height: 4px;
    background: linear-gradient(to right, #0ea5e9 var(--val, 100%), #cbd5e1 var(--val, 100%));
    border-radius: 99px;
  }
  .dark .vol-slider-custom::-webkit-slider-runnable-track {
    background: linear-gradient(to right, #0ea5e9 var(--val, 100%), #475569 var(--val, 100%));
  }

  .time-slider::-webkit-slider-thumb, .vol-slider-custom::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px; height: 12px;
    background: #0ea5e9;
    border-radius: 50%;
    margin-top: -4px; /* Centers thumb vertically on 4px track */
    box-shadow: 0 0 6px rgba(14, 165, 233, 0.5);
    transition: transform 0.2s;
  }
  .time-slider:hover::-webkit-slider-thumb, .vol-slider-custom:hover::-webkit-slider-thumb { 
    transform: scale(1.2); 
  }
`;
document.head.appendChild(style);

const volSlider = el('volSlider');
// Volume input listener is below in the Volume section

// Update initial vol slider CSS var
volSlider.style.setProperty('--val', `${volSlider.value}%`);

progBar.addEventListener('mousedown', () => isDraggingSlider = true);
progBar.addEventListener('input', () => {
  if (!audioPlayer.duration) return;
  const time = (progBar.value / 100) * audioPlayer.duration;
  el('currentTimeText').innerText = formatTime(time);
  progBar.style.setProperty('--val', `${progBar.value}%`);
});
progBar.addEventListener('change', () => {
  if (audioPlayer.duration) audioPlayer.currentTime = (progBar.value / 100) * audioPlayer.duration;
  isDraggingSlider = false;
});

// Fallback: ensure isDraggingSlider resets even if mouseup happens outside the slider
document.addEventListener('mouseup', () => { isDraggingSlider = false; });

const progCont = el('progressContainer');
const seekTooltip = el('seekTooltip');
progCont.addEventListener('mousemove', (e) => {
  if (!audioPlayer.duration) return;
  const rect = progCont.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekTooltip.style.left = `${pct * 100}%`;
  seekTooltip.innerText = formatTime(pct * audioPlayer.duration);
  seekTooltip.classList.remove('hidden');
});
progCont.addEventListener('mouseleave', () => seekTooltip.classList.add('hidden'));

// --- Player Controls ---
el('btnPlay').onclick = () => {
  if (!playlist.length) return;
  if (currentIdx === -1) playTrack(0);
  else if (isPlaying) audioPlayer.pause();
  else audioPlayer.play();
};

el('btnNext').onclick = playNext;
el('btnPrev').onclick = playPrev;

function playNext() {
  if (!playlist.length) return;
  if (isShuffle && playlist.length > 1) {
    let nextIdx;
    do { nextIdx = Math.floor(Math.random() * playlist.length); } while (nextIdx === currentIdx);
    playTrack(nextIdx);
  } else {
    playTrack((currentIdx + 1) % playlist.length);
  }
}

function playPrev() {
  if (!playlist.length) return;
  if (audioPlayer.currentTime > 3) audioPlayer.currentTime = 0;
  else playTrack((currentIdx - 1 + playlist.length) % playlist.length);
}

el('btnShuffle').onclick = () => { isShuffle = !isShuffle; updateControlStateUI(); requestSaveState(); };
el('btnLoop').onclick = () => { isLoop = !isLoop; updateControlStateUI(); requestSaveState(); };
el('btnAutoNext').onclick = () => { isAutoNext = !isAutoNext; updateControlStateUI(); requestSaveState(); };

// --- Volume ---
el('volSlider').addEventListener('input', (e) => {
  const vol = e.target.value / 100;
  audioPlayer.volume = vol;
  volSlider.style.setProperty('--val', `${volSlider.value}%`);
  
  if (vol === 0) {
    if (!isMuted) {
      isMuted = true;
      audioPlayer.muted = true;
      el('btnMute').classList.remove('text-slate-500', 'dark:text-slate-400');
      el('btnMute').classList.add('text-red-500', 'dark:text-red-500');
      el('muteIcon').className = 'ph-fill ph-speaker-slash text-lg';
    }
  } else {
    if (isMuted) {
      isMuted = false;
      audioPlayer.muted = false;
      el('btnMute').classList.remove('text-red-500', 'dark:text-red-500');
      el('btnMute').classList.add('text-slate-500', 'dark:text-slate-400');
    }
    updateVolIcon(vol);
  }
  
  requestSaveState();
  nx.setConfig('volume', vol);
});

let isMuted = false;
let preMuteVol = 1;

el('btnMute').onclick = () => {
  if (isMuted) {
    isMuted = false;
    audioPlayer.muted = false;
    if (preMuteVol === 0) preMuteVol = 0.5;
    audioPlayer.volume = preMuteVol;
    volSlider.value = preMuteVol * 100;
    el('btnMute').classList.remove('text-red-500', 'dark:text-red-500');
    el('btnMute').classList.add('text-slate-500', 'dark:text-slate-400');
    updateVolIcon(preMuteVol);
  } else {
    isMuted = true;
    preMuteVol = audioPlayer.volume || 1;
    audioPlayer.muted = true;
    volSlider.value = 0;
    el('btnMute').classList.remove('text-slate-500', 'dark:text-slate-400');
    el('btnMute').classList.add('text-red-500', 'dark:text-red-500');
    el('muteIcon').className = 'ph-fill ph-speaker-slash text-lg';
  }
  volSlider.style.setProperty('--val', `${volSlider.value}%`);
};

function updateVolIcon(vol) {
  const icon = el('muteIcon');
  if (isMuted) {
    icon.className = 'ph-fill ph-speaker-slash text-lg';
    return;
  }
  if (vol === 0) icon.className = 'ph-fill ph-speaker-x text-lg';
  else if (vol < 0.5) icon.className = 'ph-fill ph-speaker-low text-lg';
  else icon.className = 'ph-fill ph-speaker-high text-lg';
}

// --- Media Keys ---
nx.onMediaPlayPause(() => el('btnPlay').click());
nx.onMediaPause(() => audioPlayer.pause());
nx.onMediaNext(playNext);
nx.onMediaPrev(playPrev);

// --- Track Playing ---
async function loadTrackUI(idx, autoPlay = true) {
  const track = playlist[idx];
  if (!track) return;
  
  progBar.disabled = false;
  el('btnPlay').disabled = false;
  el('btnNext').disabled = false;
  el('btnPrev').disabled = false;
  
  
  if (!metadataCache.has(track.path)) {
    try {
      const m = await nx.extractMetadata(track.path);
      metadataCache.set(track.path, m);
      renderAllPlaylists();
    } catch (err) {
      console.error('Failed to extract metadata for', track.path, err);
    }
  }
  
  const meta = metadataCache.get(track.path);
  const title = meta.title || getFilename(track.path);
  const artist = meta.artist || 'Unknown Artist';
  
  el('fsTitle').innerText = title;
  el('fsArtist').innerText = artist;
  
  el('miniTitle').innerText = title;
  el('miniArtist').innerText = artist;
  
  if (meta.cover) {
    el('albumCover').src = meta.cover;
    el('albumCover').classList.remove('hidden');
    el('defaultCover').classList.add('hidden');
    
    el('miniCover').src = meta.cover;
    el('miniCover').classList.remove('hidden');
    el('miniDefaultCover').classList.add('hidden');
  } else {
    el('albumCover').classList.add('hidden');
    el('defaultCover').classList.remove('hidden');
    
    el('miniCover').classList.add('hidden');
    el('miniDefaultCover').classList.remove('hidden');
  }
  
  nx.notifySongChange({ title, artist, cover: meta.cover });
  nx.updateTray({ title, isPlaying: autoPlay });
}

function playTrack(idx) {
  if (!playlist.length || idx < 0 || idx >= playlist.length) return;
  currentIdx = idx;
  const track = playlist[idx];
  audioPlayer.src = pathToSafeURL(track.path);
  
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  audioPlayer.play().catch(e => {
    console.error(e);
    showToast(`Failed to play: ${getFilename(track.path)}`);
  });
  
  progBar.style.setProperty('--val', '0%');
  loadTrackUI(idx, true);
  requestSaveState();
  renderAllPlaylists();

  // Set basic MediaSession metadata from cache or filename fallback
  if ('mediaSession' in navigator) {
    const meta = metadataCache.get(track.path) || {};
    updateMediaSession(track, meta);
  }
}

let lastMediaSessionArtworkUrl = null;
async function updateMediaSession(track, meta) {
  if (!('mediaSession' in navigator)) return;
  let artwork = [];
  if (meta.cover) {
    try {
      let fetchUrl = meta.cover;
      if (fetchUrl.startsWith('file://')) {
        fetchUrl = pathToSafeURL(decodeURIComponent(fetchUrl.replace('file://', '')));
      }
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const blob = await res.blob();
        if (lastMediaSessionArtworkUrl) URL.revokeObjectURL(lastMediaSessionArtworkUrl);
        lastMediaSessionArtworkUrl = URL.createObjectURL(blob);
        artwork = [{ src: lastMediaSessionArtworkUrl, sizes: '512x512', type: 'image/jpeg' }];
      }
    } catch (e) {
      console.warn("Failed to set MediaSession artwork", e);
    }
  }
  
  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.title || getFilename(track.path),
    artist: meta.artist || 'Unknown Artist',
    album: meta.album || 'Unknown Album',
    artwork
  });
}

// --- Playlist Operations ---
function generateId() { return crypto.randomUUID(); }

async function addFiles(paths, autoplay = false) {
  if (!paths || !paths.length) return;
  
  // Deduplicate files
  const existingPaths = new Set(playlist.map(t => t.path));
  const newPaths = paths.filter(p => !existingPaths.has(p));
  
  if (newPaths.length === 0) return; // All files already exist
  
  const wasEmpty = playlist.length === 0;
  const firstNewIdx = playlist.length;
  
  newPaths.forEach(p => playlist.push({ id: generateId(), path: p }));
  renderAllPlaylists();
  requestSaveState();
  
  if (autoplay && (wasEmpty || autoplay === 'force')) {
    playTrack(wasEmpty ? 0 : firstNewIdx);
  }

  let renderTimeout;
  
  // Background metadata fetch
  for (const t of playlist) {
    if (!metadataCache.has(t.path)) {
      try {
        const meta = await nx.extractMetadata(t.path);
        metadataCache.set(t.path, meta);
      } catch (err) {
        console.error('Failed to extract metadata for', t.path, err);
        continue;
      }
      
      // Debounce rendering to prevent massive lag when loading many files
      clearTimeout(renderTimeout);
      renderTimeout = setTimeout(() => renderAllPlaylists(), 300);
    }
  }
}

el('btnAddFiles').onclick = async () => addFiles(await nx.openFiles(), true);
el('btnAddFolder').onclick = async () => addFiles(await nx.openFolder(), false);

el('btnClearPl').onclick = () => {
  playlist = [];
  currentIdx = -1;
  audioPlayer.pause();
  audioPlayer.src = '';
  el('fsTitle').innerText = 'No track playing';
  el('fsArtist').innerText = 'Ready to play';
  el('albumCover').classList.add('hidden');
  el('defaultCover').classList.remove('hidden');
  progBar.disabled = true;
  progBar.value = 0;
  el('currentTimeText').innerText = '00:00';
  el('totalTimeText').innerText = '00:00';
  nx.updateTray({ title: 'Nexus Audio', isPlaying: false });
  renderAllPlaylists();
  requestSaveState();
};

window.removeTrack = (idx, event, skipRender = false) => {
  if (event) event.stopPropagation();
  playlist.splice(idx, 1);
  if (currentIdx === idx) {
    currentIdx = -1;
    audioPlayer.pause();
    if (playlist.length) playNext();
    else el('btnClearPl').click();
  } else if (currentIdx > idx) {
    currentIdx--;
  }
  
  if (!skipRender) {
    renderAllPlaylists();
    requestSaveState();
  }
};

// --- Bulk Delete & Select ---
el('selectAll').onchange = (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.pl-check').forEach(cb => cb.checked = checked);
  updateDeleteBtn();
};

function updateDeleteBtn() {
  const checked = document.querySelectorAll('.pl-check:checked');
  if (checked.length > 0) {
    el('btnDeleteSelected').classList.remove('hidden');
    el('btnDeleteSelected').innerText = `Delete (${checked.length})`;
  } else {
    el('btnDeleteSelected').classList.add('hidden');
    el('selectAll').checked = false;
  }
}

el('btnDeleteSelected').onclick = () => {
  const checkboxes = document.querySelectorAll('.pl-check:checked');
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx)).sort((a,b) => b-a);
  indices.forEach(idx => removeTrack(idx, null, true));
  renderAllPlaylists();
  requestSaveState();
  el('selectAll').checked = false;
  updateDeleteBtn();
};

// --- Rendering Lists ---
let searchDebounceTimeout;
el('plSearch').addEventListener('input', () => {
  clearTimeout(searchDebounceTimeout);
  searchDebounceTimeout = setTimeout(renderAllPlaylists, 300);
});

function renderAllPlaylists() {
  const mainContainer = el('trackList');
  const miniContainer = el('miniQueueList');
  const query = el('plSearch').value.toLowerCase();

  miniContainer.innerHTML = '';
  mainContainer.innerHTML = '';

  if (!playlist.length) {
    mainContainer.innerHTML = '<div class="text-center text-slate-400 mt-20 text-sm flex flex-col items-center"><i class="ph-duotone ph-list-plus text-4xl mb-2 text-slate-300"></i>Queue is empty.</div>';
    miniContainer.innerHTML = '<div class="text-center text-slate-400 mt-10 text-xs italic">Queue is empty</div>';
    return;
  }

  playlist.forEach((item, idx) => {
    const meta = metadataCache.get(item.path) || {};
    const name = meta.title || getFilename(item.path);
    const artist = meta.artist || 'Unknown Artist';
    const isActive = (idx === currentIdx);

    // Mini Queue
    const mItem = document.createElement('div');
    mItem.className = `track-item flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${isActive ? 'bg-sky-100/60 dark:bg-sky-900/50 border border-sky-200 dark:border-sky-700' : 'hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent'}`;
    mItem.draggable = true;
    mItem.innerHTML = `
      <i class="ph-fill ${isActive ? 'ph-waveform text-sky-500 animate-pulse' : 'ph-music-note text-slate-400'} text-sm pointer-events-none"></i>
      <div class="flex flex-col flex-1 overflow-hidden pointer-events-none">
        <h4 class="font-semibold text-xs truncate ${isActive ? 'text-sky-700 dark:text-sky-300' : 'text-slate-600 dark:text-slate-300'}">${escapeHtml(name)}</h4>
        <span class="text-[10px] text-slate-400 truncate">${escapeHtml(artist)}</span>
      </div>
    `;
    mItem.onclick = () => playTrack(idx);
    attachDragHandlers(mItem, idx);
    miniContainer.appendChild(mItem);

    // Main Playlist (filtered)
    if (query && !name.toLowerCase().includes(query) && !artist.toLowerCase().includes(query)) return;

    const pItem = document.createElement('div');
    pItem.className = `track-item flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-300 border hover:-translate-y-0.5 hover:shadow-md ${isActive ? 'bg-sky-50/50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-800 shadow-sm' : 'bg-white dark:bg-slate-800 border-transparent hover:border-slate-200 dark:hover:border-slate-600'}`;
    pItem.draggable = true;
    
    const coverHtml = meta.cover ? `<img src="${meta.cover}" class="w-full h-full object-cover">` : `<i class="ph-fill ${isActive ? 'ph-waveform animate-pulse' : 'ph-music-note'} text-lg"></i>`;

    pItem.innerHTML = `
      <div class="flex items-center gap-4 overflow-hidden w-full">
        <i class="ph-bold ph-dots-six-vertical text-slate-300 hover:text-slate-500 cursor-grab text-xl"></i>
        <input type="checkbox" class="pl-check" data-idx="${idx}" onclick="event.stopPropagation()">
        <div class="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center shrink-0 ${isActive && !meta.cover ? 'bg-sky-500 text-white shadow-md shadow-sky-200' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}">
          ${coverHtml}
        </div>
        <div class="truncate flex-1 pointer-events-none">
          <h4 class="font-semibold text-sm truncate ${isActive ? 'text-sky-700 dark:text-sky-400' : 'text-slate-700 dark:text-slate-200'}">${escapeHtml(name)}</h4>
          <span class="text-xs text-slate-400 truncate">${escapeHtml(artist)}</span>
        </div>
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <span class="text-xs text-slate-400 font-mono">${formatTime(meta.duration)}</span>
        <button class="text-slate-300 hover:text-red-500 p-2 opacity-0 hover:opacity-100 transition"><i class="ph-bold ph-trash text-lg pointer-events-none"></i></button>
      </div>
    `;
    
    pItem.ondblclick = () => playTrack(idx);
    pItem.querySelector('button').onclick = (e) => removeTrack(idx, e);
    pItem.querySelector('.pl-check').onchange = updateDeleteBtn;
    
    attachDragHandlers(pItem, idx);
    mainContainer.appendChild(pItem);
  });
  updateDeleteBtn();
}

// --- Drag & Drop Reordering ---
let dragSrcIdx = null;
let dropPos = 'before';

function attachDragHandlers(el, idx) {
  el.ondragstart = (e) => {
    dragSrcIdx = idx;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  };
  el.ondragend = (e) => {
    el.classList.remove('dragging');
    document.querySelectorAll('.drop-before, .drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    dragSrcIdx = null;
  };
  el.ondragover = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = el.getBoundingClientRect();
    document.querySelectorAll('.drop-before, .drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    if (e.clientY < rect.top + rect.height / 2) {
      dropPos = 'before'; el.classList.add('drop-before');
    } else {
      dropPos = 'after'; el.classList.add('drop-after');
    }
  };
  el.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragSrcIdx === null || dragSrcIdx === idx) return;
    
    const item = playlist.splice(dragSrcIdx, 1)[0];
    let insertAt = idx;
    if (dragSrcIdx < idx) insertAt--;
    if (dropPos === 'after') insertAt++;
    insertAt = Math.max(0, Math.min(insertAt, playlist.length));
    
    playlist.splice(insertAt, 0, item);
    
    if (currentIdx === dragSrcIdx) {
      currentIdx = insertAt;
    } else {
      // Recalculate: after splice-out, indices shifted. After splice-in, shifted again.
      let newIdx = currentIdx;
      if (newIdx > dragSrcIdx) newIdx--;   // splice-out shifted down
      if (newIdx >= insertAt) newIdx++;    // splice-in shifted up
      currentIdx = newIdx;
    }
    
    renderAllPlaylists();
    requestSaveState();
  };
}

// --- Drag & Drop Files from OS ---
document.ondragover = (e) => {
  e.preventDefault();
  if (e.dataTransfer.types.includes('Files')) el('dropOverlay').classList.remove('hidden');
};
document.ondragleave = (e) => {
  if (e.relatedTarget === null) el('dropOverlay').classList.add('hidden');
};
document.ondrop = (e) => {
  e.preventDefault();
  el('dropOverlay').classList.add('hidden');
  const files = [];
  if (e.dataTransfer.items) {
    for (const item of e.dataTransfer.items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && file.path) files.push(file.path);
      }
    }
  }
  if (files.length) addFiles(files);
};

// --- Named Playlists ---
el('btnSavePl').onclick = async () => {
  if (!playlist.length) return;
  const name = prompt("Enter playlist name:");
  if (name) {
    await nx.saveNamedPlaylist(name, playlist);
    loadNamedPlaylists();
  }
};

async function loadNamedPlaylists() {
  const pls = await nx.getNamedPlaylists();
  const cont = el('namedPlaylists');
  cont.innerHTML = '';
  pls.forEach(pl => {
    const p = document.createElement('div');
    p.className = 'flex items-center gap-1 bg-sky-50 dark:bg-sky-900 border border-sky-100 dark:border-sky-800 text-sky-600 dark:text-sky-300 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer hover:bg-sky-100 dark:hover:bg-sky-800 transition whitespace-nowrap';
    p.innerHTML = `
      <i class="ph-fill ph-playlist"></i>
      <span>${escapeHtml(pl.name)}</span>
      <span class="bg-sky-100 dark:bg-sky-700 px-1.5 rounded-full text-[10px]">${pl.count}</span>
      <i class="ph-bold ph-x ml-1 hover:text-red-500 delete-btn" title="Delete"></i>
    `;
    p.onclick = async (e) => {
      if (e.target.classList.contains('delete-btn')) {
        await nx.deleteNamedPlaylist(pl.name);
        loadNamedPlaylists();
      } else {
        const loadedTracks = await nx.loadNamedPlaylist(pl.name);
        playlist = (loadedTracks || []).map(t => ({
          id: t.id || crypto.randomUUID(),
          path: t.path || t,
        }));
        currentIdx = -1;
        renderAllPlaylists();
        requestSaveState();
        if (playlist.length) playTrack(0);
      }
    };
    cont.appendChild(p);
  });
}

// --- Downloader ---
el('btnChangePath').onclick = async () => {
  const p = await nx.dlChangePath();
  if (p) el('btnChangePath').innerText = p;
};

el('dlFormat').onchange = () => {
  const f = el('dlFormat').value;
  el('dlQuality').style.display = (f === 'mp3' || f === 'm4a') ? 'block' : 'none';
};

el('btnDownload').onclick = () => {
  const input = el('dlInput').value.trim();
  if (!input) return;
  
  if (input.toLowerCase().includes('spotify.com')) {
    alert('Spotify URLs are not supported. Please use YouTube or YouTube Music links.');
    return;
  }

  const format = el('dlFormat').value;
  const quality = el('dlQuality').value;
  
  const urls = input.split(',').map(s => s.trim()).filter(Boolean);
  urls.forEach(u => {
    downloadQueue.push({ url: u, title: u, progress: 0, status: 'waiting' });
  });
  nx.dlStart({ urls, format, quality });
  renderDlQueue();
  el('dlInput').value = '';
};

let dlRenderTimeout;
function renderDlQueue() {
  clearTimeout(dlRenderTimeout);
  dlRenderTimeout = setTimeout(() => {
    const qContainer = el('dlQueue');
    qContainer.innerHTML = '';
    if (!downloadQueue.length) {
      qContainer.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 opacity-50"><i class="ph-bold ph-tray text-4xl mb-2"></i><p class="text-sm font-medium">No active downloads</p></div>`;
      return;
    }

    let html = '';
    downloadQueue.slice().reverse().forEach(item => {
      let statusColor = 'bg-slate-200 text-slate-500';
      if (item.status === 'downloading') statusColor = 'bg-sky-500 text-white';
      else if (item.status === 'complete') statusColor = 'bg-green-500 text-white';
      else if (item.status === 'error') statusColor = 'bg-red-500 text-white';

      html += `
        <div class="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg p-3 flex items-center gap-3 shadow-sm transition-all hover:shadow-md">
          <div class="w-12 h-12 rounded bg-slate-100 dark:bg-slate-700 overflow-hidden flex-shrink-0 flex items-center justify-center relative">
            ${item.cover ? `<img src="${item.cover}" class="w-full h-full object-cover">` : `<i class="ph-fill ph-music-note text-slate-300 dark:text-slate-500 text-xl"></i>`}
            ${item.status === 'downloading' ? `<div class="absolute inset-0 bg-black/20 flex items-center justify-center"><i class="ph-bold ph-spinner-gap text-white animate-spin"></i></div>` : ''}
          </div>
          <div class="flex-1 min-w-0 flex flex-col justify-center">
            <div class="flex justify-between items-start gap-2">
              <h4 class="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">${escapeHtml(item.title || item.url)}</h4>
              ${(item.status === 'downloading' || item.status === 'waiting') ? `<button onclick="nx.cancelDownload('${item.url}')" class="text-slate-400 hover:text-red-500 transition-colors" title="Cancel Download"><i class="ph-bold ph-x"></i></button>` : ''}
            </div>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${statusColor}">${item.status}</span>
              ${item.status === 'downloading' ? `<span class="text-xs text-sky-600 dark:text-sky-400 font-medium">${item.progress.toFixed(1)}%</span>` : ''}
            </div>
            ${item.status === 'downloading' ? `
              <div class="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full mt-2 overflow-hidden">
                <div class="h-full bg-sky-500 rounded-full transition-all duration-300" style="width: ${item.progress}%"></div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    });
    qContainer.innerHTML = html;
  }, 100); // Max 10 updates per second
};

nx.onDlProgress(({ url, percent, speed, eta }) => {
  const item = downloadQueue.find(i => i.url === url);
  if (item) {
    item.progress = parseFloat(percent) || 0;
    item.speed = speed;
    item.eta = eta;
    item.status = 'downloading';
    renderDlQueue();
  }
});

nx.onDlError(({ url }) => {
  const item = downloadQueue.find(i => i.url === url);
  if (item) {
    item.status = 'error';
    renderDlQueue();
  }
});

nx.onDlSuccess(({ url, filePath, metadata }) => {
  const item = downloadQueue.find(i => i.url === url);
  if (item) {
    item.status = 'complete';
    item.cover = metadata?.cover || null;
    item.title = metadata?.title || item.title;
    renderDlQueue();
  }
  
  // Auto-add downloaded file to playlist
  addFiles([filePath], false);
  showToast(`Download complete: ${item ? item.title : getFilename(filePath)}`);
});

// --- Toast Notifications ---
function showToast(msg) {
  let container = el('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'fixed bottom-24 right-5 z-50 flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'bg-slate-800 text-white dark:bg-white dark:text-slate-800 px-4 py-2 rounded shadow-lg text-sm transition-opacity duration-300 opacity-0';
  toast.innerText = msg;
  container.appendChild(toast);
  
  requestAnimationFrame(() => toast.classList.remove('opacity-0'));
  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// BUG-008 fix: Removed duplicate drag & drop handlers (block 1 at lines 775-795 handles this with overlay UX)

// --- Audio Visualizer & EQ ---
let audioCtx;
let analyser;
let source;
const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const filters = [];
let visualizerReq;

function initWebAudio() {
  if (audioCtx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContext();
  source = audioCtx.createMediaElementSource(audioPlayer);
  
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  
  let prevNode = source;
  
  // Create EQ bands
  const eqContainer = el('eqContainer');
  if (eqContainer) eqContainer.innerHTML = '';
  
  eqBands.forEach((freq, i) => {
    const filter = audioCtx.createBiquadFilter();
    filter.type = (i === 0) ? 'lowshelf' : (i === eqBands.length - 1) ? 'highshelf' : 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1;

    filters.push(filter);
    prevNode.connect(filter);
    prevNode = filter;

    // Create UI slider
    if (eqContainer) {
      const col = document.createElement('div');
      col.className = 'flex flex-col items-center h-full gap-2 w-10';
      
      const sliderVal = document.createElement('span');
      sliderVal.className = 'text-[10px] text-slate-500 font-mono w-full text-center truncate';
      sliderVal.innerText = '0dB';

      const sliderWrapper = document.createElement('div');
      sliderWrapper.className = 'relative flex-1 w-full flex justify-center py-2';
      
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = -12;
      slider.max = 12;
      slider.step = 0.5;
      slider.value = 0;
      // Make slider vertical
      slider.style.appearance = 'none';
      slider.style.width = '120px';
      slider.style.height = '4px';
      slider.style.background = '#cbd5e1';
      slider.style.borderRadius = '2px';
      slider.style.outline = 'none';
      slider.style.transform = 'rotate(-90deg)';
      slider.style.transformOrigin = 'center';
      slider.style.position = 'absolute';
      slider.style.top = '50%';
      slider.style.marginTop = '-2px';
      slider.style.cursor = 'pointer';

      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        filter.gain.value = val;
        sliderVal.innerText = (val > 0 ? '+' : '') + val + 'dB';
        // BUG-002 fix: Save all EQ gains as single object under 'eqGains' key
        const eqGains = {};
        filters.forEach((f, j) => { eqGains[eqBands[j]] = f.gain.value; });
        nx.setConfig('eqGains', eqGains);
        const presetSelect = el('eqPreset');
        if (presetSelect && presetSelect.value !== 'custom') {
          presetSelect.value = 'custom';
          nx.setConfig('eqPresetName', 'custom');
          const delBtn = el('btnDeletePreset');
          if (delBtn) delBtn.classList.add('hidden');
        }
      });

      // BUG-002 fix: Load saved gain from eqGains object
      nx.getConfig('eqGains').then(allGains => {
        const val = allGains?.[freq] ?? null;
        if (val !== null) {
          filter.gain.value = val;
          slider.value = val;
          sliderVal.innerText = (val > 0 ? '+' : '') + val + 'dB';
        }
      });

      const label = document.createElement('span');
      label.className = 'text-[10px] text-slate-600 dark:text-slate-400 font-bold';
      label.innerText = freq >= 1000 ? (freq/1000) + 'K' : freq;

      sliderWrapper.appendChild(slider);
      col.appendChild(sliderVal);
      col.appendChild(sliderWrapper);
      col.appendChild(label);
      eqContainer.appendChild(col);

      // Initial text update
      setTimeout(() => {
        sliderVal.innerText = (filter.gain.value > 0 ? '+' : '') + filter.gain.value + 'dB';
      }, 100);
    }
  });
  
  prevNode.connect(analyser);
  analyser.connect(audioCtx.destination);
  
  // Reset EQ logic
  const btnResetEQ = el('btnResetEQ');
  if (btnResetEQ) {
    btnResetEQ.onclick = () => {
      filters.forEach((f) => {
        f.gain.value = 0;
      });
      document.querySelectorAll('#eqContainer input[type=range]').forEach(s => {
        s.value = 0;
        const valSpan = s.parentElement.parentElement.querySelector('span.font-mono');
        if (valSpan) valSpan.innerText = '0dB';
      });
      // BUG-002 fix: Save reset EQ as single object
      const resetGains = {};
      eqBands.forEach(b => { resetGains[b] = 0; });
      nx.setConfig('eqGains', resetGains);
      const presetSelect = el('eqPreset');
      if (presetSelect) {
        presetSelect.value = 'flat';
        nx.setConfig('eqPresetName', 'flat');
        const delBtn = el('btnDeletePreset');
        if (delBtn) delBtn.classList.add('hidden');
      }
    };
  }

  // EQ Presets
  const defaultPresets = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass_boost: [6, 5, 4, 1, 0, 0, 0, 0, 0, 0],
    acoustic: [3, 4, 3, 1, 1, 1, 3, 3, 2, 2],
    classical: [3, 2, 1, 1, -1, -1, 0, 3, 4, 3],
    electronic: [5, 4, 1, -1, -2, 1, 3, 5, 4, 4],
    pop: [-1, 1, 3, 4, 3, 1, -1, -1, 1, 1],
    rock: [4, 3, -1, -2, -1, 2, 4, 5, 4, 4],
    vocal: [-1, -2, 0, 2, 4, 4, 2, 0, -1, -1]
  };
  let userPresets = {};

  const presetSelect = el('eqPreset');
  const btnSavePreset = el('btnSavePreset');
  const btnDeletePreset = el('btnDeletePreset');

  function updatePresetDropdown() {
    if (!presetSelect) return;
    const options = Array.from(presetSelect.options);
    options.forEach(opt => {
      if (opt.value.startsWith('user_')) presetSelect.removeChild(opt);
    });
    Object.keys(userPresets).forEach(p => {
      const opt = document.createElement('option');
      opt.value = `user_${p}`;
      opt.innerText = p;
      presetSelect.appendChild(opt);
    });
  }

  function applyPreset(p) {
    const isUser = p.startsWith('user_');
    const pName = isUser ? p.replace('user_', '') : p;
    const presetArr = isUser ? userPresets[pName] : defaultPresets[pName];
    
    if (presetArr) {
      const eqGains = {};
      filters.forEach((f, i) => {
        f.gain.value = presetArr[i];
        eqGains[eqBands[i]] = f.gain.value;
      });
      nx.setConfig('eqGains', eqGains);
      document.querySelectorAll('#eqContainer input[type=range]').forEach((s, i) => {
        s.value = presetArr[i];
        const sliderValSpan = s.parentElement.parentElement.querySelector('span.font-mono');
        if (sliderValSpan) sliderValSpan.innerText = (presetArr[i] > 0 ? '+' : '') + presetArr[i] + 'dB';
      });
      
      nx.setConfig('eqPresetName', p);
      if (btnDeletePreset) {
        if (isUser) btnDeletePreset.classList.remove('hidden');
        else btnDeletePreset.classList.add('hidden');
      }
    }
  }

  if (presetSelect) {
    presetSelect.onchange = (e) => {
      const p = e.target.value;
      if (p === 'custom') {
        nx.setConfig('eqPresetName', 'custom');
        if (btnDeletePreset) btnDeletePreset.classList.add('hidden');
      } else {
        applyPreset(p);
      }
    };
  }

  Promise.all([
    nx.getConfig('userEqPresets'),
    nx.getConfig('eqPresetName')
  ]).then(([uPresets, activeName]) => {
    if (uPresets) userPresets = uPresets;
    updatePresetDropdown();
    
    if (activeName) {
      presetSelect.value = activeName;
      if (btnDeletePreset) {
        if (activeName.startsWith('user_')) btnDeletePreset.classList.remove('hidden');
        else btnDeletePreset.classList.add('hidden');
      }
    }
  });

  const modal = el('presetPromptModal');
  const input = el('presetNameInput');
  const btnCancel = el('btnCancelPreset');
  const btnConfirm = el('btnConfirmPreset');

  if (btnSavePreset && modal) {
    btnSavePreset.onclick = () => {
      input.value = '';
      modal.classList.remove('hidden');
      setTimeout(() => input.focus(), 50);
    };

    const closeModal = () => {
      modal.classList.add('hidden');
    };

    btnCancel.onclick = closeModal;
    
    const savePreset = () => {
      const name = input.value;
      if (!name || name.trim() === "") return;
      const arr = filters.map(f => f.gain.value);
      userPresets[name.trim()] = arr;
      nx.setConfig('userEqPresets', userPresets);
      updatePresetDropdown();
      presetSelect.value = `user_${name.trim()}`;
      nx.setConfig('eqPresetName', `user_${name.trim()}`);
      if (btnDeletePreset) btnDeletePreset.classList.remove('hidden');
      showToast(`Saved preset: ${name}`);
      closeModal();
    };

    btnConfirm.onclick = savePreset;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') savePreset();
      if (e.key === 'Escape') closeModal();
    };
  }

  if (btnDeletePreset) {
    btnDeletePreset.onclick = () => {
      const p = presetSelect.value;
      if (p.startsWith('user_')) {
        const pName = p.replace('user_', '');
        if (confirm(`Delete preset "${pName}"?`)) {
          delete userPresets[pName];
          nx.setConfig('userEqPresets', userPresets);
          updatePresetDropdown();
          presetSelect.value = 'custom';
          nx.setConfig('eqPresetName', 'custom');
          btnDeletePreset.classList.add('hidden');
          showToast(`Deleted preset: ${pName}`);
        }
      }
    };
  }

  drawVisualizer();
}

function drawVisualizer() {
  if (!analyser) return;
  const canvas = el('visualizerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function renderFrame() {
    if (audioPlayer.paused) {
      visualizerReq = null;
      return; // Stop rendering to save CPU/GPU when paused
    }

    visualizerReq = requestAnimationFrame(renderFrame);
    
    // Only render if Player tab is active to save resources
    if (!el('player').classList.contains('active')) return;

    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i];

      // Use sky blue color with dynamic opacity
      const opacity = barHeight / 255;
      const r = theme === 'dark' ? 56 : 14;
      const g = theme === 'dark' ? 189 : 165;
      const b = theme === 'dark' ? 248 : 233;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
      
      const h = (barHeight / 255) * canvas.height;
      ctx.fillRect(x, canvas.height - h, barWidth, h);

      x += barWidth + 1;
    }
  }
  
  if (!audioPlayer.paused) {
    renderFrame();
  }
  
  audioPlayer.addEventListener('play', () => {
    if (!visualizerReq) renderFrame();
  });
}

initWebAudio();
init();

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;

  switch(e.code) {
    case 'Space':
      e.preventDefault();
      const playBtn = document.getElementById('btnPlay');
      if (playBtn) playBtn.click();
      break;
    case 'ArrowUp':
      e.preventDefault();
      const vsUp = el('volSlider');
      if(vsUp) {
        vsUp.value = Math.min(100, parseInt(vsUp.value) + 5);
        vsUp.dispatchEvent(new Event('input'));
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      const vsDown = el('volSlider');
      if(vsDown) {
        vsDown.value = Math.max(0, parseInt(vsDown.value) - 5);
        vsDown.dispatchEvent(new Event('input'));
      }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (typeof audioPlayer !== 'undefined' && audioPlayer) {
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5);
      }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (typeof audioPlayer !== 'undefined' && audioPlayer && audioPlayer.duration) {
        audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5);
      }
      break;
  }
});