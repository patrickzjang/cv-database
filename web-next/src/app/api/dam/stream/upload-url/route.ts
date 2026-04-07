import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_API_TOKEN || "";

/**
 * POST /api/dam/stream/upload-url
 * Body: { sku, brand, filename, fileSize }
 * Returns: { uid, uploadURL }
 *
 * Creates a TUS upload URL using Cloudflare Stream.
 * The browser then TUS-uploads the video directly.
 */
export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { sku, brand, filename, fileSize } = body;

    if (!sku || !brand) {
      return NextResponse.json({ error: "sku and brand are required" }, { status: 400 });
    }

    // Use TUS protocol to create upload — works with cfut_ upload tokens
    const nameB64 = Buffer.from(filename ?? "video.mp4").toString("base64");
    const metaB64 = Buffer.from(JSON.stringify({ sku, brand })).toString("base64");

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream?direct_user=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STREAM_TOKEN}`,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(fileSize || 0),
          "Upload-Metadata": `name ${nameB64},meta ${metaB64}`,
        },
      },
    );

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: `Stream upload: ${res.status} ${txt}` }, { status: res.status });
    }

    const location = res.headers.get("location") || "";
    // Extract UID from location header or stream-media-id
    const uid = res.headers.get("stream-media-id") || location.split("/").pop()?.split("?")[0] || "";

    return NextResponse.json({ uid, uploadURL: location });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
