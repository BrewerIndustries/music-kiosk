import { NextRequest, NextResponse } from "next/server";
import { createUser, issueLinkToken, listUsers, normEmail, userByEmail, validEmail, type Role } from "@/lib/accounts";
import { ownerRoute } from "@/lib/auth";
import { sendLinkEmail } from "@/lib/mail";

// GET /api/users — everyone with an account (admins only).
export function GET(req: NextRequest) {
  return ownerRoute(req, () => NextResponse.json({ users: listUsers() }));
}

// POST /api/users { email, name, role } — invite someone. The invite link is also
// returned, so an admin can pass it on by hand if the email doesn't arrive.
export function POST(req: NextRequest) {
  return ownerRoute(req, async (me) => {
    const b = (await req.json()) as { email?: string; name?: string; role?: string };
    const email = normEmail(b.email);
    if (!validEmail(email)) return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
    if (userByEmail(email)) return NextResponse.json({ error: "That email already has an account." }, { status: 409 });
    const role: Role = b.role === "admin" ? "admin" : "member";
    const user = createUser(email, b.name ?? "", role);
    const link = `${req.nextUrl.origin}/invite?token=${issueLinkToken(user.id, "invite")}`;
    const emailed = await sendLinkEmail(email, "invite", link, me.name);
    return NextResponse.json({ user, emailed, link }, { status: 201 });
  });
}
