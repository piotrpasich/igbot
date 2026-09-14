#!/usr/bin/env bash
# Downloads the standalone yt-dlp binary into ./bin/yt-dlp so the app has a
# self-contained extraction engine that doesn't depend on a system Python
# install (yt-dlp's PyPI package requires Python >= 3.9; this binary bundles
# its own interpreter).
#
# Usage: ./scripts/setup-ytdlp.sh
# Override version: YTDLP_VERSION=2026.08.19 ./scripts/setup-ytdlp.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"
DEST="$BIN_DIR/yt-dlp"

mkdir -p "$BIN_DIR"

VERSION="${YTDLP_VERSION:-latest}"
if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
else
  URL="https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/yt-dlp_linux"
fi

echo "Downloading yt-dlp ($VERSION) from $URL ..."
curl -sL -o "$DEST" "$URL"
chmod +x "$DEST"

# The standalone yt-dlp_linux binary self-extracts its bundled Python
# runtime into TMPDIR and executes from there. Some shared hosts mount
# /tmp `noexec`, which breaks that. Default to a project-local dir instead
# (overridable via YTDLP_TMPDIR), matching src/config.ts at runtime.
YTDLP_EXTRACT_TMPDIR="${YTDLP_TMPDIR:-$PROJECT_ROOT/.yt-dlp-tmp}"
mkdir -p "$YTDLP_EXTRACT_TMPDIR"
TMPDIR="$YTDLP_EXTRACT_TMPDIR" "$DEST" --version
echo "yt-dlp installed at $DEST"
