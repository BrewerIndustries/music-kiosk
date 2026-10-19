import { Kiosk } from "@/components/Kiosk";

export const dynamic = "force-dynamic";

export default function Home() {
  // Amber banner off prod (JARVIS_ENV=dev on the server, or local `next dev`).
  const env = process.env.JARVIS_ENV ?? (process.env.NODE_ENV === "development" ? "local" : null);
  return <Kiosk envLabel={env ? `${env} — not the live kiosk` : null} />;
}
