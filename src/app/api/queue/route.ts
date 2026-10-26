import { NextRequest, NextResponse } from "next/server";
import { addItem, clearQueue, upNext } from "@/lib/queue";
import { playNow, poke } from "@/lib/engine";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return adminRoute(req, () => NextResponse.json({ upNext: upNext() }));
}

// POST /api/queue — add to Up Next.
// { kind: "track", uri, title, subtitle, art, durationMs } | { kind: "clip", clipKey, title, subtitle }
// Optional: requestedBy, playNow (start it immediately), top (put it first in Up Next).
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const b = (await req.json()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    if (b.kind === "track" && !str(b.uri)?.startsWith("spotify:track:"))
      return NextResponse.json({ error: "track needs a spotify:track: uri" }, { status: 400 });
    if (b.kind === "clip" && !str(b.clipKey))
      return NextResponse.json({ error: "clip needs a clipKey" }, { status: 400 });
    if (b.kind !== "track" && b.kind !== "clip") return NextResponse.json({ error: "bad kind" }, { status: 400 });
    const item = addItem({
      kind: b.kind,
      uri: str(b.uri),
      clipKey: str(b.clipKey),
      title: str(b.title) ?? "Untitled",
      subtitle: str(b.subtitle) ?? "",
      art: str(b.art),
      durationMs: typeof b.durationMs === "number" ? b.durationMs : 0,
      requestedBy: str(b.requestedBy),
    }, { atFront: b.top === true });
    if (b.playNow === true) await playNow(item.id);
    else poke();
    return NextResponse.json({ item }, { status: 201 });
  });
}

// DELETE /api/queue — clear Up Next (and pending guest requests).
export function DELETE(req: NextRequest) {
  return adminRoute(req, () => {
    clearQueue();
    return NextResponse.json({ ok: true });
  });
}
