<div align="center">
  <img src="assets/icon.png" alt="Nexus Audio Logo" width="160"/>
  
  # 🎵 Nexus Audio

  <p><strong>A Modern, Beautiful, and Feature-Rich Music Player & Downloader built with Electron.</strong></p>

  <p>
    <a href="https://github.com/punyapat/nexus-audio/releases/latest">
      <img src="https://img.shields.io/github/v/release/punyapat/nexus-audio?style=for-the-badge&color=0ea5e9" alt="Release">
    </a>
    <a href="https://github.com/punyapat/nexus-audio/blob/master/LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License">
    </a>
    <img src="https://img.shields.io/badge/Electron-42.4.0-191970?style=for-the-badge&logo=Electron&logoColor=white" alt="Electron">
    <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="TailwindCSS">
  </p>

  <p>
    <a href="#-features">Features</a> •
    <a href="#-installation">Installation</a> •
    <a href="#-building-for-production">Building</a> •
    <a href="#-technology-stack">Tech Stack</a>
  </p>
</div>

---

## ✨ Features

Nexus Audio is crafted to deliver a premium listening experience with a beautiful UI and powerful under-the-hood capabilities.

- 🎨 **Modern User Interface:** A stunning, glassmorphism-inspired design featuring seamless Light and Dark mode transitions.
- 📥 **Built-in Downloader:** Download music directly using the integrated `yt-dlp` engine. Extract MP3, M4A, FLAC, and WAV with ease.
- 🎛️ **10-Band Equalizer:** Fine-tune your audio experience with a custom 10-band EQ and multiple built-in presets (Bass Boost, Acoustic, Pop, Rock, etc.).
- 📱 **Mini Player Mode:** Keep your screen real estate clean with a compact, always-on-top mini player that stays out of your way.
- ⚙️ **System Integration:** Full support for Global Media Keys, System Tray icon, and native OS notifications.
- 📂 **Playlist Management:** Save, load, and manage your custom music queues easily via smooth drag & drop interactions.

<br />

## 🚀 Installation

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.
For the downloader feature to work optimally, you must have `yt-dlp` and `ffmpeg` installed on your system path.

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/punyapat/nexus-audio.git
   cd nexus-audio
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the application (Development mode):**
   ```bash
   npm run dev
   ```

<br />

## 📦 Building for Production

To build the executable for your operating system (e.g., AppImage, deb, or pacman for Linux):

```bash
# Build standard Linux targets
npm run build

# Build specifically for Debian-based systems
npm run build:deb

# Build specifically as an AppImage
npm run build:appimage
```

*Compiled binaries will be available in the `dist` folder.*

<br />

## 🛠️ Technology Stack

- **[Electron](https://www.electronjs.org/)** - Desktop application framework bridging web tech and native OS features.
- **[TailwindCSS](https://tailwindcss.com/)** - Utility-first CSS framework used for rapid and responsive UI styling.
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** - Powerful command-line audio/video downloader.
- **[music-metadata](https://github.com/Borewit/music-metadata)** - Fast and robust audio metadata parser.

<br />

## 🤝 Contributing

Contributions, issues, and feature requests are highly appreciated!
Feel free to check the [issues page](https://github.com/punyapat/nexus-audio/issues) if you want to contribute.

<br />

## 📝 License

This project is open-sourced software licensed under the [MIT License](https://github.com/punyapat/nexus-audio/blob/master/LICENSE).

---
<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/punyapat">Punyapat</a></sub>
</div>
