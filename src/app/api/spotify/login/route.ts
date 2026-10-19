import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { clientConfig, SCOPES } from "@/lib/spotify";
import { isAdmin, denied } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/spotify/login — start the Spotify OAuth dance.
export function GET(req: NextRequest) {
  if (!isAdmin(req)) return denied();
  const { clientId, redirectUri, configured } = clientConfig();
  if (!configured) return NextResponse.json({ error: "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set" }, { status: 500 });
  const state = randomBytes(16).toString("hex");
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set("spotify_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
