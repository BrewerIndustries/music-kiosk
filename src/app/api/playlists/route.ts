import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/spotify";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

type SpPlaylist = { uri: string; name: string; images: { url: string }[] | null; tracks?: { total: number }; items?: { total: number } };

// GET /api/playlists — the user's playlists, for picking the backdrop.
export function GET(req: NextRequest) {
  return adminRoute(req, async () => {
    const out: { uri: string; name: string; image: string | null; total: number }[] = [];
    for (let offset = 0; offset < 200; offset += 50) {
      const page = await api<{ items: SpPlaylist[]; next: string | null }>("GET", "/me/playlists", undefined, {
        limit: "50",
        offset: String(offset),
      });
      for (const p of page?.items ?? [])
        if (p)
          out.push({
            uri: p.uri,
            name: p.name,
            image: p.images?.[p.images.length - 1]?.url ?? null,
            total: p.tracks?.total ?? p.items?.total ?? 0,
          });
      if (!page?.next) break;
    }
    return NextResponse.json({ playlists: out });
  });
}
