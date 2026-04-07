import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getR2Client, R2_MAIN_IMAGES_BUCKET, R2_MAIN_IMAGES_PREFIX, getDownloadPresignedUrl } from "@/lib/r2";
import { ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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

  // Map brand codes to R2 folder names
  const BRAND_FOLDER: Record<string, string> = {
    PN: "PAN", JN: "PAN", PAN: "PAN",
    DB: "DAYBREAK", DAYBREAK: "DAYBREAK",
    HC: "HEELCARE", HEELCARE: "HEELCARE",
    AN: "ARENA", ARENA: "ARENA",
  };

  try {
    const r2 = getR2Client();
    const brandFolder = BRAND_FOLDER[brand] ?? brand;

    // Try brand folder first, also try brand code directly
    const prefixes = brand
      ? [`${R2_MAIN_IMAGES_PREFIX}/${brandFolder}/${sku}/`, `${R2_MAIN_IMAGES_PREFIX}/${brand}/${sku}/`]
      : [`${R2_MAIN_IMAGES_PREFIX}/`];
    const prefix = prefixes[0];

    // Search all possible prefixes (brand code + brand name)
    const allContents: any[] = [];
    for (const p of prefixes) {
      const listRes = await r2.send(new ListObjectsV2Command({
        Bucket: R2_MAIN_IMAGES_BUCKET,
        Prefix: p,
        MaxKeys: 100,
      }));
      if (listRes.Contents) allContents.push(...listRes.Contents);
    }

    // Deduplicate by key
    const seen = new Set<string>();
    const files = allContents
      .filter((obj) => { if (seen.has(obj.Key)) return false; seen.add(obj.Key); return true; })
      .map((obj) => ({
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

/**
 * DELETE /api/main-images?key=main-images/PAN/SKU/file.jpg
 * Delete a main image from R2
 */
export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`main-img-del:${getClientIp(req)}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (!key || !key.startsWith(R2_MAIN_IMAGES_PREFIX + "/")) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  try {
    const r2 = getR2Client();
    await r2.send(new DeleteObjectCommand({ Bucket: R2_MAIN_IMAGES_BUCKET, Key: key }));
    return NextResponse.json({ ok: true, deleted: key });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
