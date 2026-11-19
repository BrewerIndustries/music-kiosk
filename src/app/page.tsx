import { Kiosk } from "@/components/Kiosk";

// Amber banner off prod: NEXT_PUBLIC_KIOSK_ENV is baked in per build (dev / local).
const env = process.env.NEXT_PUBLIC_KIOSK_ENV || null;

export default function Home() {
  return <Kiosk envLabel={env ? `${env} — not the live kiosk` : null} />;
}
