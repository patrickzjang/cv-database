import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getR2Client, R2_MAIN_IMAGES_BUCKET, R2_MAIN_IMAGES_PREFIX, getDownloadPresignedUrl } from "@/lib/r2";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

/**
 * GET /api/main-images?sku=VARIATION_SKU&brand=DB
 * List main product images for a VARIATION_SKU from R2
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`main-img:${getClientIp(req)}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  const url = new URL(req.url);
  const sku = url.searchParams.get("sku") || "";
  const brand = (url.searchParams.get("brand") || "").toUpperCase();

  if (!sku) return NextResponse.json({ error: "sku required" }, { status: 400 });

  try {
    const r2 = getR2Client();
    const prefix = brand
      ? `${R2_MAIN_IMAGES_PREFIX}/${brand}/${sku}/`
      : `${R2_MAIN_IMAGES_PREFIX}/`;

    const listRes = await r2.send(new ListObjectsV2Command({
      Bucket: R2_MAIN_IMAGES_BUCKET,
      Prefix: prefix,
      MaxKeys: 100,
    }));

    const files = (listRes.Contents ?? []).map((obj) => ({
      key: obj.Key,
      filename: obj.Key?.split("/").pop() ?? "",
      size: obj.Size,
      lastModified: obj.LastModified?.toISOString(),
    }));

    // Generate presigned URLs for each image
    const images = await Promise.all(
      files.map(async (f) => ({
        ...f,
        url: await getDownloadPresignedUrl(R2_MAIN_IMAGES_BUCKET, f.key!, undefined, 3600),
      }))
    );

    return NextResponse.json({ images, count: images.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
