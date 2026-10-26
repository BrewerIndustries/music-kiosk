import { NextRequest, NextResponse } from "next/server";
import {
  allow,
  checkLogin,
  consumeLinkToken,
  createSession,
  endSession,
  getUser,
  issueLinkToken,
  MIN_PASSWORD,
  normEmail,
  peekLinkToken,
  revokeSessions,
  SESSION_COOKIE,
  sessionCookie,
  setPassword,
  userByEmail,
} from "@/lib/accounts";
import { currentUser, handle } from "@/lib/auth";
import { sendLinkEmail } from "@/lib/mail";
import { clientIp } from "@/lib/guest";

type Ctx = { params: Promise<{ action: string }> };

const tooMany = () =>
  NextResponse.json({ error: "Too many attempts — wait a few minutes and try again." }, { status: 429 });

const signedIn = (token: string, body: unknown) => {
  const res = NextResponse.json(body);
  res.cookies.set(SESSION_COOKIE, token, sessionCookie);
  return res;
};

// GET /api/auth/me — who's signed in (null if nobody).
// GET /api/auth/link?token= — what a set-password link is for (and whether it's still good).
export function GET(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { action } = await ctx.params;
    if (action === "me") return NextResponse.json({ user: currentUser(req) });
    if (action === "link") {
      const info = peekLinkToken(req.nextUrl.searchParams.get("token") ?? "");
      return info
        ? NextResponse.json({ ok: true, ...info })
        : NextResponse.json({ ok: false, error: "This link has expired or was already used." }, { status: 410 });
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }, req);
}

// POST /api/auth/login { email, password }
// POST /api/auth/logout
// POST /api/auth/forgot { email }          — always the same answer (no account probing)
// POST /api/auth/set-password { token, password }   — from an invite or reset link
// POST /api/auth/change-password { current, password }
export function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const { action } = await ctx.params;
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ip = clientIp(req);
    const password = typeof b.password === "string" ? b.password : "";

    if (action === "login") {
      const email = normEmail(b.email);
      if (!allow(`login-ip:${ip}`, 20) || !allow(`login:${email}`, 10)) return tooMany();
      const user = await checkLogin(email, password);
      if (!user) return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
      return signedIn(createSession(user.id), { user });
    }

    if (action === "logout") {
      endSession(req.cookies.get(SESSION_COOKIE)?.value);
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }

    if (action === "forgot") {
      const email = normEmail(b.email);
      if (!allow(`forgot-ip:${ip}`, 10) || !allow(`forgot:${email}`, 3)) return tooMany();
      const user = email ? userByEmail(email) : null;
      if (user && !user.disabled) {
        const link = `${req.nextUrl.origin}/reset?token=${issueLinkToken(user.id, "reset")}`;
        await sendLinkEmail(user.email, "reset", link);
      }
      return NextResponse.json({ ok: true, message: "If that email has an account, a reset link is on its way." });
    }

    if (action === "set-password") {
      if (!allow(`set-ip:${ip}`, 20)) return tooMany();
      if (password.length < MIN_PASSWORD)
        return NextResponse.json({ error: `Use at least ${MIN_PASSWORD} characters.` }, { status: 400 });
      const link = consumeLinkToken(typeof b.token === "string" ? b.token : "");
      const user = link && getUser(link.userId);
      if (!user || user.disabled)
        return NextResponse.json({ error: "This link has expired or was already used." }, { status: 410 });
      await setPassword(user.id, password);
      revokeSessions(user.id); // a reset signs every other device out
      return signedIn(createSession(user.id), { user: getUser(user.id) });
    }

    if (action === "change-password") {
      const me = currentUser(req);
      if (!me) return NextResponse.json({ error: "signed out" }, { status: 401 });
      if (!allow(`change:${me.id}`, 10)) return tooMany();
      if (!(await checkLogin(me.email, typeof b.current === "string" ? b.current : "")))
        return NextResponse.json({ error: "Your current password is wrong." }, { status: 400 });
      if (password.length < MIN_PASSWORD)
        return NextResponse.json({ error: `Use at least ${MIN_PASSWORD} characters.` }, { status: 400 });
      await setPassword(me.id, password);
      revokeSessions(me.id, req.cookies.get(SESSION_COOKIE)?.value); // keep this device signed in
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "not found" }, { status: 404 });
  }, req);
}
