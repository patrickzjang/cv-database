import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";
import { getR2Client, R2_MAIN_IMAGES_BUCKET, R2_MAIN_IMAGES_PREFIX } from "@/lib/r2";
import { PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * POST /api/main-images/migrate
 * Migrate all product images from Supabase Storage (product-images bucket) to Cloudflare R2 (main-images folder)
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`migrate:${getClientIp(req)}`, 1, 300_000); // 1 per 5 min
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  const BUCKET = "product-images";
  const r2 = getR2Client();

  try {
    let migrated = 0;
    let errors = 0;

    // List all folders (brands) in product-images bucket
    const brandListRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: "", limit: 100 }),
    });
    const brandFolders = await brandListRes.json();

    for (const brandFolder of brandFolders) {
      if (!brandFolder.name || brandFolder.name.startsWith(".")) continue;
      const brand = brandFolder.name;

      // List SKU folders under this brand
      const skuListRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefix: `${brand}/`, limit: 10000 }),
      });
      const skuFolders = await skuListRes.json();

      for (const skuFolder of skuFolders) {
        if (!skuFolder.name || skuFolder.name.startsWith(".")) continue;
        const sku = skuFolder.name;

        // List files under this SKU
        const fileListRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prefix: `${brand}/${sku}/`, limit: 100 }),
        });
        const files = await fileListRes.json();

        for (const file of files) {
          if (!file.name || file.id === undefined) continue; // skip folders
          const filename = file.name;
          const supaPath = `${brand}/${sku}/${filename}`;

          try {
            // Download from Supabase Storage
            const downloadRes = await fetch(
              `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${supaPath}`,
              {
                headers: {
                  apikey: SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                },
              },
            );
            if (!downloadRes.ok) { errors++; continue; }

            const buffer = Buffer.from(await downloadRes.arrayBuffer());

            // Upload to R2
            const r2Key = `${R2_MAIN_IMAGES_PREFIX}/${brand}/${sku}/${filename}`;
            await r2.send(new PutObjectCommand({
              Bucket: R2_MAIN_IMAGES_BUCKET,
              Key: r2Key,
              Body: buffer,
              ContentType: file.metadata?.mimetype || "image/jpeg",
            }));

            migrated++;
          } catch {
            errors++;
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      migrated,
      errors,
      destination: `r2://${R2_MAIN_IMAGES_BUCKET}/${R2_MAIN_IMAGES_PREFIX}/`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
