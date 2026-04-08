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
      // For video assets without R2 files, use Cloudflare Stream download URL
      if (asset.stream_uid && asset.asset_type === "video") {
        const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
        const STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_API_TOKEN || "";
        const dlUrl = `https://customer-${ACCOUNT_ID.slice(0, 20)}.cloudflarestream.com/${asset.stream_uid}/downloads/default.mp4`;
        // Try to get download URL from Stream API
        const streamRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${asset.stream_uid}/downloads`,
          { method: "POST", headers: { Authorization: `Bearer ${STREAM_TOKEN}` } }
        );
        const streamJson = await streamRes.json().catch(() => null);
        const streamDlUrl = streamJson?.result?.default?.url;
        await logEvent(assetId, `downloaded_stream`, body._actor ?? null, { stream_uid: asset.stream_uid });
        return NextResponse.json({ url: streamDlUrl || dlUrl });
      }
      return NextResponse.json({ error: `No ${type} file available` }, { status: 404 });
    }

    const url = await getDownloadPresignedUrl(bucket, key, filename ?? undefined);

    await logEvent(assetId, `downloaded_${type}`, body._actor ?? null, { key });

    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
