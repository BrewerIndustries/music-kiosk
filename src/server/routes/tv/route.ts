import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { codeOk } from "@/lib/guest";
import { upNext } from "@/lib/queue";
import { snapshot } from "@/lib/engine";
import { getSetting } from "@/lib/db";
import { getSettings, guestBase } from "@/lib/settings";

export const dynamic = "force-dynamic";

let qrCache: { url: string; svg: string } | null = null;

// GET /api/tv?code= — the TV "now playing" screen (/tv): the song, how far in, who
// asked for it and their dedication, the next few songs, and the request QR code.
// Same party code as the guest link; songs only (sound clips stay a surprise).
export function GET(req: NextRequest) {
  if (!codeOk(req.nextUrl.searchParams.get("code"))) return NextResponse.json({ ok: false }, { status: 403 });
  return (async () => {
    const snap = snapshot();
    const settings = getSettings();
    const now = Date.now();
    let nowPlaying = null;
    if (snap.youtubeNow) {
      const y = snap.youtubeNow;
      let progressMs = Math.max(0, now - y.startedAt);
      try {
        const pos = JSON.parse(getSetting("youtube_pos") ?? "null") as { uri: string; ms: number; at: number } | null;
        if (pos?.uri === y.uri) progressMs = pos.ms + (snap.youtubeHeld ? 0 : now - pos.at);
      } catch {}
      nowPlaying = {
        source: "youtube",
        videoId: /^youtube:video:([\w-]{11})$/.exec(y.uri ?? "")?.[1] ?? null, // the TV shows the video (muted)
        title: y.title,
        subtitle: y.subtitle,
        art: y.art,
        isPlaying: !snap.youtubeHeld,
        progressMs: Math.min(progressMs, y.durationMs || progressMs),
        durationMs: y.durationMs,
        requestedBy: y.requestedBy,
        dedication: settings.dedicationsOn ? y.dedication : null,
      };
    } else if (snap.playback?.track) {
      const pb = snap.playback;
      const t = pb.track!;
      const item = snap.nowPlayingItem?.uri === t.uri ? snap.nowPlayingItem : null;
      nowPlaying = {
        source: "spotify",
        title: t.title,
        subtitle: t.subtitle,
        art: t.art,
        isPlaying: pb.isPlaying,
        progressMs: Math.min(t.durationMs, pb.progressMs + (pb.isPlaying ? now - pb.at : 0)),
        durationMs: t.durationMs,
        requestedBy: item?.requestedBy ?? null,
        dedication: settings.dedicationsOn ? (item?.dedication ?? null) : null,
      };
    }
    const next = upNext()
      .filter((i) => i.kind !== "clip" && i.id !== snap.nowPlayingItem?.id && i.id !== snap.youtubeNow?.id)
      .slice(0, 4)
      .map((i) => ({ title: i.title, subtitle: i.subtitle, art: i.art, requestedBy: i.requestedBy }));
    const then = next.length < 4 ? (snap.upcoming ?? []).filter((t) => !t.blocked).slice(0, 4 - next.length) : [];
    let request = null;
    if (settings.guestRequestsOpen) {
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
      const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
      const url = `${guestBase(`${proto}://${host}`)}/request?code=${settings.partyCode}`;
      if (qrCache?.url !== url)
        qrCache = { url, svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
      request = { url, svg: qrCache.svg };
    }
    return NextResponse.json({
      ok: true,
      nowPlaying,
      upNext: [...next, ...then.map((t) => ({ title: t.title, subtitle: t.subtitle, art: t.art, requestedBy: null }))],
      request,
    });
  })();
}
