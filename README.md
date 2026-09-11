# slackgram

Node.js/TypeScript tool that accepts an Instagram or Facebook post/reel/video
URL, resolves the underlying media, downloads it, and returns the resulting
image/video file(s) — usable as a **CLI** or as an **HTTP API**.

Extraction is powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) (bundled
as a standalone binary in `bin/yt-dlp`, downloaded automatically on
`npm install`), which handles the actual page parsing and CDN URL resolution
for both platforms.

## Setup

```bash
npm install     # also downloads bin/yt-dlp via the postinstall hook
npm run build   # compile TypeScript -> dist/
```

If the automatic yt-dlp download fails (e.g. no network at install time), run
it manually:

```bash
npm run setup:ytdlp
# or point at an existing install:
export YTDLP_PATH=/usr/local/bin/yt-dlp
```

## CLI usage

```bash
# Run from source during development
npm run dev:cli -- "https://www.facebook.com/watch/?v=XXXXXXXXXX"

# Or after `npm run build`
node dist/cli.js "https://www.facebook.com/watch/?v=XXXXXXXXXX" -o ./downloads

# Optional: symlink so `slackgram` works from anywhere
ln -s "$(pwd)/bin/slackgram" ~/.local/bin/slackgram
slackgram "https://www.instagram.com/reel/XXXXXXXXXXX/" --zip
```

Options:

| Flag | Description |
| --- | --- |
| `-o, --output <dir>` | Directory to save files into (default: `.`) |
| `-c, --cookies <file>` | Netscape-format cookies file for content that requires login |
| `-z, --zip [file]` | Bundle all downloaded files into a single zip |
| `-t, --timeout <ms>` | Extraction timeout |
| `--json` | Print result metadata as JSON instead of human-readable text |

## API usage

```bash
npm run dev:api          # ts-node/tsx dev server on PORT (default 3000)
# or
npm run build && npm run start:api
```

Endpoints (all under `/api`, accept `url` via query string on GET or JSON
body on POST):

- `GET|POST /api/metadata?url=...` — resolves the post and returns JSON
  describing each media item (kind, size, dimensions, duration) without
  streaming file bytes back.
- `GET|POST /api/download?url=...` — streams the actual file. If the post has
  multiple items (e.g. an Instagram carousel), returns a `zip` by default;
  pass `&index=0` to fetch a single item directly, or `&format=zip` to force
  a zip even for single-item posts.
- Optional `cookies=<path-on-server>` param on either endpoint to use a
  specific cookies file for that request.
- `GET /health` — liveness check.

```bash
curl "http://localhost:3000/api/metadata?url=https://www.facebook.com/watch/?v=XXXXXXXXXX"

curl -OJ "http://localhost:3000/api/download?url=https://www.facebook.com/watch/?v=XXXXXXXXXX"
```

## Authentication (login-required content)

Both Instagram and Facebook increasingly require a logged-in session to view
post/reel detail pages, even ones that are technically public. When that
happens the tool returns a clear `LOGIN_REQUIRED` error. To work around it,
export cookies from a logged-in browser session to a Netscape-format
`cookies.txt` file (e.g. using a "Get cookies.txt" browser extension) and
pass it via `--cookies` (CLI) / `cookies` param (API), or set
`YTDLP_COOKIES_FILE` as a default in `.env`.

## Configuration

See `.env.example` for all supported environment variables (temp dir,
timeouts, concurrency limit, port, yt-dlp path/cookies).

## Notes

- Supported input: any `instagram.com` or `facebook.com`/`fb.watch` post,
  reel, video, or story URL that yt-dlp's `instagram`/`facebook` extractors
  recognize.
- Multi-item carousel/sidecar posts are downloaded as multiple files and
  zipped together by default.
- Temporary per-request download directories (under `SLACKGRAM_TMP_DIR`,
  default `$TMPDIR/slackgram`) are cleaned up automatically after each
  CLI run or API response.
