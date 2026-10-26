# Music Kiosk

A personal party jukebox. A **Spotify playlist** plays as the backdrop; from the kiosk
anyone can **search all of Spotify** and slot songs into **Up Next**. When Up Next is
empty, playback returns to the playlist. **Soundboard clips** can pause the music or
play over it, or be queued like a song. Guests can **scan a QR code** to request songs
from their phones.

It's a responsive web app: every feature works on a **laptop, iPad, or phone**. See
[DESIGN.md](DESIGN.md) for the why.

- **Stack:** Next.js 16 + React 19 + Tailwind 4, SQLite via `better-sqlite3`.
- **Status:** v1 built and running locally on the Mac; awaiting Spotify app
  credentials for the first real test. Not yet deployed to the jarvis server.

## How it works

- **The kiosk owns the queue.** Spotify's queue is append-only (no insert-at-front,
  reorder, or remove) and can't play local files, so Up Next lives in SQLite. A server
  loop ([src/lib/engine.ts](src/lib/engine.ts)) polls `/me/player` and hands Spotify
  **one** track ~8 s before the current one ends; Spotify plays it gaplessly and then
  falls back to the playlist on its own. Decision logic is pure and unit-tested
  ([src/lib/engine-core.ts](src/lib/engine-core.ts)).
- **Queued clips:** the engine pauses Spotify ~1.5 s before the track ends; the
  kiosk tab that is the *audio host* plays the clip and reports back; the engine
  skips to the next item.
- **Player target** (Settings ▸ "Choose a player"): on desktop browsers the tab
  itself is a Spotify device via the Web Playback SDK ("Music Kiosk (this
  browser)"); on iPad/iPhone pick the Spotify app on that device; any Connect
  device works.
- **Instant clips** ([src/lib/clipPlayer.ts](src/lib/clipPlayer.ts)):
  - *Pause & play* — pause, play clip, resume the song where it stopped.
  - *Play over* — duck Spotify's volume via the API when the device supports it
    (browser player, desktop app); on iOS set `navigator.audioSession.type =
    "transient"` so iOS lowers the Spotify app; otherwise fall back to pause.
- **Soundboard** stays the source of record for clips. The kiosk reads its open
  `/api/boards` and proxies `/api/audio/<key>` (`SOUNDBOARD_URL`).
- **Guests:** `/request?code=XXXX` (QR on the Guests tab). Server-side search, 3
  requests / 10 min per IP, duplicates blocked, optional approval. Rotate the party
  code to kill old QR codes. Today guests must be on the same network as the kiosk;
  a public Cloudflare Worker front door is the planned next step (DESIGN.md).
- **Admin:** the kiosk is always admin. Set `KIOSK_PIN` to require a PIN once per
  device (cookie); guests only reach `/api/guest/*`.

## Local development (Mac)

```bash
npm install
cp .env.example .env.local    # fill in SPOTIFY_CLIENT_ID / SECRET
npm run dev                   # http://127.0.0.1:3000 (bound to 0.0.0.0 so phones can reach the guest page)
npm test                      # engine unit tests
npm run build
```

Spotify app setup (developer.spotify.com → Create app, Web API + Web Playback SDK):
add the redirect URI `http://127.0.0.1:3000/api/spotify/callback` exactly (Spotify
rejects `localhost`). Create the app with the same Spotify account that will play the
music, or add the playing account under User Management (dev-mode apps only allow
listed users). Premium is required.

Open the kiosk at **127.0.0.1** (not localhost) so the OAuth cookie matches.

**Dev-mode gotcha:** Spotify caps `/search` at `limit=10` for development-mode apps
(`limit=11+` → 400 "Invalid limit"; no limit → 5). `searchTracks()` pages in 10s.

## Environments (planned — jarvis server, `dan@100.102.159.57`)

| Env  | Branch | Port | URL (TBD) |
| ---- | ------ | ---- | --------- |
| DEV  | `dev`  | 4870 | music.dev.dabrewer.dev |
| MAIN | `main` | 4860 | music.dabrewer.dev |

Each env will need its own Spotify redirect URI registered.

## Workflow ⚠️

Work on `dev`. Promote to `main` only via a PR the user approves.
