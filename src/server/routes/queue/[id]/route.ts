import { NextRequest, NextResponse } from "next/server";
import { approve, move, removeItem, setStatus } from "@/lib/queue";
import { playNow, poke } from "@/lib/engine";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/queue/<id> { action: "up" | "down" | "playNow" | "approve" | "reject" }
export function PATCH(req: NextRequest, ctx: Ctx) {
  return adminRoute(req, async () => {
    const { id } = await ctx.params;
    const { action } = (await req.json()) as { action?: string };
    if (action === "up" || action === "down") move(id, action);
    else if (action === "playNow") await playNow(id);
    else if (action === "approve") approve(id);
    else if (action === "reject") setStatus(id, "rejected");
    else return NextResponse.json({ error: "unknown action" }, { status: 400 });
    poke();
    return NextResponse.json({ ok: true });
  });
}

// DELETE /api/queue/<id> — remove from Up Next (not once handed to Spotify).
export function DELETE(req: NextRequest, ctx: Ctx) {
  return adminRoute(req, async () => {
    removeItem((await ctx.params).id);
    return NextResponse.json({ ok: true });
  });
}
