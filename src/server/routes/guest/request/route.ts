import { NextRequest, NextResponse } from "next/server";
import { clientIp, codeOk, takeGuestSlot, validGuestId } from "@/lib/guest";
import { api, summarize, type SpTrack } from "@/lib/spotify";
import { addItem, isQueued } from "@/lib/queue";
import { getSettings } from "@/lib/settings";
import { poke } from "@/lib/engine";
import { handle } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/guest/request { code, uri, name? } — a guest sends a song to Up Next.
export function POST(req: NextRequest) {
  return handle(async () => {
    const b = (await req.json()) as { code?: string; uri?: string; name?: string; guestId?: string };
    if (!codeOk(b.code ?? null)) return NextResponse.json({ error: "This party link has expired." }, { status: 403 });
    const id = /^spotify:track:([A-Za-z0-9]{22})$/.exec(b.uri ?? "")?.[1];
    if (!id) return NextResponse.json({ error: "bad track" }, { status: 400 });
    const name = (b.name ?? "").trim().slice(0, 40);
    if (!name) return NextResponse.json({ error: "Please add your name so we know who requested it." }, { status: 400 });
    const rules = getSettings();
    if (!rules.guestRequestsOpen)
      return NextResponse.json({ error: "Song requests are closed right now." }, { status: 403 });
    if (rules.guestBlockDuplicates && isQueued(b.uri!))
      return NextResponse.json({ error: "That song is already in the queue!" }, { status: 409 });
    const limited = takeGuestSlot(clientIp(req), validGuestId(b.guestId));
    if (limited) return NextResponse.json({ error: limited }, { status: 429 });
    // Look the track up ourselves rather than trusting the client's title/art.
    const t = summarize((await api<SpTrack>("GET", `/tracks/${id}`))!);
    const { requireApproval } = rules;
    addItem(
      {
        kind: "track",
        uri: t.uri,
        title: t.title,
        subtitle: t.subtitle,
        art: t.art,
        durationMs: t.durationMs,
        requestedBy: name,
        source: "guest",
        guestId: validGuestId(b.guestId),
      },
      { status: requireApproval ? "pending" : "queued" },
    );
    poke();
    return NextResponse.json({ ok: true, pending: requireApproval }, { status: 201 });
  }, req);
}
