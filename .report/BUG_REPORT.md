# 🐛 Nexus Audio — Bug Report & Fix Recommendations

> **Project:** Nexus Audio v2.0.0  
> **Report Date:** 2026-06-11  
> **Analyzed Files:** `app.js`, `renderer.js`, `preload.js`, `index.html`, `styles.css`, `package.json`

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 5 |
| 🟡 Medium | 7 |
| 🔵 Low | 4 |
| **Total** | **19** |

---

## 🔴 Critical Bugs

### BUG-001: `webSecurity: false` — เปิดช่องโหว่ความปลอดภัยร้ายแรง

**File:** [app.js](file:///home/punyapat/Documents/nexus-audio/app.js#L211)  
**Line:** 211  

```javascript
webSecurity: false, // จำเป็นสำหรับ file:// audio playback
```

**Problem:** การตั้งค่า `webSecurity: false` ปิดการป้องกัน Same-Origin Policy ทั้งหมด ทำให้ renderer process สามารถเข้าถึง local filesystem, network requests ข้าม origin และอื่นๆ ได้อย่างอิสระ ซึ่งหาก content ที่โหลดมา (เช่น cover art, external content) มี malicious code จะสามารถ exploit ได้ทันที

**Impact:** ช่องโหว่ระดับ Remote Code Execution (RCE) ผ่าน renderer

**Fix:**
```diff
- webSecurity: false, // จำเป็นสำหรับ file:// audio playback
+ webSecurity: true,
```

ใช้ `protocol.registerFileProtocol()` หรือ `protocol.handle()` แทนเพื่อ serve local files อย่างปลอดภัย:

```javascript
const { protocol } = require('electron');

app.whenReady().then(() => {
  protocol.handle('nexus-audio', (request) => {
    const filePath = request.url.replace('nexus-audio://', '');
    return net.fetch(`file://${decodeURIComponent(filePath)}`);
  });
});
```

---

### BUG-002: EQ Config Keys ถูก Block โดย Whitelist (ค่า EQ ไม่ถูกบันทึก)

**File:** [app.js](file:///home/punyapat/Documents/nexus-audio/app.js#L56) ↔ [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L1055)  
**Lines:** app.js:56, renderer.js:1055  

```javascript
// app.js:56
const ALLOWED_CONFIG_KEYS = ['theme', 'dlPath', 'volume', 'lastFolder', 'windowBounds', 'eqGains', 'autoNext'];

// renderer.js:1055 — ใช้ key แบบ dynamic ที่ไม่ตรงกับ whitelist
nx.setConfig(`eq_${freq}`, val);  // → key เช่น "eq_32", "eq_64" ฯลฯ
```

**Problem:** Renderer พยายาม save EQ gains ด้วย key เช่น `eq_32`, `eq_64`, `eq_125` ฯลฯ แต่ whitelist ใน `ALLOWED_CONFIG_KEYS` อนุญาตเฉพาะ `eqGains` ทำให้ **ค่า EQ ทั้งหมดไม่ถูกบันทึก** เมื่อ restart แอป ค่า EQ จะกลับเป็น 0 ทุกครั้ง

**Impact:** ผู้ใช้ตั้งค่า EQ แล้ว restart แอป ค่าหายทุกครั้ง — UX เสียมาก

**Fix — Option A (Recommended): รวม EQ เป็น object เดียว**

```diff
// renderer.js — เปลี่ยนจาก save ทีละ band เป็น save เป็น object
- nx.setConfig(`eq_${freq}`, val);
+ // Save all EQ gains as a single object
+ const eqGains = {};
+ filters.forEach((f, i) => { eqGains[eqBands[i]] = f.gain.value; });
+ nx.setConfig('eqGains', eqGains);
```

```diff
// renderer.js — โหลดค่า EQ กลับมา
- nx.getConfig(`eq_${freq}`).then(val => {
+ nx.getConfig('eqGains').then(allGains => {
+   const val = allGains?.[freq] ?? null;
    if (val !== null) {
      filter.gain.value = val;
      slider.value = val;
      sliderVal.innerText = (val > 0 ? '+' : '') + val + 'dB';
    }
  });
```

**Fix — Option B: เพิ่ม EQ keys เข้า whitelist**

```diff
- const ALLOWED_CONFIG_KEYS = ['theme', 'dlPath', 'volume', 'lastFolder', 'windowBounds', 'eqGains', 'autoNext'];
+ const ALLOWED_CONFIG_KEYS = ['theme', 'dlPath', 'volume', 'lastFolder', 'windowBounds', 'eqGains', 'autoNext',
+   'eq_32', 'eq_64', 'eq_125', 'eq_250', 'eq_500', 'eq_1000', 'eq_2000', 'eq_4000', 'eq_8000', 'eq_16000'];
```

---

### BUG-003: Download ส่งแต่ละ URL เป็น batch แยก — ข้าม Concurrency Guard

**File:** [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L859-L863)  
**Lines:** 859-863

```javascript
const urls = input.split(',').map(s => s.trim()).filter(Boolean);
urls.forEach(url => {
  downloadQueue.push({ url, title: url, progress: 0, status: 'waiting' });
  nx.dlStart({ urls: [url], format, quality });  // ⚠️ ส่งทีละ URL
});
```

**Problem:** แม้ app.js จะมี guard `isDownloading` เพื่อป้องกัน concurrent batch downloads (B7) แต่ renderer กลับส่ง `dl:start` ทีละ URL → batch แรกจะ set `isDownloading = true` → batch ที่ 2, 3, ... จะถูก reject ทันทีพร้อม error "A download batch is already in progress"

ผลลัพธ์: ถ้าผู้ใช้ใส่ URL หลายตัวคั่นด้วยจุลภาค **จะ download ได้แค่ตัวแรก** ที่เหลือ error หมด

**Fix:**
```diff
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
-   urls.forEach(url => {
-     downloadQueue.push({ url, title: url, progress: 0, status: 'waiting' });
-     nx.dlStart({ urls: [url], format, quality });
-   });
+   urls.forEach(url => {
+     downloadQueue.push({ url, title: url, progress: 0, status: 'waiting' });
+   });
+   nx.dlStart({ urls, format, quality });  // ส่งทั้งหมดเป็น batch เดียว
    renderDlQueue();
    el('dlInput').value = '';
  };
```

---

## 🟠 High Bugs

### BUG-004: Notification cover ใช้ `nativeImage.createFromDataURL()` กับ `file://` URL

**File:** [app.js](file:///home/punyapat/Documents/nexus-audio/app.js#L442)  
**Line:** 442

```javascript
const iconImage = cover ? nativeImage.createFromDataURL(cover) : ICON_PATH;
```

**Problem:** `cover` ที่ส่งมาจาก renderer คือ `file:///...` URL (จาก `url.pathToFileURL()` ที่ line 165) แต่ `nativeImage.createFromDataURL()` คาดหวัง Data URL (เช่น `data:image/png;base64,...`) → ทำให้ Notification icon crash เสมอเมื่อมี cover art

**Fix:**
```diff
- const iconImage = cover ? nativeImage.createFromDataURL(cover) : ICON_PATH;
+ let iconImage = ICON_PATH;
+ if (cover) {
+   if (cover.startsWith('data:')) {
+     iconImage = nativeImage.createFromDataURL(cover);
+   } else if (cover.startsWith('file://')) {
+     const coverPath = url.fileURLToPath(cover);
+     iconImage = nativeImage.createFromPath(coverPath);
+   }
+ }
```

---

### BUG-005: `file://` path ไม่ encode อักขระพิเศษ — เพลงที่มี `#`, `%`, `?` ในชื่อเล่นไม่ได้

**File:** [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L49)  
**Line:** 49, 511

```javascript
audioPlayer.src = `file://${playlist[currentIdx].path}`;  // line 49
audioPlayer.src = `file://${track.path}`;                 // line 511
```

**Problem:** ถ้าชื่อไฟล์มีอักขระพิเศษ เช่น `My Song #1.mp3` หรือ `100% Love.flac` จะถูกตีความผิดเป็น URL fragment/query → Audio ไม่ load

**Fix:**
```diff
- audioPlayer.src = `file://${track.path}`;
+ // Encode special characters in file path
+ audioPlayer.src = 'file://' + encodeURI(track.path).replace(/#/g, '%23').replace(/\?/g, '%3F');
```

หรือใช้ฟังก์ชัน helper:
```javascript
function filePathToURL(filePath) {
  return 'file://' + filePath.split('/').map(encodeURIComponent).join('/');
}
```

---

### BUG-006: Drag & Drop reorder คำนวณ `currentIdx` ผิดในบางกรณี

**File:** [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L758-L767)  
**Lines:** 758-767

```javascript
const item = playlist.splice(dragSrcIdx, 1)[0];
let insertAt = idx;
if (dragSrcIdx < idx) insertAt--;
if (dropPos === 'after') insertAt++;

playlist.splice(Math.max(0, Math.min(insertAt, playlist.length)), 0, item);

if (currentIdx === dragSrcIdx) currentIdx = insertAt;
else if (currentIdx > dragSrcIdx && currentIdx <= insertAt) currentIdx--;
else if (currentIdx < dragSrcIdx && currentIdx >= insertAt) currentIdx++;
```

**Problem:** เมื่อ `dropPos === 'after'` และ `dragSrcIdx < idx` จะได้ `insertAt = idx - 1 + 1 = idx` ซึ่งอาจจะถูกในบางกรณี แต่การคำนวณ `currentIdx` ที่ตามมาไม่ได้คำนึงถึง clamping ที่ `Math.max(0, Math.min(...))` — ถ้า `insertAt` ถูก clamp ค่าจริงจะต่างจากที่ใช้คำนวณ `currentIdx`

**Fix:**
```diff
+ insertAt = Math.max(0, Math.min(insertAt, playlist.length));
  playlist.splice(insertAt, 0, item);

  if (currentIdx === dragSrcIdx) currentIdx = insertAt;
- else if (currentIdx > dragSrcIdx && currentIdx <= insertAt) currentIdx--;
- else if (currentIdx < dragSrcIdx && currentIdx >= insertAt) currentIdx++;
+ else {
+   // Recalculate: after splice-out, indices shifted. After splice-in, shifted again.
+   let newIdx = currentIdx;
+   if (newIdx > dragSrcIdx) newIdx--;           // splice-out shifted down
+   if (newIdx >= insertAt) newIdx++;             // splice-in shifted up
+   currentIdx = newIdx;
+ }
```

---

### BUG-007: `getFilename()` ไม่ครอบคลุมทุกนามสกุลเสียง

**File:** [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L218)  
**Line:** 218

```javascript
const getFilename = (path) => path.split(/[/\\]/).pop().replace(/\.(mp3|wav|flac|m4a|ogg)$/i, '');
```

**Problem:** Regex ไม่ครอบคลุมนามสกุล `.wma`, `.aac`, `.opus`, `.webm` ที่ app.js กำหนดไว้ใน `AUDIO_EXTENSIONS` → ชื่อเพลงจะแสดงรวมนามสกุลไฟล์ เช่น `MySong.opus` แทนที่จะเป็น `MySong`

**Fix:**
```diff
- const getFilename = (path) => path.split(/[/\\]/).pop().replace(/\.(mp3|wav|flac|m4a|ogg)$/i, '');
+ const getFilename = (path) => path.split(/[/\\]/).pop().replace(/\.(mp3|wav|flac|m4a|ogg|wma|aac|opus|webm)$/i, '');
```

---

### BUG-008: Duplicate Drag & Drop handlers — OS file drop ถูก intercept สองครั้ง

**File:** [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L775-L795) ↔ [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L968-L984)  
**Lines:** 775-795 (block 1), 968-984 (block 2)

**Problem:** มี drag & drop handlers ซ้ำ 2 ชุด:
- **Block 1** (line 775): `document.ondragover`, `document.ondragleave`, `document.ondrop` — จัดการ overlay + add files
- **Block 2** (line 968): `document.addEventListener('dragover')`, `document.addEventListener('drop')` — add files อีกครั้ง

เมื่อ drop ไฟล์จาก OS จะทำงาน **ทั้ง 2 handlers** → `addFiles()` ถูกเรียก 2 ครั้ง → แม้ว่า deduplicate จะป้องกันไว้ แต่ทำให้ toast แสดงซ้ำ และมี unnecessary processing

**Fix:** ลบ block ที่ 2 (line 968-984) ออก เนื่องจาก block ที่ 1 ครอบคลุมอยู่แล้วและมี overlay UX ที่ดีกว่า

```diff
- // --- Drag and Drop ---
- document.addEventListener('dragover', (e) => {
-   e.preventDefault();
-   e.stopPropagation();
- });
-
- document.addEventListener('drop', (e) => {
-   e.preventDefault();
-   e.stopPropagation();
-   if (e.dataTransfer && e.dataTransfer.files.length > 0) {
-     const paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(p => p);
-     if (paths.length > 0) {
-       addFiles(paths, false);
-       showToast(`Added ${paths.length} items from drag & drop`);
-     }
-   }
- });
```

---

## 🟡 Medium Bugs

### BUG-009: `styles.css` ไม่ถูกโหลด — ไม่มี `<link>` ใน `index.html`

**File:** [index.html](file:///home/punyapat/Documents/nexus-audio/index.html)  

**Problem:** ไฟล์ `styles.css` มีขนาด 28KB และมี CSS variables + component styles จำนวนมาก แต่ไม่มี `<link rel="stylesheet" href="styles.css">` ใน `index.html` → CSS ทั้งหมดใน `styles.css` ไม่ถูกใช้งาน แอปใช้ TailwindCSS CDN + inline `<style>` ใน HTML แทน

**Impact:** ไฟล์ `styles.css` กลายเป็น dead code ขนาด 28KB ที่ถูกรวมใน build แต่ไม่เคยถูกโหลด

**Fix:**

ถ้าต้องการใช้ `styles.css`:
```diff
  <head>
    ...
+   <link rel="stylesheet" href="styles.css">
  </head>
```

ถ้าไม่ต้องการ ควรลบ `styles.css` ออกจาก `package.json` build files ด้วย

---

### BUG-010: Visualizer ไม่ render สีต่างกันระหว่าง dark/light theme

**File:** [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L1170-L1172)  
**Lines:** 1170-1172

```javascript
const r = theme === 'dark' ? 14 : 14;
const g = theme === 'dark' ? 165 : 165;
const b = theme === 'dark' ? 233 : 233;
```

**Problem:** ternary operator ให้ค่าเหมือนกันทั้ง true/false → สีเหมือนกันทุก theme → code นี้ไม่มีประโยชน์

**Fix:** ลบ ternary ออก หรือกำหนดสีที่ต่างกัน:
```diff
- const r = theme === 'dark' ? 14 : 14;
- const g = theme === 'dark' ? 165 : 165;
- const b = theme === 'dark' ? 233 : 233;
+ // Sky blue for both themes (intentionally same for now)
+ const r = 14, g = 165, b = 233;
```

หรือถ้าต้องการสีต่างกันจริงๆ:
```javascript
const r = theme === 'dark' ? 56 : 14;    // dark: #38bdf8, light: #0ea5e9
const g = theme === 'dark' ? 189 : 165;
const b = theme === 'dark' ? 248 : 233;
```

---

### BUG-011: Volume ไม่ถูกบันทึกผ่าน config แยก — บันทึกแค่ใน playlist state

**File:** [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L33-L34)  
**Line:** 33

```javascript
audioPlayer.volume = await nx.getConfig('volume') ?? 1;
```

**Problem:** Init โหลด volume จาก config (`nx.getConfig('volume')`) แต่ไม่เคยเรียก `nx.setConfig('volume', ...)` ตอน save → ค่า volume จะไม่ถูกบันทึกลง config ถ้าไม่เคยเรียก `setConfig('volume', ...)` จากที่อื่น  

Volume ถูก save ไว้ใน playlist state (line 102) แต่ init ไม่ได้อ่านจาก playlist state → ค่า volume อาจหายเมื่อไม่มี playlist state

**Fix:** เพิ่มการ save volume ลง config เมื่อเปลี่ยน:
```diff
  el('volSlider').addEventListener('input', (e) => {
    const vol = e.target.value / 100;
    audioPlayer.volume = vol;
    ...
    requestSaveState();
+   nx.setConfig('volume', vol);
  });
```

---

### BUG-012: `loadNamedPlaylist` คืนค่า raw tracks — ไม่มี `id` field

**File:** [renderer.js](file:///home/punyapat/Documents/nexus-audio/renderer.js#L825)  
**Line:** 825

```javascript
playlist = await nx.loadNamedPlaylist(pl.name);
```

**Problem:** เมื่อ save named playlist ที่ line 802 จะ save `playlist` array ที่มี `{ id, path }` แต่ถ้า playlist ถูก save ก่อนมี `id` field (เช่น migrate จาก version เก่า) หรือ JSON ถูก edit ด้วยมือ ก็จะไม่มี `id` → `generateId()` ไม่ถูกเรียก → drag-and-drop อาจทำงานผิดปกติ

**Fix:**
```diff
- playlist = await nx.loadNamedPlaylist(pl.name);
+ const loadedTracks = await nx.loadNamedPlaylist(pl.name);
+ playlist = (loadedTracks || []).map(t => ({
+   id: t.id || crypto.randomUUID(),
+   path: t.path || t,  // support legacy format (array of strings)
+ }));
```

---

### BUG-013: `minWidth` ไม่ตรงกัน — Mini player กลับ normal mode ใช้ค่าผิด

**File:** [app.js](file:///home/punyapat/Documents/nexus-audio/app.js#L200) ↔ [app.js](file:///home/punyapat/Documents/nexus-audio/app.js#L382)  
**Lines:** 200, 382

```javascript
// Line 200: window creation
minWidth: 850,

// Line 382: restore from mini player
win.setMinimumSize(700, 450);
```

**Problem:** Window สร้างด้วย `minWidth: 850` แต่เมื่อกลับจาก mini player ตั้ง `minWidth: 700` ทำให้ window สามารถย่อเล็กกว่าที่ design รองรับ

**Fix:**
```diff
- win.setMinimumSize(700, 450);
+ win.setMinimumSize(850, 450);
```

---

### BUG-014: `dl:error` event ไม่มี `message` ทุกกรณี

**File:** [app.js](file:///home/punyapat/Documents/nexus-audio/app.js#L787)  
**Line:** 787

```javascript
win?.webContents.send('dl:error', { url });
```

**Problem:** เมื่อ download process exit ด้วย code ≠ 0 จะส่ง `dl:error` โดยไม่มี `message` field → renderer ไม่สามารถแสดง error message ที่เป็นประโยชน์ได้

**Fix:**
```diff
- win?.webContents.send('dl:error', { url });
+ win?.webContents.send('dl:error', { url, message: `Download failed with exit code ${code}` });
```

---

### BUG-015: `saveConfig()` return value ถูก ignore ใน `dl:change-path`

**File:** [app.js](file:///home/punyapat/Documents/nexus-audio/app.js#L584)  
**Line:** 584

```javascript
saveConfig();  // async function — promise not awaited
```

**Problem:** `saveConfig()` เป็น async function แต่ไม่ได้ await → ถ้า app crash ก่อน write เสร็จ config จะหาย

**Fix:**
```diff
- saveConfig();
+ await saveConfig();
```

> [!NOTE]
> ปัญหานี้ยังเกิดที่ [app.js:249](file:///home/punyapat/Documents/nexus-audio/app.js#L249) และ [app.js:824](file:///home/punyapat/Documents/nexus-audio/app.js#L824) ด้วย

---

## 🔵 Low Bugs

### BUG-016: `dl:start` IPC handler return Promise ใน `ipcMain.on` — ไม่มีผลอะไร

**File:** [app.js](file:///home/punyapat/Documents/nexus-audio/app.js#L614)  
**Line:** 614

```javascript
ipcMain.on('dl:start', async (_event, { urls, format, quality }) => {
  ...
  return new Promise((resolve) => {  // ⚠️ return ใน ipcMain.on ไม่มีผล
```

**Problem:** `ipcMain.on()` ไม่ support return value (ต่างจาก `ipcMain.handle()`) → `return new Promise(...)` ไม่มีผลใดๆ ไม่ใช่ bug ร้ายแรงเพราะ logic ยังทำงานถูก แต่เป็น dead code pattern

**Fix:** เปลี่ยนเป็น IIFE หรือลบ return:
```diff
- return new Promise((resolve) => {
+ new Promise((resolve) => {
```

---

### BUG-017: CDN Dependency — TailwindCSS CDN ใน production

**File:** [index.html](file:///home/punyapat/Documents/nexus-audio/index.html#L8)  
**Line:** 8

```html
<script src="https://cdn.tailwindcss.com"></script>
```

**Problem:** ใช้ TailwindCSS CDN (runtime compilation) ใน production Electron app:
1. ต้องการ internet เพื่อ load TailwindCSS ครั้งแรก (จะ cache หลังจากนั้น)
2. Runtime CSS compilation ช้ากว่า pre-compiled CSS
3. CDN อาจ down หรือเปลี่ยน version

**Fix:** ติดตั้ง TailwindCSS เป็น dev dependency และ build CSS ก่อน package:
```bash
npm install -D tailwindcss
npx tailwindcss -i ./src/input.css -o ./styles-compiled.css --minify
```

---

### BUG-018: Phosphor Icons CDN dependency

**File:** [index.html](file:///home/punyapat/Documents/nexus-audio/index.html#L7)  
**Line:** 7

```html
<script src="https://unpkg.com/@phosphor-icons/web"></script>
```

**Problem:** เช่นเดียวกับ BUG-017 — icon library โหลดจาก CDN ภายนอก

**Fix:** ติดตั้งเป็น local dependency:
```bash
npm install @phosphor-icons/web
```
แล้วโหลดจาก `node_modules`:
```html
<script src="./node_modules/@phosphor-icons/web/src/regular/index.js"></script>
```

---

### BUG-019: Google Fonts โหลดจากอินเทอร์เน็ต — ซ้ำ 2 ที่

**File:** [index.html](file:///home/punyapat/Documents/nexus-audio/index.html#L15) ↔ [styles.css](file:///home/punyapat/Documents/nexus-audio/styles.css#L5)  
**Lines:** index.html:15, styles.css:5

```css
/* ใน index.html <style> */
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700&display=swap');

/* ใน styles.css */
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
```

**Problem:** 
1. Import font ซ้ำ 2 ครั้งจาก 2 ไฟล์ (แม้ว่า styles.css ไม่ถูกโหลด — ดู BUG-009)
2. ต้องการ internet connection
3. Font weight ไม่ตรงกัน (index.html ขาด weight 600)

**Fix:** Self-host font หรือรวมเป็นที่เดียว:
```bash
# Download and bundle font files
mkdir -p fonts
# Copy .woff2 files to fonts/
```

---

## Priority Matrix

```mermaid
quadrantChart
    title Bug Priority vs Effort
    x-axis Easy --> Hard
    y-axis Low Priority --> High Priority
    quadrant-1 Do First
    quadrant-2 Plan Carefully
    quadrant-3 Quick Wins
    quadrant-4 Defer
    BUG-002 EQ Config: [0.3, 0.95]
    BUG-003 Download Batch: [0.25, 0.9]
    BUG-004 Notification: [0.35, 0.75]
    BUG-005 File Path: [0.3, 0.8]
    BUG-001 webSecurity: [0.7, 1.0]
    BUG-007 getFilename: [0.1, 0.6]
    BUG-008 Dup DnD: [0.1, 0.65]
    BUG-010 Visualizer: [0.1, 0.4]
    BUG-013 minWidth: [0.1, 0.5]
    BUG-006 DnD Reorder: [0.55, 0.7]
    BUG-009 CSS unused: [0.15, 0.45]
    BUG-011 Volume: [0.2, 0.55]
    BUG-014 dl error msg: [0.1, 0.5]
    BUG-017 TailwindCDN: [0.6, 0.3]
```

---

## Recommended Fix Order

| Priority | Bug IDs | Description |
|----------|---------|-------------|
| 1️⃣ | BUG-002, BUG-003 | แก้ EQ ไม่ save + download batch ใช้ไม่ได้ (User-facing, Easy fix) |
| 2️⃣ | BUG-004, BUG-005 | แก้ Notification crash + ไฟล์ชื่อพิเศษเล่นไม่ได้ |
| 3️⃣ | BUG-007, BUG-008, BUG-013, BUG-014 | Quick wins — ใช้เวลาน้อย แก้ได้เร็ว |
| 4️⃣ | BUG-001 | webSecurity — ต้องใช้ custom protocol, ใช้เวลามากกว่า |
| 5️⃣ | BUG-006, BUG-009, BUG-010, BUG-011, BUG-012 | Medium priority fixes |
| 6️⃣ | BUG-015, BUG-016, BUG-017, BUG-018, BUG-019 | Low priority / architecture improvements |

---

> [!IMPORTANT]
> BUG-002 (EQ ไม่ save) และ BUG-003 (Download batch) เป็นบัคที่ผู้ใช้จะเจอบ่อยที่สุดและกระทบ UX โดยตรง แนะนำให้แก้ก่อนเป็นอันดับแรก

> [!WARNING]
> BUG-001 (`webSecurity: false`) เป็นช่องโหว่ความปลอดภัยระดับ Critical ที่ควรแก้ก่อน release ใดๆ แม้จะต้องใช้เวลาในการ implement custom protocol

##เพิ้มเติม
ให้ติดตั้งtailwindcssพร้อมตอนติดตั้งแอปเลยเพื่อแก้ปัญหาหากไม่มีเน็ตจะใช้งานไม่ได้ ทำให้แอปเป็นการใช้งานแบบออฟไลน์ทั้งหมด100%
