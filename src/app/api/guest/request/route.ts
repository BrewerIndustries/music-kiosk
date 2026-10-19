import { NextRequest, NextResponse } from "next/server";
import { clientIp, codeOk, GUEST_LIMIT, takeGuestSlot } from "@/lib/guest";
import { api, summarize, type SpTrack } from "@/lib/spotify";
import { addItem, isQueued } from "@/lib/queue";
import { getSettings } from "@/lib/settings";
import { poke } from "@/lib/engine";
import { handle } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/guest/request { code, uri, name? } — a guest sends a song to Up Next.
export function POST(req: NextRequest) {
  return handle(async () => {
    const b = (await req.json()) as { code?: string; uri?: string; name?: string };
    if (!codeOk(b.code ?? null)) return NextResponse.json({ error: "This party link has expired." }, { status: 403 });
    const id = /^spotify:track:([A-Za-z0-9]{22})$/.exec(b.uri ?? "")?.[1];
    if (!id) return NextResponse.json({ error: "bad track" }, { status: 400 });
    if (isQueued(b.uri!)) return NextResponse.json({ error: "That song is already in the queue!" }, { status: 409 });
    if (!takeGuestSlot(clientIp(req)))
      return NextResponse.json(
        { error: `Easy, DJ — ${GUEST_LIMIT} requests per 10 minutes. Try again soon.` },
        { status: 429 },
      );
    // Look the track up ourselves rather than trusting the client's title/art.
    const t = summarize((await api<SpTrack>("GET", `/tracks/${id}`))!);
    const { requireApproval } = getSettings();
    addItem(
      {
        kind: "track",
        uri: t.uri,
        title: t.title,
        subtitle: t.subtitle,
        art: t.art,
        durationMs: t.durationMs,
        requestedBy: (b.name ?? "").trim() || "Guest",
        source: "guest",
      },
      { status: requireApproval ? "pending" : "queued" },
    );
    poke();
    return NextResponse.json({ ok: true, pending: requireApproval }, { status: 201 });
  });
}
