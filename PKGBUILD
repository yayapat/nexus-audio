pkgname=nexus-audio
pkgver=2.0.3
pkgrel=1
pkgdesc="Nexus Audio - Modern music player & downloader"
arch=('x86_64')
url="https://github.com/punyapat/nexus-audio"
license=('MIT')
depends=('nss' 'alsa-lib' 'gtk3' 'nss')
makedepends=('npm')
source=()

build() {
  cd "$startdir"
  npm install
  npm run build:css
  npx electron-builder --linux dir
}

package() {
  cd "$startdir"
  
  # ติดตั้งไฟล์แอปทั้งหมดลงใน /opt/nexus-audio
  install -dm755 "$pkgdir/opt/nexus-audio"
  cp -r dist/linux-unpacked/* "$pkgdir/opt/nexus-audio/"
  
  # สร้าง Symlink ไปที่ /usr/bin/nexus-audio ตรงๆ ตามที่ขอ
  install -dm755 "$pkgdir/usr/bin"
  ln -sf "/opt/nexus-audio/nexus-audio" "$pkgdir/usr/bin/nexus-audio"
}
