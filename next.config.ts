import type { NextConfig } from "next";

// Production builds are a static export (out/) served by the Worker's static
// assets; the API is the Worker (src/server). In `next dev`, /api/* is proxied to
// `wrangler dev` on :8787 so the UI and API share one origin, as they do live.
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: "http://127.0.0.1:8787/api/:path*" }];
        },
        // Reached as 127.0.0.1 (Spotify's local redirect URI) and from phones on the LAN.
        allowedDevOrigins: ["127.0.0.1", "*.local", "192.168.*.*", "10.*.*.*"],
      }
    : { output: "export" as const, images: { unoptimized: true } }),
};

export default nextConfig;
