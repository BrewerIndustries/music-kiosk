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
- **Volume:** the Now Playing card has 🎵 Music and 🔊 Sounds sliders. The music
  slider sets the kiosk's stored music volume, and ducking always restores to that
  value (never a level read back from Spotify, which can be stale). The setting
  follows changes made elsewhere (Spotify app, device buttons). Ducking lowers the
  music to *Settings ▸ duck %* of it; failed restores retry, and a watchdog
  restores after 3 min if a duck is ever left on. Clip volume is a Web Audio master gain.
- **Sound cards:** tapping a card fires it in the selected mode (restarts it if
  live); its button row is ▶/⏸, ■ stop, fade in, fade out (durations in
  *Settings ▸ Sounds*). Clips run through Web Audio (per-clip gain for fades →
  master gain for the Sounds volume), which also makes volume/fades work on iOS. A
  clip holds the music (paused or ducked) until it's stopped or ends; pausing a
  clip keeps the hold.
- **Music fades:** ⏮ [fade in] ▶/⏸ [fade out] ⏭. Fade out ramps to silence, pauses,
  and puts the volume back; fade in starts from silence if paused. Durations in
  *Settings ▸ Music*.
- **Playlist rows** (Up Next ▸ "Then from …"): ▶ play now, ⏸ load it paused at 0:00
  (muted for the jump, then volume restored), ⤒ copy to the top of Up Next (it will
  still play again when the playlist reaches it).
- **Survives a reload / crash.** Holds (duck / pause-for-clip) are stored and released
  on restart; the engine recovers its handoff from the DB. While music plays it saves a
  resume point (track, playlist, position); deliberate stops (pause, fade out, load
  paused) clear it. A reloaded kiosk page shows *Tap to resume the music*: one tap
  moves playback to the new browser player (Spotify keeps the same device id) or
  replays the saved point ~3 s early. If the SDK never reports ready, the server finds
  the "Music Kiosk" player itself after 6 s. Tab, board/page, search text and clip mode
  are kept in localStorage.
- **Responsiveness:** taps show their result at once (optimistic play/pause and
  "Loading…" for a picked song, dropped after 4 s if Spotify disagrees). After any
  change the page polls every 250 ms and the engine re-reads Spotify every 400 ms
  for 3 s; the browser player's `player_state_changed` triggers the same burst.
  Spotify calls time out after 10 s so nothing hangs.
- **Choosing a playlist** loads it paused at the first song (muted for the load);
  ▶ or fade in starts it. ↺ Restart still plays from the top.
- **Previously played** (top of the queue column, 3 rows, scrolls): every song that
  played ≥ 10 s, from any source, kept in settings (`play_history`, last 50); ▶ plays
  it again now, ⤒ puts it first in Up Next.
- **Fade between songs** (*Settings ▸ Music*, off by default, up to 12 s): the engine
  fades the last N s out and the next song in. Not a true overlap — Spotify's API
  can't crossfade; the Spotify app's own Crossfade setting does that when it is the
  player. Skipped while a clip holds the music, before a queued clip, or during a
  manual fade; a `hold_transition` flag restores the volume after a crash.
- **Guest page** shows now playing, every song in Up Next with its place (clips stay
  a surprise), the next playlist songs, Previously played (3 rows, scrolls), and *Your requests* with live status
  (waiting / #N in line / up next / playing / played). Each phone keeps a random
  `guest.id` in localStorage, stored on its requests (`queue.guest_id`);
  `GET /api/guest/queue?code=&guest=`.
- **Christmas theme:** evergreen/cranberry/gold tokens in `globals.css`, snow,
  lights and sparkles in `src/components/Christmas.tsx` (CSS-only, honours reduced
  motion), Mountains of Christmas title font via `next/font` (self-hosted).
- **Errors** from routes and the engine go to the server log and *Settings ▸ Recent errors*.
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
