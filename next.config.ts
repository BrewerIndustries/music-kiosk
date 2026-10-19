import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // better-sqlite3 is a native module; keep it external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // The dev server is reached as 127.0.0.1 (Spotify's redirect URI) and from phones
  // on the LAN (guest QR page).
  allowedDevOrigins: ["127.0.0.1", "*.local", "192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
