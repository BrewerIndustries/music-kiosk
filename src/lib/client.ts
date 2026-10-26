// Browser-side helpers shared by the kiosk and guest pages.
export async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  if (method !== "GET") kioskChanged();
  return json;
}

// Something changed (a control was used, or the browser player reported a new
// state): the kiosk page re-reads the server snapshot right away instead of
// waiting for its next poll.
export const KIOSK_CHANGED = "kiosk-changed";
export function kioskChanged(fromPlayer = false) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(KIOSK_CHANGED, { detail: { fromPlayer } }));
}

// Optimistic display: show what a tap will do before Spotify confirms it.
export const KIOSK_EXPECT = "kiosk-expect";
export type Expectation = { playing?: boolean; track?: { uri: string; title: string; subtitle: string; art: string | null; durationMs: number } };
export function expect(e: Expectation) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(KIOSK_EXPECT, { detail: e }));
}

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// iOS/iPadOS Safari (iPadOS reports itself as a Mac, so check for touch too).
export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Spotify's Web Playback SDK runs on desktop browsers only.
export function sdkSupported() {
  if (typeof navigator === "undefined") return false;
  return !isIOS() && !/Android|Mobile/i.test(navigator.userAgent);
}

export function toPlaylistUri(input: string): string | null {
  const s = input.trim();
  if (/^spotify:playlist:[A-Za-z0-9]{22}$/.test(s)) return s;
  const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})/.exec(s);
  return m ? `spotify:playlist:${m[1]}` : null;
}
