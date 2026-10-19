import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSettings, guestBase } from "@/lib/settings";

// The origin the browser used (nextUrl reports the bind address, e.g. 0.0.0.0, in dev).
function requestOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/qr — the guest request link and its QR code (SVG markup).
export function GET(req: NextRequest) {
  return adminRoute(req, async () => {
    const url = `${guestBase(requestOrigin(req))}/request?code=${getSettings().partyCode}`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return NextResponse.json({ url, svg });
  });
}
