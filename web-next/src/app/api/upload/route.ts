import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";
import { createClient } from "@supabase/supabase-js";
import { getR2Client, R2_MAIN_IMAGES_BUCKET, mainImageKey } from "@/lib/r2";
import { PutObjectCommand } from "@aws-sdk/client-s3";

export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode: upload is temporarily disabled." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`upload:${ip}`, 20, 60_000)) {
      return NextResponse.json({ error: "Too many upload requests. Please wait 1 minute." }, { status: 429 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const sku = String(form.get("sku") || "").trim();
    const brand = String(form.get("brand") || "PAN").toUpperCase();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!sku) {
      return NextResponse.json({ error: "Missing VARIATION_SKU" }, { status: 400 });
    }
    const lower = file.name.toLowerCase();
    const isJpg = file.type === "image/jpeg" || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
    if (!isJpg) {
      return NextResponse.json({ error: "Only JPG allowed" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Over 5MB" }, { status: 400 });
    }

    // Validate SKU exists in sku_pricing
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: skuRows } = await sb
      .schema("core")
      .from("sku_pricing")
      .select("variation_sku")
      .eq("variation_sku", sku)
      .limit(1);

    if (!skuRows || skuRows.length === 0) {
      return NextResponse.json({ error: `VARIATION_SKU not found: ${sku}` }, { status: 404 });
    }

    // Upload to Cloudflare R2 (main-images folder)
    const key = mainImageKey(brand, sku, file.name);
    const r2 = getR2Client();
    const buffer = Buffer.from(await file.arrayBuffer());

    await r2.send(new PutObjectCommand({
      Bucket: R2_MAIN_IMAGES_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type || "image/jpeg",
    }));

    // Store reference in sku_pricing.product_images (or a dedicated column)
    // Update all items under this variation_sku
    const imageUrl = `r2://${R2_MAIN_IMAGES_BUCKET}/${key}`;

    return NextResponse.json({ ok: true, key, imageUrl, bucket: R2_MAIN_IMAGES_BUCKET });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
