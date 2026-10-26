import type { Metadata, Viewport } from "next";
import { Mountains_of_Christmas } from "next/font/google";
import "./globals.css";
import { Christmas } from "@/components/Christmas";

// Self-hosted at build time, so the kiosk needs no font CDN at the party.
const festive = Mountains_of_Christmas({ weight: ["700"], subsets: ["latin"], variable: "--font-festive" });

export const metadata: Metadata = {
  title: "Music Kiosk",
  description: "Party jukebox: a Spotify playlist backdrop, an Up Next queue, guest requests and soundboard clips.",
  appleWebApp: { capable: true, title: "Music Kiosk", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06251a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={festive.variable}>
      <body>
        {children}
        <Christmas />
      </body>
    </html>
  );
}
