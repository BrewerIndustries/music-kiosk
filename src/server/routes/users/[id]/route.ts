import { NextRequest, NextResponse } from "next/server";
import { deleteUser, getUser, updateUser, type Role } from "@/lib/accounts";
import { ownerRoute } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/users/<id> { role?, disabled?, name? }
export function PATCH(req: NextRequest, ctx: Ctx) {
  return ownerRoute(req, async () => {
    const { id } = await ctx.params;
    const b = (await req.json()) as { role?: string; disabled?: boolean; name?: string };
    const err = updateUser(id, {
      role: b.role === "admin" || b.role === "member" ? (b.role as Role) : undefined,
      disabled: typeof b.disabled === "boolean" ? b.disabled : undefined,
      name: typeof b.name === "string" ? b.name : undefined,
    });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    return NextResponse.json({ user: getUser(id) });
  });
}

// DELETE /api/users/<id>
export function DELETE(req: NextRequest, ctx: Ctx) {
  return ownerRoute(req, async () => {
    const err = deleteUser((await ctx.params).id);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    return NextResponse.json({ ok: true });
  });
}
