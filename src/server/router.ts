// Maps /api/* paths to the route modules (same files and handlers they were as
// Next.js route handlers; `next/server` is aliased to ./next-shim).
import { NextRequest, NextResponse } from "next/server";
import * as clipDone from "./routes/clip-done/route";
import * as devices from "./routes/devices/route";
import * as errors from "./routes/errors/route";
import * as guestInfo from "./routes/guest/info/route";
import * as guestQueue from "./routes/guest/queue/route";
import * as guestRequest from "./routes/guest/request/route";
import * as guestSearch from "./routes/guest/search/route";
import * as importData from "./routes/import/route";
import * as player from "./routes/player/route";
import * as playlists from "./routes/playlists/route";
import * as qr from "./routes/qr/route";
import * as queueItem from "./routes/queue/[id]/route";
import * as queue from "./routes/queue/route";
import * as search from "./routes/search/route";
import * as settings from "./routes/settings/route";
import * as sbAudio from "./routes/soundboard/audio/[key]/route";
import * as sbBoards from "./routes/soundboard/boards/route";
import * as spCallback from "./routes/spotify/callback/route";
import * as spLogin from "./routes/spotify/login/route";
import * as spLogout from "./routes/spotify/logout/route";
import * as spToken from "./routes/spotify/token/route";
import * as state from "./routes/state/route";
import * as auth from "./routes/auth/[action]/route";
import * as users from "./routes/users/route";
import * as user from "./routes/users/[id]/route";
import * as userResend from "./routes/users/[id]/resend/route";
import * as youtube from "./routes/youtube/[action]/route";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "PUT" | "DELETE", Handler>>;

// Path patterns; `:name` is one path segment.
const table: [string, unknown][] = [
  ["/api/clip-done", clipDone],
  ["/api/devices", devices],
  ["/api/errors", errors],
  ["/api/guest/info", guestInfo],
  ["/api/guest/queue", guestQueue],
  ["/api/guest/request", guestRequest],
  ["/api/guest/search", guestSearch],
  ["/api/import", importData],
  ["/api/player", player],
  ["/api/playlists", playlists],
  ["/api/qr", qr],
  ["/api/queue/:id", queueItem],
  ["/api/queue", queue],
  ["/api/search", search],
  ["/api/settings", settings],
  ["/api/soundboard/audio/:key", sbAudio],
  ["/api/soundboard/boards", sbBoards],
  ["/api/spotify/callback", spCallback],
  ["/api/spotify/login", spLogin],
  ["/api/spotify/logout", spLogout],
  ["/api/spotify/token", spToken],
  ["/api/state", state],
  ["/api/auth/:action", auth],
  ["/api/users/:id/resend", userResend],
  ["/api/users/:id", user],
  ["/api/users", users],
  ["/api/youtube/:action", youtube],
];

const routes = table.map(([pattern, mod]) => {
  const names: string[] = [];
  const re = new RegExp(
    "^" + pattern.replace(/:(\w+)/g, (_, n: string) => (names.push(n), "([^/]+)")) + "/?$",
  );
  return { re, names, mod: mod as RouteModule };
});

export async function route(request: Request): Promise<Response> {
  const req = new NextRequest(request);
  const path = req.nextUrl.pathname;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    const handler = r.mod[req.method as keyof RouteModule];
    if (!handler) return NextResponse.json({ error: "method not allowed" }, { status: 405 });
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    return handler(req, { params: Promise.resolve(params) });
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
