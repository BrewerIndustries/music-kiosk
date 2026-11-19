# Music Kiosk — design (v1)

Personal-use party jukebox (tested on a MacBook; runs on laptop/iPad/phone). A Spotify playlist plays as the backdrop; from the kiosk
anyone can search all of Spotify and slot a song in **Up Next**. When Up Next is empty,
playback returns to the playlist where it left off. Soundboard clips can be fired
instantly (two modes) or dropped into Up Next like a song. Guests can also send songs
from their phones by scanning a QR code.

## Devices — any browser, same features

The kiosk is a **responsive web app**; every feature works on a **laptop (Mac — the
test rig), iPad, or phone**. What differs per device is only *where Spotify's audio
comes from*, so the app abstracts that as a **player target** picked from a device
list (Spotify Connect devices from `GET /me/player/devices`):

| Kiosk device | Spotify plays in… | Clips play in |
| --- | --- | --- |
| Mac (Chrome/Safari/Firefox) | **this browser** via Web Playback SDK (default), or the Spotify desktop app | the browser |
| iPad / iPhone (Safari) | the **Spotify iOS app** on the same device (SDK isn't supported on mobile Safari) | the browser |
| Any | any other Connect device (speaker, TV, another computer) | the kiosk browser |

Spotify **Premium** required. Spotify's Web API queue is **append-only** (no
insert-at-front, reorder, or remove) and can't play local files → **the kiosk owns the
queue** (see below).

**"Duck" (lower & play over) strategy is chosen per target**, best first:
1. Target reports `supports_volume` (browser SDK player, Spotify desktop app) → set
   Spotify volume down via API/SDK, play clip, restore.
2. iOS/iPadOS → Safari **Audio Session API** (`navigator.audioSession.type =
   "transient"`, iPadOS 16.4+) asks iOS to duck other apps' audio.
3. Neither works → fall back to pause & play, and say so in the UI.

## The queue engine (heart of the app)

The kiosk keeps its own **Up Next** list (Spotify tracks + soundboard clips), FIFO by
default, reorderable/removable by admin. Spotify's own queue is only ever used to hold
**at most one** track, fed just in time:

1. Poll `GET /me/player` (~1 s while playing).
2. When the current track has **≤ ~8 s left** and the head of Up Next is a Spotify
   track → `POST /me/player/queue` with it and mark it "handed off". Spotify plays it
   gaplessly, then naturally falls back to the playlist context — exactly the
   "return to the playlist" behaviour, for free.
3. If the head is a **clip**: at track end → pause Spotify → play clip in Safari →
   resume (`PUT /me/player/play`), which carries on with the playlist/next item.
4. Admin "Play next now" = hand off + `POST /me/player/next`.

Edge cases to handle: user skipping in the Spotify app, the Spotify app being killed /
device disappearing (show a "Tap to wake Spotify" banner + transfer playback), token
refresh, duplicate requests.

## Clips (Soundboard integration)

Soundboard stays the source of record (upload/manage clips there). The kiosk reads
`GET /api/boards` (boards → pages → sounds, open) and plays
`/api/audio/<key>` (Range-capable). Kiosk shows the boards as a pad grid with two
fire buttons per pad (or a mode toggle):

- **Pause & play** — pause Spotify, play clip, resume the same song from where it
  stopped.
- **Duck & play over** — play the clip with the audio session set to `transient`
  so iOS lowers the music underneath; music returns to full volume when it ends.
- **Add to Up Next** — queue the clip like a song.

## Guest QR requests

The kiosk is tailnet-only; guests' phones aren't. So a tiny **public** piece
(Cloudflare Worker + D1, the Brookeslist/Voice Studio flavor) serves
`request.<domain>/<party-code>`: search box → "Send to queue". The Worker does the
Spotify search with an app (client-credentials) token — no user tokens leave the
server. Requests land in a D1 inbox; the kiosk polls it and appends to Up Next
(optional "approve requests" toggle for admin). The kiosk shows the QR on screen. A
rotating party code + per-device rate limit keeps randoms out.

## Architecture (v2 — Cloudflare, 2026-10)

Moved off the home server so the wedding doesn't depend on home internet, power or
the NAT, and so guests can reach the request page from any network.

- **One Worker per app** serving the static Next.js export and `/api/*` (not GitHub
  Pages + Worker: one origin keeps the session cookie and OAuth simple).
- **One Durable Object** (`KioskObject`, SQLite) owns all state *and* runs the engine
  on alarms. A single object serialises every request and tick, which is exactly the
  "one engine" model the server had, and it keeps playing with no browser open. It
  backs off to a 1-minute poll when idle.
- **Guests** hit the same Worker (`/request?code=`); the separate guest Worker + D1
  inbox planned below is no longer needed.
- **Auth**: invite-only email + password accounts replace the PIN — the kiosk is now on
  the public internet. Guests still never sign in.
- **Soundboard**: also its own Worker (D1 + private R2); the kiosk reaches it over a
  service binding with a bearer token.
- Cost: Workers Paid ($5/mo) for Email Sending; everything else is well inside it.

## Architecture (v1 — home server, superseded)

- **Kiosk app**: Next.js 16 + SQLite on the jarvis server, usual dev/prod split
  (ports TBD, e.g. 4860/4870), tailnet-only via nginx. Holds the Spotify user
  refresh token server-side; queue state lives server-side so a page reload / iPad
  sleep doesn't lose Up Next. The queue engine runs **in the server** (polling
  Spotify), the kiosk browser (any device) is a thin UI + clip player.
- **Guest Worker**: Cloudflare Worker + D1, public, search + submit only.
- **Auth**: kiosk is always admin (PIN to unlock settings/exit). Guests can only
  search + submit via the Worker.

## What the user needs to do (can't be automated)

1. Create a Spotify app at developer.spotify.com (dev mode is fine for personal
   use), add the redirect URI(s) we give you, and share the **Client ID/Secret** via
   the server's `.env` (not chat).
2. For iPad/phone use later: install/sign in to the Spotify app on that device.

## Build order

1. **Spike (de-risk first), on the Mac:** OAuth, Web Playback SDK player in the
   browser, controlling the Spotify desktop app as an alternate target, both clip
   modes. Then a quick pass on iPad/iPhone (Spotify iOS app as target +
   `audioSession` duck).
2. Spotify OAuth + search + Up Next engine + now-playing UI.
3. Soundboard pads (both fire modes + queue).
4. Guest QR Worker.
5. Dashboard/launcher cards, `.jarvis.json`, README.
