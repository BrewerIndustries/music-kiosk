// The slice of `next/server` the API routes use (NextRequest.nextUrl/cookies,
// NextResponse.json/redirect, response cookies), for running those routes inside
// the Worker. wrangler aliases `next/server` to this file (wrangler.jsonc), so the
// route files keep their Next.js imports and types.

type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  maxAge?: number;
  path?: string;
};

function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) map.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return map;
}

export class NextRequest extends Request {
  readonly nextUrl: URL;
  readonly cookies: { get(name: string): { name: string; value: string } | undefined };

  constructor(input: Request) {
    super(input);
    this.nextUrl = new URL(input.url);
    const jar = parseCookies(input.headers.get("cookie"));
    this.cookies = {
      get: (name) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    };
  }
}

function serializeCookie(name: string, value: string, o: CookieOptions = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? "/"}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
  if (o.httpOnly) parts.push("HttpOnly");
  // Always Secure on Cloudflare (HTTPS only); wrangler dev on http://127.0.0.1 still accepts it.
  if (o.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${(o.sameSite ?? "lax").replace(/^./, (c) => c.toUpperCase())}`);
  return parts.join("; ");
}

export class NextResponse extends Response {
  readonly cookies = {
    set: (name: string, value: string, o?: CookieOptions) => {
      this.headers.append("set-cookie", serializeCookie(name, value, o));
    },
    delete: (name: string) => {
      this.headers.append("set-cookie", serializeCookie(name, "", { maxAge: 0 }));
    },
  };

  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }

  static redirect(url: string | URL, status = 307): NextResponse {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }
}
