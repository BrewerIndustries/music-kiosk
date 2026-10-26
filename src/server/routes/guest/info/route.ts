import { NextRequest, NextResponse } from "next/server";
import { codeOk } from "@/lib/guest";
import { getSettings } from "@/lib/settings";
import { isConnected } from "@/lib/spotify";
import { snapshot } from "@/lib/engine";

export const dynamic = "force-dynamic";

// GET /api/guest/info?code= — is this party link valid, and what's playing.
export function GET(req: NextRequest) {
  if (!codeOk(req.nextUrl.searchParams.get("code"))) return NextResponse.json({ ok: false }, { status: 403 });
  const track = snapshot().playback?.track ?? null;
  return NextResponse.json({
    ok: true,
    ready: isConnected(),
    requireApproval: getSettings().requireApproval,
    open: getSettings().guestRequestsOpen,
    limit: getSettings().guestLimit,
    windowMin: getSettings().guestWindowMin,
    nowPlaying: track ? { title: track.title, subtitle: track.subtitle, art: track.art } : null,
  });
}
