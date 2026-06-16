_pkgname=nexus-audio
pkgname=nexus-audio-git
pkgver=r46.ef25889
pkgrel=1
pkgdesc="Modern, fast, and feature-rich offline music player & downloader (Git version)"
arch=('x86_64')
url="https://github.com/yayapat/nexus-audio"
license=('MIT')
depends=('nss' 'alsa-lib' 'gtk3')
makedepends=('git' 'npm')
provides=("$_pkgname")
conflicts=("$_pkgname")
source=("git+https://github.com/yayapat/nexus-audio.git#branch=main")
sha256sums=('SKIP')

pkgver() {
  cd "$srcdir/$_pkgname"
  # Generate version based on total commit count and short hash (e.g. r46.ef25889)
  printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
}

build() {
  cd "$srcdir/$_pkgname"
  npm install
  npm run build:css
  npx electron-builder --linux dir
}

package() {
  cd "$srcdir/$_pkgname"
  
  # Install full application files to /opt/nexus-audio
  install -dm755 "$pkgdir/opt/$_pkgname"
  cp -r dist/linux-unpacked/* "$pkgdir/opt/$_pkgname/"
  
  # Symlink the binary directly to /usr/bin/nexus-audio
  install -dm755 "$pkgdir/usr/bin"
  ln -sf "/opt/$_pkgname/nexus-audio" "$pkgdir/usr/bin/$_pkgname"
}
