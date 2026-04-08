import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { callJst } from "@/lib/jst-api";

interface GoodsSku {
  skuId: string;
  skuName: string;
  barcode?: string;
  salePrice?: number;
  costPrice?: number;
  weight?: number;
}

interface GoodsItem {
  itemId: string;
  name: string;
  brandName?: string;
  unit?: string;
  supplierName?: string;
  price?: number;
  costPrice?: number;
}

interface CreateProduct {
  goodsItem: GoodsItem;
  goodsSkus: GoodsSku[];
}

// POST: Create new product in JST ERP via /api/Goods/Create
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`create-in-jst:post:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.products) || body.products.length === 0) {
      return NextResponse.json({ error: "Missing or empty products array." }, { status: 400 });
    }

    const products: CreateProduct[] = body.products;

    // Validate required fields
    for (const product of products) {
      if (!product.goodsItem?.itemId || !product.goodsItem?.name) {
        return NextResponse.json(
          { error: "Each product must have goodsItem with itemId and name." },
          { status: 400 },
        );
      }
      if (!Array.isArray(product.goodsSkus) || product.goodsSkus.length === 0) {
        return NextResponse.json(
          { error: "Each product must have at least one SKU in goodsSkus." },
          { status: 400 },
        );
      }
      for (const sku of product.goodsSkus) {
        if (!sku.skuId || !sku.skuName) {
          return NextResponse.json(
            { error: "Each SKU must have skuId and skuName." },
            { status: 400 },
          );
        }
      }
    }

    const results: { product: string; response: unknown }[] = [];
    const errors: { product: string; error: string }[] = [];

    for (const product of products) {
      try {
        const jstPayload = {
          goodsItem: {
            itemId: product.goodsItem.itemId,
            name: product.goodsItem.name,
            ...(product.goodsItem.brandName != null && { brandName: product.goodsItem.brandName }),
            ...(product.goodsItem.unit != null && { unit: product.goodsItem.unit }),
            ...(product.goodsItem.supplierName != null && { supplierName: product.goodsItem.supplierName }),
            ...(product.goodsItem.price != null && { price: product.goodsItem.price }),
            ...(product.goodsItem.costPrice != null && { costPrice: product.goodsItem.costPrice }),
          },
          goodsSkus: product.goodsSkus.map((sku) => ({
            skuId: sku.skuId,
            skuName: sku.skuName,
            ...(sku.barcode != null && { barcode: sku.barcode }),
            ...(sku.salePrice != null && { salePrice: sku.salePrice }),
            ...(sku.costPrice != null && { costPrice: sku.costPrice }),
            ...(sku.weight != null && { weight: sku.weight }),
          })),
        };

        const response = await callJst("/api/Goods/Create", jstPayload);
        results.push({ product: product.goodsItem.itemId, response });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ product: product.goodsItem.itemId, error: message });
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      totalProducts: products.length,
      results,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
