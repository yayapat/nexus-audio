# คำแนะนำการพัฒนาปลั๊กอิน (Nexus Audio Plugin Development Guide)

Nexus Audio รองรับระบบปลั๊กอิน (Plugin System) เพื่อให้นักพัฒนาสามารถเขียนส่วนขยายเพิ่มความสามารถให้กับแอปพลิเคชันได้ ไม่ว่าจะเป็นการปรับแต่งหน้าตา (UI/UX), เขียนระบบดาวน์โหลดจากเว็บไซต์อื่นๆ หรือเพิ่มฟีเจอร์ใหม่ๆ เข้าไปในระบบ

## 💻 ภาษาที่ดีที่สุดสำหรับการเขียนปลั๊กอิน
เนื่องจาก Nexus Audio พัฒนาด้วยเทคโนโลยีเว็บและ Electron **ภาษาที่ดีและเหมาะสมที่สุดคือ JavaScript (Vanilla JS)** เพราะ:
1. สามารถทำงานร่วมกับระบบเดิมได้ 100% (เข้าถึง DOM และ API ของแอปได้โดยตรง)
2. โค้ดอ่านง่าย ไม่ต้องมีการแปลภาษา (Compile)
3. ปลอดภัยและแก้ไขสะดวกแบบ Real-time

---

## 📂 โครงสร้างและการเรียกใช้ปลั๊กอิน
แอปพลิเคชันจะอ่านปลั๊กอินจากโฟลเดอร์ `plugins` ซึ่งอยู่ภายในโฟลเดอร์ `userData` (ตาม OS ของคุณ เช่น `%APPDATA%/nexus-audio/plugins` บน Windows)
> **เคล็ดลับ:** หากไม่มีโฟลเดอร์ `plugins` ให้สร้างขึ้นมาใหม่ได้เลย

ปลั๊กอินแบ่งเป็น 2 ประเภท ได้แก่:
1. **UI Plugins** (ไฟล์ลงท้ายด้วย `.ui.js`) — โค้ดจะถูกส่งไปรันฝั่งหน้าจอ (Renderer/Browser) ใช้สำหรับปรับหน้าตา หรือดักจับ Event ของปุ่มต่างๆ
2. *(ในอนาคต)* **Downloader Plugins** (ไฟล์ลงท้ายด้วย `.dl.js`) — โค้ดรันฝั่งหลังบ้าน (Main Process) เพื่อดูดเพลงจากเว็บ

---

## 🎨 การเขียน UI Plugin (`.ui.js`)
ไฟล์ `.ui.js` จะถูกฉีด (Inject) เข้าไปในหน้าเว็บอัตโนมัติ โดยมีอ็อบเจกต์ `window.NexusAPI` ให้เรียกใช้เพื่อเข้าถึงฟังก์ชันหลักของโปรแกรมได้อย่างอิสระและเข้าใจง่าย

### ตัวอย่าง: `my-theme.ui.js`
(ตัวอย่างการเปลี่ยนพื้นหลังและปุ่มต่างๆ แบบง่ายๆ)
```javascript
// เปลี่ยนภาพพื้นหลังของแอป
document.body.style.backgroundImage = "url('https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1600')";
document.body.style.backgroundSize = "cover";
document.body.style.backgroundPosition = "center";

// เปลี่ยนสีแถบควบคุมเป็นกระจกฝ้า (Glassmorphism)
const playerBar = NexusAPI.el('playerBar');
if (playerBar) {
  playerBar.style.background = "rgba(255, 255, 255, 0.1)";
  playerBar.style.backdropFilter = "blur(10px)";
  playerBar.style.borderTop = "1px solid rgba(255,255,255,0.2)";
}

// ใช้งานฟังก์ชันของแอป (เช่น แจ้งเตือนเวลาโหลดปลั๊กอินสำเร็จ)
NexusAPI.showToast('✅ My Custom Theme Loaded!');
```

### ตัวอย่าง: `auto-play-next.ui.js`
(ตัวอย่างการเรียกใช้ฟังก์ชันควบคุมเพลงผ่าน API)
```javascript
// สร้างปุ่มใหม่แล้วแทรกเข้าไปใน DOM
const myBtn = document.createElement('button');
myBtn.innerHTML = "🔄 Random Play";
myBtn.className = "px-4 py-2 bg-purple-500 text-white rounded-lg shadow-md";

myBtn.onclick = () => {
  // สุ่มเลือกเพลงในเพลย์ลิสต์
  const total = NexusAPI.playlist.length;
  if (total > 0) {
    const randomIdx = Math.floor(Math.random() * total);
    NexusAPI.playTrack(randomIdx);
    NexusAPI.showToast('Playing random track!');
  }
};

// แทรกปุ่มไว้ตรงเมนูด้านบน
const searchContainer = document.querySelector('.search-container');
if (searchContainer) {
  searchContainer.appendChild(myBtn);
}
```

---

## 🛠 API ที่เปิดให้ใช้งาน (window.NexusAPI)
คุณสามารถเรียกใช้ตัวแปรเหล่านี้ในสคริปต์ `.ui.js` ของคุณได้เลย:
* `NexusAPI.playlist` (Array) - รายการเพลงทั้งหมดในคิว
* `NexusAPI.audioPlayer` (HTMLAudioElement) - อ็อบเจกต์ที่ใช้เล่นเสียงจริง
* `NexusAPI.playTrack(index)` (Function) - สั่งเล่นเพลงตามลำดับที่ระบุ
* `NexusAPI.playNext()` (Function) - ข้ามไปเพลงถัดไป
* `NexusAPI.playPrev()` (Function) - ถอยกลับไปเพลงก่อนหน้า
* `NexusAPI.showToast(msg)` (Function) - แสดงข้อความแจ้งเตือนป๊อปอัปมุมจอ
* `NexusAPI.el(id)` (Function) - ดึง Element ตาม ID (ย่อมาจาก `document.getElementById`)
* `NexusAPI.nx` (Object) - เรียกคำสั่งลึกๆ ของระบบ (IPC) เช่น `nx.toggleAlwaysOnTop()`

## ⚠️ ข้อควรระวัง
* หากโค้ดในปลั๊กอินของคุณมีบั๊ก (Syntax Error) มันอาจทำให้หน้า UI บางส่วนรันไม่จบ 
* ควรครอบการทำงานเสี่ยงๆ ด้วย `try...catch` เสมอ
* สามารถกด `Ctrl+Shift+I` ในแอป (ถ้าเปิด Debug Mode ไว้) เพื่อดูข้อผิดพลาดใน Console ได้
