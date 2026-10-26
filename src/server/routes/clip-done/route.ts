import { NextRequest, NextResponse } from "next/server";
import { finishClip } from "@/lib/engine";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/clip-done { id } — the audio host finished (or skipped) a queued clip.
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const { id } = (await req.json()) as { id?: string };
    if (id) await finishClip(id);
    return NextResponse.json({ ok: true });
  });
}
