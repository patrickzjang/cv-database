import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getR2Client, R2_MAIN_IMAGES_BUCKET, R2_MAIN_IMAGES_PREFIX, getDownloadPresignedUrl } from "@/lib/r2";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

// Brand code → folder name
const BRAND_FOLDER: Record<string, string> = {
  PN: "PAN", JN: "PAN", PAN: "PAN",
  DB: "DAYBREAK", DAYBREAK: "DAYBREAK",
  HC: "HEELCARE", HEELCARE: "HEELCARE",
  AN: "ARENA", ARENA: "ARENA",
};

/**
 * POST /api/main-images/batch
 * Body: { skus: [{ sku, brand }] }
 * Returns: { images: { [sku]: [{ filename, url }] } }
 *
 * Single request to get images for multiple SKUs at once.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`main-img-batch:${getClientIp(req)}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  try {
    const { skus } = await req.json();
    if (!Array.isArray(skus) || skus.length === 0)
      return NextResponse.json({ images: {} });

    const r2 = getR2Client();
    const result: Record<string, { filename: string; url: string }[]> = {};

    // Group by brand folder to minimize R2 list calls
    const brandSkuMap = new Map<string, string[]>();
    for (const { sku, brand } of skus) {
      const folder = BRAND_FOLDER[(brand || "").toUpperCase()] ?? (brand || "").toUpperCase();
      if (!brandSkuMap.has(folder)) brandSkuMap.set(folder, []);
      brandSkuMap.get(folder)!.push(sku);
    }

    // For each brand folder, list all objects once then filter by SKU
    for (const [folder, skuList] of brandSkuMap) {
      // List all objects under this brand folder
      const prefix = `${R2_MAIN_IMAGES_PREFIX}/${folder}/`;
      let allObjects: any[] = [];
      let continuationToken: string | undefined;

      do {
        const listRes = await r2.send(new ListObjectsV2Command({
          Bucket: R2_MAIN_IMAGES_BUCKET,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }));
        if (listRes.Contents) allObjects.push(...listRes.Contents);
        continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
      } while (continuationToken);

      // Match objects to requested SKUs
      for (const sku of skuList) {
        const skuPrefix = `${prefix}${sku}/`;
        const matched = allObjects.filter((o) => o.Key?.startsWith(skuPrefix));

        if (matched.length > 0) {
          result[sku] = await Promise.all(
            matched.map(async (o) => ({
              key: o.Key,
              filename: o.Key?.split("/").pop() ?? "",
              url: await getDownloadPresignedUrl(R2_MAIN_IMAGES_BUCKET, o.Key!, undefined, 3600),
            }))
          );
        }
      }
    }

    return NextResponse.json({ images: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
