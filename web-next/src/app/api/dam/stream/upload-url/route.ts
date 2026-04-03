import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { createDirectUploadUrl } from "@/lib/cloudflare-stream";

/**
 * POST /api/dam/stream/upload-url
 * Body: { sku, brand, filename }
 * Returns: { uid, uploadURL }
 *
 * The browser then TUS-uploads or PUTs the video file directly to uploadURL.
 * CF Stream handles transcoding automatically.
 */
export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { sku, brand, filename } = body;

    if (!sku || !brand) {
      return NextResponse.json({ error: "sku and brand are required" }, { status: 400 });
    }

    const result = await createDirectUploadUrl({
      maxDurationSeconds: 7200,
      meta: { sku, brand, filename: filename ?? "" },
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
