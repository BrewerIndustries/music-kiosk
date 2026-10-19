import { NextRequest, NextResponse } from "next/server";
import { SOUNDBOARD_URL } from "@/lib/soundboard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

// GET /api/soundboard/audio/<key> — proxy a clip from Soundboard (Range passes through).
export async function GET(req: NextRequest, ctx: Ctx) {
  const { key } = await ctx.params;
  if (!/^[A-Za-z0-9-]+\.[A-Za-z0-9]+$/.test(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  const range = req.headers.get("range");
  const upstream = await fetch(`${SOUNDBOARD_URL}/api/audio/${encodeURIComponent(key)}`, {
    headers: range ? { range } : {},
    cache: "no-store",
  });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "private, max-age=3600");
  return new Response(upstream.body, { status: upstream.status, headers });
}
