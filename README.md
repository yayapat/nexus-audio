<div align="center">
  
# 🎵 Nexus Audio

A modern, fast, and feature-rich offline music player & downloader designed specifically for Linux. Built with Electron and optimized for performance.

</div>

<hr/>

## ✨ Features

- 📥 **Integrated Downloader**: Download high-quality audio seamlessly using `yt-dlp`.
- 🎨 **Sleek Interface**: A beautiful, responsive, and distraction-free design.
- 🪟 **Mini Player Mode**: Unobtrusive playback controls that float while you work.
- ⚡ **Performance Optimized**: Engineered for silky smooth 60fps UI animations and low overhead.
- ⌨️ **Hardware Integration**: Native support for media keys and desktop environments.
- 📡 **Offline First**: Fully functional offline with zero cloud dependencies.

---

## 📦 Installation

Nexus Audio supports multiple Linux distributions. Follow the instructions below for your specific distribution.

### 🐧 Arch Linux / Manjaro / EndeavourOS

The recommended and cleanest method for Arch-based systems is using the provided `PKGBUILD` which integrates perfectly with `pacman`:

```bash
git clone https://github.com/yayapat/nexus-audio.git
cd nexus-audio

# Build and install cleanly via pacman
makepkg -si
```

### 🟠 Debian / Ubuntu / Linux Mint

You can easily build and install a standard `.deb` package:

```bash
git clone https://github.com/yayapat/nexus-audio.git
cd nexus-audio

# Install build dependencies
npm install

# Build the .deb package
npm run build:deb

# Install the package (replace the filename with the generated version)
sudo dpkg -i dist/nexus-audio_*.deb

# Fix any missing system dependencies
sudo apt-get install -f
```

### 🔵 Fedora / openSUSE / AppImage (Universal)

For other distributions, or if you prefer a portable executable without installing, you can build an AppImage:

```bash
git clone https://github.com/yayapat/nexus-audio.git
cd nexus-audio

# Install build dependencies
npm install

# Build the AppImage
npm run build:appimage

# Make the AppImage executable and run it
chmod +x dist/*.AppImage
./dist/*.AppImage
```

---

## 🛠️ Development Setup

If you want to modify the app or run it locally in development mode:

```bash
# Clone the repository
git clone https://github.com/yayapat/nexus-audio.git
cd nexus-audio

# Install Node.js dependencies
npm install

# Compile Tailwind CSS and start the app with dev tools enabled
npm run dev
```

---

## 📄 License

This project is open-source and licensed under the **MIT License**.
