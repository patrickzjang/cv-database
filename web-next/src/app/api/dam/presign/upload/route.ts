import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getUploadPresignedUrl, R2_RAW_BUCKET, R2_WEB_BUCKET, rawKey, webKey } from "@/lib/r2";

/**
 * POST /api/dam/presign/upload
 * Body: { bucket: "raw"|"web", brand, sku, filename, contentType }
 * Returns: { url, key, bucket }
 *
 * The browser then PUTs the file directly to the returned URL.
 */
export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { bucket: bucketType, brand, sku, filename, contentType } = body;

    if (!brand || !sku || !filename || !contentType) {
      return NextResponse.json({ error: "brand, sku, filename and contentType are required" }, { status: 400 });
    }

    const bucket = bucketType === "web" ? R2_WEB_BUCKET : R2_RAW_BUCKET;
    const key    = bucketType === "web"
      ? webKey(brand, sku, filename)
      : rawKey(brand, sku, filename);

    const url = await getUploadPresignedUrl(bucket, key, contentType);
    return NextResponse.json({ url, key, bucket });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
