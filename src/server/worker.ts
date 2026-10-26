// Cloudflare entry point. Static pages (the Next.js export in out/) are served by
// Workers Static Assets before this code runs; everything under /api/ comes here
// and goes to the one Kiosk Durable Object, which owns all state (SQLite) and runs
// the playback engine on alarms — so it keeps feeding Spotify even with no kiosk
// page open, and a single object means no two requests ever race on the queue.
import { DurableObject } from "cloudflare:workers";
import { attachStorage } from "@/lib/db";
import { bootstrap } from "@/lib/accounts";
import { ensureEngine, runTick, attachAlarms } from "@/lib/engine";
import { attachMailer } from "@/lib/mail";
import { attachSoundboard } from "@/lib/soundboard";
import { route } from "./router";

export interface Env {
  KIOSK: DurableObjectNamespace<KioskObject>;
  ASSETS: Fetcher;
  SOUNDBOARD?: Fetcher;
  EMAIL?: { send: (msg: unknown) => Promise<unknown> };
}

export class KioskObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    attachStorage(ctx.storage);
    bootstrap();
    attachMailer(env.EMAIL as Parameters<typeof attachMailer>[0]);
    attachSoundboard(env.SOUNDBOARD, process.env.SOUNDBOARD_TOKEN);
    attachAlarms((at) => void ctx.storage.setAlarm(at));
  }

  async fetch(request: Request): Promise<Response> {
    ensureEngine();
    return route(request);
  }

  async alarm() {
    ensureEngine();
    await runTick();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return env.KIOSK.get(env.KIOSK.idFromName("kiosk")).fetch(request);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
