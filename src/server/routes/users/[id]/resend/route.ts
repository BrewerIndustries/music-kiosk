import { NextRequest, NextResponse } from "next/server";
import { getUser, issueLinkToken } from "@/lib/accounts";
import { ownerRoute } from "@/lib/auth";
import { sendLinkEmail } from "@/lib/mail";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/users/<id>/resend — a fresh invite link (or a reset link, once they
// have a password). Returned too, for passing on by hand.
export function POST(req: NextRequest, ctx: Ctx) {
  return ownerRoute(req, async (me) => {
    const user = getUser((await ctx.params).id);
    if (!user) return NextResponse.json({ error: "No such user" }, { status: 404 });
    const kind = user.hasPassword ? "reset" : "invite";
    const link = `${req.nextUrl.origin}/${kind}?token=${issueLinkToken(user.id, kind)}`;
    const emailed = await sendLinkEmail(user.email, kind, link, me.name);
    return NextResponse.json({ emailed, link });
  });
}
