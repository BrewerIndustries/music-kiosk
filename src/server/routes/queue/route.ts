import { NextRequest, NextResponse } from "next/server";
import { isBlocked } from "@/lib/settings";
import { addItem, clearQueue, upNext, type NewItem } from "@/lib/queue";
import { videoIdOf } from "@/lib/youtube";
import { playNow, poke } from "@/lib/engine";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return adminRoute(req, () => NextResponse.json({ upNext: upNext() }));
}

// POST /api/queue — add to Up Next.
// { kind: "track", uri, title, subtitle, art, durationMs } | { kind: "clip", clipKey, title, subtitle }
// | { kind: "youtube", uri: "youtube:video:<id>", title, subtitle, art, durationMs }
// Optional: requestedBy, playNow (start it immediately), top (put it first in Up Next).
// { items: [ …up to 200 of the above… ] } adds a batch (e.g. a whole YouTube playlist).
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const b = (await req.json()) as Record<string, unknown>;
    if (Array.isArray(b.items)) {
      const parsed = b.items.slice(0, 200).map((x) => parseItem(x as Record<string, unknown>));
      const bad = parsed.find((x) => typeof x === "string");
      if (bad) return NextResponse.json({ error: bad }, { status: 400 });
      const items = (parsed as NewItem[]).map((it) => addItem(it));
      poke();
      return NextResponse.json({ added: items.length }, { status: 201 });
    }
    const parsed = parseItem(b);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    const item = addItem(parsed, { atFront: b.top === true });
    if (b.playNow === true) await playNow(item.id);
    else poke();
    return NextResponse.json({ item }, { status: 201 });
  });
}

// A validated new Up Next item, or the reason it isn't one.
function parseItem(b: Record<string, unknown>): NewItem | string {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  if (b.kind === "track" && !str(b.uri)?.startsWith("spotify:track:")) return "track needs a spotify:track: uri";
  if (b.kind === "clip" && !str(b.clipKey)) return "clip needs a clipKey";
  if (b.kind === "youtube" && !videoIdOf(str(b.uri))) return "youtube needs a youtube:video: uri";
  if (b.kind !== "track" && b.kind !== "clip" && b.kind !== "youtube") return "bad kind";
  if (b.kind !== "clip" && isBlocked({ uri: str(b.uri), subtitle: str(b.subtitle) }))
    return `“${str(b.title) ?? "That song"}” is on the do-not-play list (Settings ▸ Do not play)`;
  return {
    kind: b.kind,
    uri: str(b.uri),
    clipKey: str(b.clipKey),
    title: str(b.title) ?? "Untitled",
    subtitle: str(b.subtitle) ?? "",
    art: str(b.art),
    durationMs: typeof b.durationMs === "number" ? b.durationMs : 0,
    requestedBy: str(b.requestedBy),
  };
}

// DELETE /api/queue — clear Up Next (and pending guest requests).
export function DELETE(req: NextRequest) {
  return adminRoute(req, () => {
    clearQueue();
    return NextResponse.json({ ok: true });
  });
}
