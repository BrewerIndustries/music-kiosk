import { NextRequest, NextResponse } from "next/server";
import { adminRoute, currentUser } from "@/lib/auth";
import { makeKeepsake, summary, summaryText } from "@/lib/event";
import { sendEmail } from "@/lib/mail";
import { hasScope } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

const MAX_RANGE_MS = 7 * 24 * 60 * 60_000;

function range(from: unknown, to: unknown): [number, number] | string {
  const f = Number(from);
  const t = Number(to);
  if (!Number.isFinite(f) || !Number.isFinite(t) || f <= 0 || t <= f) return "Pick a start and an end time (end after start).";
  if (t - f > MAX_RANGE_MS) return "Pick a range of a week or less.";
  return [f, t];
}

// Settings ▸ Event.
//   GET  /api/event/summary?from=&to=          (ms since epoch)
//   POST /api/event/keepsake {from, to, name, public?}   → a new Spotify playlist
//   POST /api/event/email    {from, to, tz?}             → the summary, to me
export function GET(req: NextRequest, ctx: Ctx) {
  return adminRoute(req, async () => {
    const { action } = await ctx.params;
    if (action !== "summary") return NextResponse.json({ error: "not found" }, { status: 404 });
    const r = range(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"));
    if (typeof r === "string") return NextResponse.json({ error: r }, { status: 400 });
    return NextResponse.json({ summary: summary(...r), canMakePlaylists: hasScope("playlist-modify-private") });
  });
}

export function POST(req: NextRequest, ctx: Ctx) {
  return adminRoute(req, async () => {
    const { action } = await ctx.params;
    const b = (await req.json()) as Record<string, unknown>;
    const r = range(b.from, b.to);
    if (typeof r === "string") return NextResponse.json({ error: r }, { status: 400 });
    if (action === "keepsake") {
      if (!hasScope("playlist-modify-private"))
        return NextResponse.json(
          { error: "Reconnect Spotify first (Settings ▸ Spotify ▸ Disconnect, then connect) so the kiosk may create playlists." },
          { status: 400 },
        );
      const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Our party 🎄";
      return NextResponse.json({ keepsake: await makeKeepsake(...r, name, b.public === true) });
    }
    if (action === "email") {
      const me = currentUser(req);
      if (!me?.email) return NextResponse.json({ error: "No email on your account." }, { status: 400 });
      const tz = typeof b.tz === "string" ? b.tz : undefined;
      const text = summaryText(summary(...r), tz);
      const html = `<pre style="font-family:-apple-system,Segoe UI,sans-serif;white-space:pre-wrap;line-height:1.5;color:#13261d">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`;
      const ok = await sendEmail(me.email, "🎄 Music Kiosk — the night in songs", text, html);
      return ok
        ? NextResponse.json({ ok: true, to: me.email })
        : NextResponse.json({ error: "The email didn't go out (see Recent errors)." }, { status: 502 });
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  });
}
