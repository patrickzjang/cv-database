import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { callJst } from "@/lib/jst-api";

interface UploadSku {
  skuId: string;
  skuName: string;
  barcode?: string;
  salePrice?: number;
}

interface UploadItem {
  goodsItem: {
    itemId: string;
    name: string;
    brandName?: string;
    price?: number;
  };
  goodsSkus: UploadSku[];
}

// POST: Upload/update products on e-commerce platforms via JST /api/Goods/Upload
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`upload-to-platform:post:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Missing or empty items array." }, { status: 400 });
    }

    const items: UploadItem[] = body.items;

    // Validate required fields
    for (const item of items) {
      if (!item.goodsItem?.itemId || !item.goodsItem?.name) {
        return NextResponse.json(
          { error: "Each item must have goodsItem with itemId and name." },
          { status: 400 },
        );
      }
      if (!Array.isArray(item.goodsSkus) || item.goodsSkus.length === 0) {
        return NextResponse.json(
          { error: "Each item must have at least one SKU in goodsSkus." },
          { status: 400 },
        );
      }
      for (const sku of item.goodsSkus) {
        if (!sku.skuId || !sku.skuName) {
          return NextResponse.json(
            { error: "Each SKU must have skuId and skuName." },
            { status: 400 },
          );
        }
      }
    }

    const results: { itemId: string; response: unknown }[] = [];
    const errors: { itemId: string; error: string }[] = [];

    for (const item of items) {
      try {
        const jstPayload = {
          goodsItem: {
            itemId: item.goodsItem.itemId,
            name: item.goodsItem.name,
            ...(item.goodsItem.brandName != null && { brandName: item.goodsItem.brandName }),
            ...(item.goodsItem.price != null && { price: item.goodsItem.price }),
          },
          goodsSkus: item.goodsSkus.map((sku) => ({
            skuId: sku.skuId,
            skuName: sku.skuName,
            ...(sku.barcode != null && { barcode: sku.barcode }),
            ...(sku.salePrice != null && { salePrice: sku.salePrice }),
          })),
        };

        const response = await callJst("/api/Goods/Upload", jstPayload);
        results.push({ itemId: item.goodsItem.itemId, response });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ itemId: item.goodsItem.itemId, error: message });
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      totalItems: items.length,
      results,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
