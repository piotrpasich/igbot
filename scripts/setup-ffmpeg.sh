#!/usr/bin/env bash
# Downloads a static ffmpeg binary into ./bin/ffmpeg.
#
# yt-dlp needs ffmpeg to mux separate DASH video+audio streams into a single
# file. Many Instagram/Facebook posts only expose separate video/audio DASH
# formats (no progressive one), so without ffmpeg those downloads silently
# fail even though metadata probing works fine.
#
# Usage: ./scripts/setup-ffmpeg.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"
DEST="$BIN_DIR/ffmpeg"

mkdir -p "$BIN_DIR"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" ;;
  aarch64|arm64) URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz" ;;
  *)
    echo "Unsupported architecture: $ARCH. Install ffmpeg manually and set FFMPEG_PATH." >&2
    exit 1
    ;;
esac

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading ffmpeg (static, $ARCH) from $URL ..."
curl -sL -o "$TMP_DIR/ffmpeg.tar.xz" "$URL"

# Some minimal hosts ship `tar` without xz support and no standalone xz/unxz
# binary. Fall back to python3's stdlib lzma module in that case.
if ! tar -xJf "$TMP_DIR/ffmpeg.tar.xz" -C "$TMP_DIR" 2>/dev/null; then
  echo "System tar lacks xz support; falling back to python3 lzma ..."
  python3 -c "
import lzma, shutil, sys
with lzma.open(sys.argv[1]) as fin, open(sys.argv[2], 'wb') as fout:
    shutil.copyfileobj(fin, fout)
" "$TMP_DIR/ffmpeg.tar.xz" "$TMP_DIR/ffmpeg.tar"
  tar -xf "$TMP_DIR/ffmpeg.tar" -C "$TMP_DIR"
fi

EXTRACTED="$(find "$TMP_DIR" -maxdepth 2 -type f -name ffmpeg | head -n1)"
if [ -z "$EXTRACTED" ]; then
  echo "Could not find ffmpeg binary in downloaded archive." >&2
  exit 1
fi

cp "$EXTRACTED" "$DEST"
chmod +x "$DEST"
"$DEST" -version
echo "ffmpeg installed at $DEST"
