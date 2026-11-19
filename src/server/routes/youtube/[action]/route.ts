import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  disconnectYouTube,
  ytAuthUrl,
  ytConfig,
  ytExchangeCode,
  ytPlaylistItems,
  ytPlaylists,
  ytSearch,
} from "@/lib/youtube";
import { adminRoute, denied, isAdmin } from "@/lib/auth";

type Ctx = { params: Promise<{ action: string }> };
const STATE_COOKIE = "yt_oauth_state";

// GET /api/youtube/login — start Google sign-in (read-only YouTube access).
// GET /api/youtube/callback — Google sends the browser back here.
// GET /api/youtube/search?q= · /api/youtube/playlists · /api/youtube/playlist?id=
export async function GET(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  const p = req.nextUrl.searchParams;

  if (action === "login") {
    if (!isAdmin(req)) return denied();
    if (!ytConfig().configured)
      return NextResponse.json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set" }, { status: 500 });
    const state = randomBytes(16).toString("hex");
    const res = NextResponse.redirect(ytAuthUrl(state));
    res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
    return res;
  }

  if (action === "callback") {
    const home = new URL("/", ytConfig().redirectUri);
    const fail = (why: string) => {
      home.searchParams.set("youtube_error", why);
      return NextResponse.redirect(home);
    };
    if (!isAdmin(req)) return fail("signed_out");
    if (p.get("error")) return fail(p.get("error")!);
    if (!p.get("code") || p.get("state") !== req.cookies.get(STATE_COOKIE)?.value) return fail("state_mismatch");
    try {
      await ytExchangeCode(p.get("code")!);
    } catch (e) {
      return fail(e instanceof Error ? e.message.slice(0, 200) : "token_exchange_failed");
    }
    home.searchParams.set("youtube", "connected");
    const res = NextResponse.redirect(home);
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  return adminRoute(req, async () => {
    if (action === "search") {
      const q = (p.get("q") ?? "").trim().slice(0, 100);
      return NextResponse.json({ videos: q ? await ytSearch(q) : [] });
    }
    if (action === "playlists") return NextResponse.json({ playlists: await ytPlaylists() });
    if (action === "playlist") {
      const id = p.get("id") ?? "";
      if (!/^[\w-]{2,64}$/.test(id)) return NextResponse.json({ error: "bad playlist id" }, { status: 400 });
      return NextResponse.json({ videos: await ytPlaylistItems(id) });
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  });
}

// POST /api/youtube/logout — forget the Google account.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  return adminRoute(req, () => {
    if (action !== "logout") return NextResponse.json({ error: "not found" }, { status: 404 });
    disconnectYouTube();
    return NextResponse.json({ ok: true });
  });
}
