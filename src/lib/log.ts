// Error log: every failure goes to the server console (journald on the server) and
// into a small in-memory ring the kiosk shows under Settings ▸ Recent errors.
export type LoggedError = { at: string; where: string; message: string; detail?: string };

const MAX = 30;
const g = globalThis as unknown as { _kioskErrors?: LoggedError[] };

export function logError(where: string, err: unknown, detail?: string) {
  const message = err instanceof Error ? err.message : String(err);
  const entry: LoggedError = { at: new Date().toISOString(), where, message, detail };
  console.error(`[kiosk] ${entry.at} ${where}: ${message}${detail ? ` (${detail})` : ""}`);
  const ring = (g._kioskErrors ??= []);
  ring.unshift(entry);
  ring.length = Math.min(ring.length, MAX);
}

export function recentErrors(): LoggedError[] {
  return g._kioskErrors ?? [];
}

export function clearErrors() {
  g._kioskErrors = [];
}
