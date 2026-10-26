import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/spotify";
import { duck, instantPause, instantResume, poke, skipToUpcoming, unduck } from "@/lib/engine";
import { getSettings } from "@/lib/settings";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/player { action, ... } — transport controls + clip helpers.
//   play | pause | next | previous | volume {percent} | shuffle {on}
//   transfer {deviceId, play?} | startPlaylist {deviceId?}
//   skipTo {uri, index}   (jump to a track in the upcoming playlist list)
//   duck | unduck | instantPause | instantResume   (used around instant clips)
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const b = (await req.json()) as Record<string, unknown>;
    const deviceId = typeof b.deviceId === "string" ? b.deviceId : undefined;
    let result: Record<string, unknown> = { ok: true };
    switch (b.action) {
      case "play":
        await api("PUT", "/me/player/play", undefined, { device_id: deviceId });
        break;
      case "pause":
        await api("PUT", "/me/player/pause");
        break;
      case "next":
        await api("POST", "/me/player/next");
        break;
      case "previous":
        await api("POST", "/me/player/previous");
        break;
      case "volume":
        await api("PUT", "/me/player/volume", undefined, { volume_percent: String(Math.round(Number(b.percent))) });
        break;
      case "shuffle":
        await api("PUT", "/me/player/shuffle", undefined, { state: b.on ? "true" : "false" });
        break;
      case "transfer":
        if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
        await api("PUT", "/me/player", { device_ids: [deviceId], play: b.play !== false });
        break;
      case "startPlaylist": {
        const { playlistUri } = getSettings();
        if (!playlistUri) return NextResponse.json({ error: "pick a playlist in Settings first" }, { status: 400 });
        await api("PUT", "/me/player/play", { context_uri: playlistUri }, { device_id: deviceId });
        // Loop the playlist so the backdrop never runs dry.
        await api("PUT", "/me/player/repeat", undefined, { state: "context", device_id: deviceId }).catch(() => {});
        break;
      }
      case "skipTo":
        if (typeof b.uri !== "string" || !b.uri.startsWith("spotify:track:"))
          return NextResponse.json({ error: "uri required" }, { status: 400 });
        await skipToUpcoming(b.uri, Math.max(0, Number(b.index) || 0));
        break;
      case "duck":
        result = { method: await duck(getSettings().duckPercent) };
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
