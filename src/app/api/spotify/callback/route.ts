import { NextRequest, NextResponse } from "next/server";
import { clientConfig, exchangeCode } from "@/lib/spotify";
import { poke } from "@/lib/engine";

export const dynamic = "force-dynamic";

// GET /api/spotify/callback — Spotify redirects here after the user approves.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  // Back to the kiosk on the redirect URI's origin (nextUrl reports the bind address in dev).
  const home = new URL("/", clientConfig().redirectUri);
  if (p.get("error")) {
    home.searchParams.set("spotify_error", p.get("error")!);
    return NextResponse.redirect(home);
  }
  if (!p.get("code") || p.get("state") !== req.cookies.get("spotify_oauth_state")?.value) {
    home.searchParams.set("spotify_error", "state_mismatch");
    return NextResponse.redirect(home);
  }
  try {
    await exchangeCode(p.get("code")!);
  } catch (e) {
    home.searchParams.set("spotify_error", e instanceof Error ? e.message.slice(0, 200) : "token_exchange_failed");
  }
  poke();
  const res = NextResponse.redirect(home);
  res.cookies.delete("spotify_oauth_state");
  return res;
}
