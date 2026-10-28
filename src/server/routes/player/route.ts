import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/spotify";
import {
  duck,
  fadeMusic,
  holdYouTube,
  dropBrowserItem,
  wakeSpotify,
  youtubeResumed,
  markStopped,
  keepPosition,
  placeBeforeMove,
  instantPause,
  skipCurrent,
  forgetPlace,
  snapshot,
  instantResume,
  poke,
  releaseHolds,
  rememberPlayer,
  restoreVolume,
  resumeOn,
  setMusicVolume,
  skipToUpcoming,
  startPlaylist,
  startKioskPlaylist,
  unduck,
} from "@/lib/engine";
import { getSettings } from "@/lib/settings";
import { adminRoute } from "@/lib/auth";
import { kioskPlaylistId } from "@/lib/kioskPlaylists";

export const dynamic = "force-dynamic";

// POST /api/player { action, ... } — transport controls + clip helpers.
//   play | pause | next | previous | volume {percent} | restoreVolume | shuffle {on}
//   transfer {deviceId, play?, browser?} | startPlaylist {deviceId?, paused?}
//   youtubePlay (the YouTube song's ▶: pauses Spotify)
//   fadeIn | fadeOut {cueNext?}  (music; cueNext leaves the next song paused)  ·  resumeOn {deviceId?}  ·  releaseHolds
//   skipTo {uri, index, paused?}   (jump to a track in the upcoming playlist list;
//                                   paused cues it up without playing)
//   duck | unduck | instantPause | instantResume   (used around instant clips)
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const b = (await req.json()) as Record<string, unknown>;
    const deviceId = typeof b.deviceId === "string" ? b.deviceId : undefined;
    let result: Record<string, unknown> = { ok: true };
    // One player at a time: anything that starts Spotify during a YouTube song
    // pauses the video on the kiosk screen (it plays on when its own ▶ is pressed).
    // Resuming Spotify pauses the YouTube song (it carries on later); starting a
    // different song (a playlist, a song from the upcoming list) ends it.
    const resumesSpotify =
      ["play", "previous", "fadeIn", "resumeOn"].includes(b.action as string) ||
      (b.action === "transfer" && b.play !== false);
    const startsOther = ["startPlaylist", "skipTo"].includes(b.action as string) && b.paused !== true;
    const duringYouTube = Boolean(snapshot().youtubeNow);
    if (resumesSpotify && duringYouTube) holdYouTube();
    if (startsOther) dropBrowserItem();
    switch (b.action) {
      case "play": {
        // Spotify sits idle through a YouTube song and may have dropped its player.
        const dev = deviceId ?? (duringYouTube ? await wakeSpotify() : undefined);
        await api("PUT", "/me/player/play", undefined, { device_id: dev });
        break;
      }
      case "youtubePlay": // the YouTube song's ▶ on the kiosk screen: Spotify steps aside
        await youtubeResumed();
        break;
      case "pause":
        await api("PUT", "/me/player/pause");
        markStopped();
        break;
      case "next":
        await skipCurrent();
        break;
      case "previous":
        forgetPlace();
        await api("POST", "/me/player/previous");
        break;
      case "seek": // the progress bar
        await api("PUT", "/me/player/seek", undefined, {
          position_ms: String(Math.max(0, Math.round(Number(b.positionMs) || 0))),
        });
        poke();
        break;
      case "volume": // the music volume slider; also what ducking restores to
        await setMusicVolume(Number(b.percent));
        break;
      case "restoreVolume":
        await restoreVolume();
        break;
      case "shuffle":
        await api("PUT", "/me/player/shuffle", undefined, { state: b.on ? "true" : "false" });
        break;
      case "transfer":
        if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
        const place = placeBeforeMove();
        await api("PUT", "/me/player", { device_ids: [deviceId], play: b.play !== false });
        await keepPosition(place); // a fresh player can start the song over
        // Remember the choice so a reload can pick the music back up on the same kind of player.
        rememberPlayer(b.browser === true ? "browser" : deviceId);
        break;
      case "fadeIn":
      case "fadeOut":
        result = { mode: await fadeMusic(b.action === "fadeIn" ? "in" : "out", b.cueNext === true) };
        break;
      case "resumeOn":
        result = { resumed: await resumeOn(deviceId) };
        break;
      case "releaseHolds":
        await releaseHolds();
        break;
      case "startPlaylist": {
        const { playlistUri } = getSettings();
        if (!playlistUri) return NextResponse.json({ error: "pick a playlist in Settings first" }, { status: 400 });
        const kioskId = kioskPlaylistId(playlistUri);
        if (kioskId) await startKioskPlaylist(kioskId, deviceId, b.paused === true);
        else await startPlaylist(playlistUri, deviceId, b.paused === true);
        break;
      }
      case "skipTo":
        if (typeof b.uri !== "string" || !b.uri.startsWith("spotify:track:"))
          return NextResponse.json({ error: "uri required" }, { status: 400 });
        await skipToUpcoming(b.uri, Math.max(0, Number(b.index) || 0), b.paused === true);
        break;
      case "duck":
        result = { method: await duck() };
        break;
      case "unduck":
        await unduck();
        break;
      case "instantPause":
        result = await instantPause();
        break;
      case "instantResume":
        await instantResume();
        break;
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    poke();
    return NextResponse.json(result);
  });
}
