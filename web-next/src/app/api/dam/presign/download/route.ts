import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getDownloadPresignedUrl } from "@/lib/r2";
import { getAsset, logEvent } from "@/lib/dam-db";

/**
 * POST /api/dam/presign/download
 * Body: { assetId, type: "raw"|"web" }
 * Returns: { url }  — expires in 1 hour
 *
 * Logs a download event on the asset.
 */
export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body  = await req.json();
    const { assetId, type = "raw" } = body;

    if (!assetId) return NextResponse.json({ error: "assetId is required" }, { status: 400 });

    const asset = await getAsset(assetId);
    if (!asset)  return NextResponse.json({ error: "Asset not found" }, { status: 404 });

    let bucket: string | null;
    let key:    string | null;
    let filename: string | null;

    if (type === "web") {
      bucket   = asset.web_bucket;
      key      = asset.web_path;
      filename = key?.split("/").pop() ?? null;
    } else {
      bucket   = asset.raw_bucket;
      key      = asset.raw_path;
      filename = asset.raw_filename;
    }

    if (!bucket || !key) {
      return NextResponse.json({ error: `No ${type} file available` }, { status: 404 });
    }

    const url = await getDownloadPresignedUrl(bucket, key, filename ?? undefined);

    await logEvent(assetId, `downloaded_${type}`, body._actor ?? null, { key });

    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
