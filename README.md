# Music Kiosk

A personal party jukebox. A **Spotify playlist** plays as the backdrop; from the kiosk
anyone can **search all of Spotify** and slot songs into **Up Next**. When Up Next is
empty, playback returns to the playlist. **Soundboard clips** can pause the music or
play over it, or be queued like a song. Guests can **scan a QR code** to request songs
from their phones.

It's a responsive web app: every feature works on a **laptop, iPad, or phone**. See
[DESIGN.md](DESIGN.md) for the why.

- **Stack:** Next.js 16 + React 19 + Tailwind 4 (static export) on **Cloudflare
  Workers**: one Worker serves the pages and `/api/*`; all state and the playback
  engine live in a single **Durable Object** with SQLite (`KioskObject`).
- **Status:** v1 tested on the Mac (local server); Cloudflare port on branch
  `cloudflare`, smoke-tested under `wrangler dev`. Hosts:
  musickiosk-dev.dabrewer.dev (dev), musickiosk.dabrewer.dev (prod).

## Cloudflare architecture

- [src/server/worker.ts](src/server/worker.ts): `/api/*` goes to the one
  `KioskObject` (`idFromName("kiosk")`), everything else to the static assets in
  `out/`. One object = one engine = no races, and it keeps running with no page open.
- The route files are the original Next.js route handlers, moved to
  `src/server/routes/` and dispatched by [src/server/router.ts](src/server/router.ts);
  `next/server` is aliased to a small shim ([src/server/next-shim.ts](src/server/next-shim.ts)).
- [src/lib/db.ts](src/lib/db.ts) wraps the Durable Object's `ctx.storage.sql` in the
  same `prepare().get/all/run` API the code used with better-sqlite3.
- The engine loop is a **Durable Object alarm** (`attachAlarms` → `setAlarm`); with
  nothing playing, no clip and no kiosk page open it backs off to one poll a minute,
  and a page's `/api/state` wakes it at once if its snapshot is stale.
- Soundboard calls go over a **service binding** (`SOUNDBOARD`) with a bearer token
  (`SOUNDBOARD_TOKEN` = the Soundboard's `JARVIS_TOKEN`).
- Emails (invite / reset) use the `send_email` binding `EMAIL` from
  `noreply@dabrewer.dev` (Email Sending enabled for dabrewer.dev 2026-10-26). They are
  sent by the Worker's `Mailer` RPC entrypoint, which the Durable Object calls over
  the `MAILER` self-binding: from inside a DO the binding only reaches verified Email
  Routing addresses ("destination address is not a verified address"). Sending fails
  soft: the link is logged and the invite link is shown to the admin to copy.

## How it works

- **The kiosk owns the queue.** Spotify's queue is append-only (no insert-at-front,
  reorder, or remove) and can't play local files, so Up Next lives in SQLite. The
  engine ([src/lib/engine.ts](src/lib/engine.ts), run by the Durable Object alarm) polls `/me/player` and hands Spotify
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
- **Sound cards:** tapping a card fires it in the selected mode (restarts it if live;
  fades in when the card's fade-in toggle is on);
  its button row is ▶/⏸, ■ stop, and two fade toggles (lit = on, kept per
  sound per device in `kiosk.padFades`): with fade-in on, ▶ fades the clip in (from
  stopped or paused); with fade-out on, ■ fades it out, and a second ■ stops at once.
  Pause is always instant. Durations in *Settings ▸ Sounds*. Clips run through Web Audio (per-clip gain for fades →
  master gain for the Sounds volume), which also makes volume/fades work on iOS. A
  clip holds the music (paused or ducked) until it's stopped or ends; pausing a
  clip keeps the hold.
- **Music fades:** ⏮ [fade in] ▶/⏸ [fade out] ⏭. The two fade buttons are toggles
  (per screen, localStorage `kiosk.musicFades`, like the sound cards'). Fade in on:
  ▶ starts from silence and ramps up. Fade out on: ⏸ ramps to silence, pauses, then
  **cues the next song paused at 0:00** (Up Next's head track first, else the
  playlist; `fadeOut {cueNext}` → `cueNextPaused()`), and puts the volume back, so
  the next ▶ starts a fresh song. Durations in *Settings ▸ Music*.
- **Playlist rows** (Up Next ▸ "Then from …"): ▶ play now, ⏸ load it paused at 0:00
  (muted for the jump, then volume restored), ⤒ copy to the top of Up Next (it will
  still play again when the playlist reaches it).
- **Survives a reload / crash.** Holds (duck / pause-for-clip) are stored and released
  on restart; the engine recovers its handoff from the DB. While music plays it saves a
  resume point (track, playlist, position); deliberate stops (pause, fade out, load
  paused) clear it. A reloaded kiosk page shows *Tap to resume the music*: one tap
  moves playback to the new browser player (Spotify keeps the same device id) or
  replays the saved point 2.5 s early. Track position is guarded three ways: the
  saved place is taken before any player move and checked ~1 s after (seek back if
  Spotify restarted the song); while paused the saved place for a song only moves
  forward (a re-registered player reports 0:00); downtime is not added on resume. If the SDK never reports ready, the server finds
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
  played ≥ 10 s, from any source including YouTube songs (`notePlayed()` in
  `finishClip`), kept in settings (`play_history`, last 50); ▶ plays it again now,
  ⤒ puts it first in Up Next.
- **Up Next rows:** ▶ play now, ⇈ move to the top (`PATCH {action:"top"}`), ↑ / ↓
  one place, ✕ remove.
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
- **Guests:** `/request?code=XXXX` (QR on the Guests tab), reachable from any network.
  Guests must type their name before a request is sent (shown as *requested by*).
  Server-side search.
- **Request rules** (*Guests ▸ Request rules*): requests on/off, N requests every M
  minutes per phone (default 3 / 10; counted by the phone's `guest.id`, with a
  150-per-10-min ceiling per network since venue Wi-Fi shares one IP), block songs
  already queued, approve requests first.
- **Party code:** *Rotate* kills old QR codes; *Set…* picks a specific code (3–12
  letters/numbers); *Put back the previous code* restores the one before the last
  change — for when printed QR codes stop working after an accidental rotate.
- **Progress bar** is draggable (and ←/→ steps 10 s) to seek in the song.
- **Lower the music** switch (Sounds tab, *Play over* mode): off plays clips over the
  music at full volume with no duck (remembered per device).
- **YouTube / YouTube Music** (*Settings ▸ YouTube*, off by default): connect a Google
  account (read-only), switch it on, and search gets **Spotify | YouTube** tabs.
  YouTube has a song search (music category; runs on Enter, since each search is 1% of
  the 10,000-unit daily API quota; cached 1 h server-side) and **Your playlists** (the
  account's YouTube playlists, which include ones made in YouTube Music; open one to
  add songs or **+ Add all**, up to 200). Songs go into Up Next as `youtube` items
  (`uri = youtube:video:<id>`). The engine treats them like queued clips: it pauses
  Spotify ~1.5 s before the song ends, the audio-host kiosk tab plays the video in
  YouTube's embedded IFrame player ([src/lib/youtubePlayer.ts](src/lib/youtubePlayer.ts),
  visible ≥200×200 as YouTube requires — no audio-only playback), and reports back;
  a run of YouTube songs plays back to back, then Spotify resumes. ⏭ skips the
  YouTube song (instantly on the kiosk screen). **One player at a time:** anything
  that starts Spotify during a YouTube song (▶, fade in, the Resume banner, ⏮,
  playlist start/skip-to, a transfer) calls `holdYouTube()`. The kiosk tab sees
  `youtubeHeld` and pauses the video, and the song is marked `resume`, so when it
  finishes Spotify carries on with its current song. Whenever the video starts
  playing (our ▶, *Tap to play*, or YouTube's own controls) the kiosk tab posts
  `youtubePlay`, which pauses Spotify. Starting a *different* song (▶ / Play now on an Up Next
  song or a request, a playlist start, a song from the upcoming list) instead **ends**
  the YouTube song (`dropBrowserItem()`: it counts as played and the kiosk tab stops
  its player), and the new song plays directly on a re-woken Spotify player. Late
  `clip-done` reports for an item already moved past just mark it played, so a
  restart can't bring it back. The "music stopped" banner (`resumeOffer`)
  stays hidden while a YouTube song or clip is in progress, even when it's paused. **Surviving deploys and reloads:** the kiosk tab
  reports its YouTube position on every state poll (`&yt=<videoId>:<ms>` → setting
  `youtube_pos`), and the song in progress is saved as `youtube_clip`. After a server
  restart, `recoverAfterRestart` keeps the YouTube song (Spotify stays paused) rather
  than dropping it, and the kiosk tab, reloaded or not, starts it again at the saved
  spot (`clip.startMs`). A YouTube song started with ▶ Now mid-song resumes the interrupted Spotify
  song afterwards (`memory.clip.resume`) instead of skipping it. On the kiosk screen
  the progress bar seeks (drag, or ←/→ 10 s). Spotify's player goes idle while a
  YouTube run plays, so handing back first wakes it (`wakeSpotify()`: transfer to the
  last-seen device, kept as setting `last_device`) and every queue/next/play call
  names that `device_id` — otherwise Spotify answers "no active device". Volume follows the
  music volume; Pause & play / Play over sounds hold the YouTube song like Spotify.
  If the browser blocks autoplay (iOS), the player shows *Tap to play*. Videos that
  can't be embedded are filtered out. Guests stay Spotify-only but see YouTube songs
  in the queue. Limits: plays only on the kiosk screen (no remote control of the
  YouTube app); ads unless that browser is signed into YouTube Premium; a short
  gap at each Spotify↔YouTube switch.
- **Kiosk playlists, Spotify + YouTube mixed** (*Settings ▸ Kiosk playlists*,
  [kioskPlaylists.ts](src/lib/kioskPlaylists.ts), tables `kiosk_playlists` /
  `kiosk_playlist_items`). Create one, add songs with ＋☰ on any Spotify or YouTube
  search result, or import a whole Spotify or YouTube playlist (up to 1000 songs,
  duplicates skipped). Reorder (⇈ ↑ ↓), remove, rename, shuffle. *Use as backdrop*
  (or pick it from the 🎵 chip, where kiosk playlists are listed first) sets
  `playlist_uri = kiosk:playlist:<id>`.
  - **How it plays:** there is no Spotify playlist behind it, so the engine keeps the
    playlist's next song waiting in Up Next (`feedBackdrop()`; `source = 'backdrop'`,
    position ≥ 1e12, so anything people add goes ahead of it; shown as "from the
    playlist"). The normal Up Next machinery then plays it. Spotify songs are handed
    to Spotify near the end of the current song. YouTube songs play on the kiosk
    screen while Spotify waits.
  - **Starting it** (`startKioskPlaylist`): clears waiting backdrop songs, resets the
    cursor (setting `kiosk_backdrop_cursor`), turns Spotify's repeat off (or it would
    repeat the single song we hand it), and plays the first song directly (`PUT
    /me/player/play {uris}`), or loads it paused.
  - **Skipping:** ⏭ and the end of a YouTube song also play the next song directly.
  - **Looping, shuffle, do-not-play:** the playlist loops. Shuffle picks at random,
    avoiding the last half of the playlist. Do-not-play songs are skipped. "Then
    from …" lists the next 10 (none when shuffled); ▶ on one queues it to play now.
  - **Changing the backdrop** drops any backdrop songs still waiting in Up Next.
    Deleting the playlist that is the backdrop is refused.
- **Accounts** ([src/lib/accounts.ts](src/lib/accounts.ts)): invite-only email +
  password. Admins invite from *Settings ▸ People* (emailed link, 7 days; the link is
  also shown to copy), set admin/member, disable, remove, resend; there is always
  at least one admin. *Forgot password?* emails a 1-hour reset link; a reset signs out
  other devices. PBKDF2-SHA256 (100k), session cookie `mk_session` (HttpOnly, 90-day
  rolling, only an HMAC of the token is stored), rate-limited sign-in / forgot.
  First run: `BOOTSTRAP_ADMIN_EMAIL` becomes the admin with no password — use
  *Forgot password?* to set it. Guests never sign in; they only reach `/api/guest/*`.
- **Health light** (header dot, [HealthLight.tsx](src/components/HealthLight.tsx)):
  green / amber / red; tap for the checks: kiosk server reachable, Spotify connected
  and answering, a player active, this browser's player, a kiosk screen acting as
  the audio host (`audioHostAlive`), YouTube connected (when on), errors in the last
  10 min.
- **Do not play** (*Settings ▸ Do not play*, setting `do_not_play`): block an artist
  (matched against the song's artists / YouTube channel) or a song (from search).
  Guests never see them in search and can't request them; the kiosk refuses to queue
  them; search and the upcoming list mark them 🚫; the engine skips one that comes up
  from the playlist or the Spotify app (once per song, `skippedBlocked`). *🚫 Never
  play* on Now Playing blocks the current song and skips it.
- **Dedications** (*Guests ▸ Dedications*, on by default, `dedications_on`): guests
  can add up to 140 characters to a request (`queue.dedication`). Shown in approvals
  and Up Next, and on the TV screen while the song plays. Use *Approve requests
  first* to read them before they go up.
- **TV screen** (`/tv?code=<party code>`, linked from *Guests ▸ TV screen*): a
  full-screen now-playing page for a TV or projector. Shows album art (blurred
  behind), the song, progress, "requested by", the dedication, the next 4 songs and
  the request QR. No sign-in needed (party code, like the guest page); polls
  `/api/tv` every 2 s; asks for a screen wake lock; hides the cursor. Christmas theme:
  evergreen room with a cranberry glow, pine garlands, a gold/red framed cover with a
  bow and holly, a candy-cane progress bar, the dedication as a gift tag. The album
  art behind is luminosity-only, so the cover's colours can't tint the room. A
  **YouTube song shows its video**: a second embed, **muted** (the sound stays on the
  kiosk screen), re-synced when it drifts more than 2.5 s and paused with it
  ([TvVideo.tsx](src/components/TvVideo.tsx)). Previews with sample data:
  `/tv?code=demo` and `/tv?code=demo-youtube`.
- **Event log, summary, keepsake** (*Settings ▸ Event*): every song that plays for
  ≥ 10 s (Spotify or YouTube) goes into the `plays` table with its start time, who
  requested it and the dedication. Pick a from/to range to see a summary (songs,
  hours, guest requests, sounds, first/last song, top artists and requesters, repeats,
  dedications, the full list), email it to yourself, or **create a keepsake Spotify
  playlist** of it, in order. YouTube songs are matched by a cleaned-up title search,
  and unmatched ones are listed. Creating playlists needs the `playlist-modify-*`
  scopes (added 2026-10-28), so an account connected before then must reconnect
  Spotify once. The granted scopes are stored as `spotify_scope`. The log only starts
  with this version; earlier plays aren't in it.

## Local development (Mac)

```bash
npm install
# .dev.vars (git-ignored): SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SESSION_SECRET,
#   SOUNDBOARD_TOKEN, SPOTIFY_REDIRECT_URI=http://127.0.0.1:8787/api/spotify/callback
npm run dev:api               # the Worker + Durable Object on :8787 (wrangler dev --local)
npm run dev                   # Next dev UI on :3000, /api proxied to :8787
npm test && npm run typecheck && npm run lint
```

Or `npx next build` then open the Worker directly at http://127.0.0.1:8787 (it serves
`out/`). Local emails aren't sent: wrangler writes them under `.wrangler/tmp/email/`.

YouTube needs a Google Cloud OAuth client (Web application) with the YouTube Data API
v3 enabled; secrets `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, redirect URIs
`https://musickiosk-dev.dabrewer.dev/api/youtube/callback`,
`https://musickiosk.dabrewer.dev/api/youtube/callback` and
`http://127.0.0.1:8787/api/youtube/callback`. Set the consent screen to **In
production** — in *Testing*, Google expires refresh tokens after 7 days.

**Deploy gotcha:** after `wrangler deploy` the Worker updates at once, but the Durable
Object (all of `/api`) can keep serving the previous code for a few minutes.

Spotify app setup (developer.spotify.com → Create app, Web API + Web Playback SDK):
register each redirect URI exactly (Spotify rejects `localhost`):
`http://127.0.0.1:8787/api/spotify/callback`,
`https://musickiosk-dev.dabrewer.dev/api/spotify/callback`,
`https://musickiosk.dabrewer.dev/api/spotify/callback`. Create the app with the same
Spotify account that will play the music, or add the playing account under User
Management (dev-mode apps only allow listed users). Premium is required.

**Dev-mode gotcha:** Spotify caps `/search` at `limit=10` for development-mode apps
(`limit=11+` → 400 "Invalid limit"; no limit → 5). `searchTracks()` pages in 10s.

## Environments (Cloudflare Workers)

| Env  | Branch | Worker           | URL                              | Soundboard binding |
| ---- | ------ | ---------------- | -------------------------------- | ------------------ |
| DEV  | `dev`  | `musickiosk-dev` | https://musickiosk-dev.dabrewer.dev | `soundboard-dev` |
| MAIN | `main` | `musickiosk`     | https://musickiosk.dabrewer.dev  | `soundboard`       |

Deploy (wrangler's OAuth login; the shell's `CLOUDFLARE_API_TOKEN` is DNS-only):

```bash
env -u CLOUDFLARE_API_TOKEN npm run deploy:dev     # or: npm run deploy (prod)
# once per env: wrangler secret put SPOTIFY_CLIENT_ID | SPOTIFY_CLIENT_SECRET |
#   SESSION_SECRET | SOUNDBOARD_TOKEN   (add --env dev for dev)
```

**Moving the old local kiosk's settings over** (playlist, volumes, fades, rules,
party code, history, resume point, and — unless `--no-spotify` — the Spotify login).
Stop the old kiosk first if Spotify comes too, or both will drive playback:

```bash
KIOSK_EMAIL=… KIOSK_PASSWORD=… node scripts/import-local.mjs \
  --db ../music-kiosk/data/kiosk.db --url https://musickiosk-dev.dabrewer.dev
```

## Workflow ⚠️

Work on `dev`. Promote to `main` only via a PR the user approves.
