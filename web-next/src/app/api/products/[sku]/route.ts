import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  requireServerConfig,
} from "@/lib/server-supabase";

// ─── PATCH /api/products/[sku] — update description ────────────────────────

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sku: string }> }
) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    requireServerConfig();

    const { sku } = await params;
    const variationSku = decodeURIComponent(sku).trim();
    const body = await req.json().catch(() => ({}));
    const brand = String(body.brand || "").toUpperCase();
    const description = body.description;

    if (typeof description !== "string") {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }

    // Update description in sku_pricing (single source of truth)
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { error } = await sb
      .schema("core")
      .from("sku_pricing")
      .update({ description })
      .eq("variation_sku", variationSku);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── GET /api/products/[sku] ────────────────────────────────────────────────

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sku: string }> }
) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json(
        { error: "Maintenance mode." },
        { status: 503 }
      );
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`product-detail:${ip}`, 60, 60_000))) {
      return NextResponse.json(
        { error: "Too many requests." },
        { status: 429 }
      );
    }

    requireServerConfig();

    const { sku } = await params;
    const variationSku = decodeURIComponent(sku).trim();

    if (!variationSku) {
      return NextResponse.json(
        { error: "Missing SKU parameter." },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ─── 1. All product data from sku_pricing (single source of truth from Google Sheet)
    const { data: pricingData, error: pricingError } = await supabase
      .schema("core")
      .from("sku_pricing")
      .select("*")
      .eq("variation_sku", variationSku)
      .order("item_sku", { ascending: true });

    if (pricingError) {
      console.warn("[product-detail] Pricing error:", pricingError.message);
    }
    const pricing = (pricingData || []) as Record<string, unknown>[];

    // Build masterRows from sku_pricing for backward compatibility with frontend
    const detectedBrand = pricing.length > 0 ? String(pricing[0].brand || "") : "";
    const masterRows = pricing.map((r) => ({
      ITEM_SKU: r.item_sku,
      VARIATION_SKU: r.variation_sku,
      PARENTS_SKU: r.parents_sku,
      BRAND: r.brand,
      DESCRIPTION: r.description,
      UPC: r.upc ?? "",
      "Price Tag": r.price_tag ?? r.rrp,
      "COGs (Inc.Vat)": r.cogs_inc_vat,
      Category: r.group_code,
      Collection: null,
    }));

    const itemSkus = pricing
      .map((r) => String(r.item_sku || ""))
      .filter(Boolean);

    // ─── 2. Platform mappings ──────────────────────────────────────────────
    let platformMappings: Record<string, unknown>[] = [];
    if (itemSkus.length > 0) {
      const { data: pmData, error: pmError } = await supabase
        .schema("core")
        .from("platform_sku_mapping")
        .select("*")
        .in("item_sku", itemSkus)
        .order("platform", { ascending: true });

      if (pmError) {
        console.warn("[product-detail] Platform mapping error:", pmError.message);
      }
      platformMappings = (pmData || []) as Record<string, unknown>[];
    }

    // ─── 4. DAM assets ─────────────────────────────────────────────────────
    const { data: damData, error: damError } = await supabase
      .schema("dam")
      .from("assets")
      .select("*")
      .eq("sku", variationSku)
      .order("created_at", { ascending: false });

    if (damError) {
      console.warn("[product-detail] DAM error:", damError.message);
    }
    const damAssets = (damData || []) as Record<string, unknown>[];

    // ─── 5. Inventory ──────────────────────────────────────────────────────
    const { data: invData, error: invError } = await supabase
      .schema("jst_raw")
      .from("inventory_raw")
      .select("*")
      .or(`sku_code.ilike.${variationSku}%,sku_id.ilike.${variationSku}%`);

    if (invError) {
      console.warn("[product-detail] Inventory error:", invError.message);
    }
    const inventory = (invData || []) as Record<string, unknown>[];

    // ─── 6. Order history (recent 30 days) ─────────────────────────────────
    let salesSummary = {
      total_qty: 0,
      total_revenue: 0,
      order_count: 0,
      avg_daily: 0,
    };

    try {
      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: orderData, error: orderError } = await supabase
        .schema("jst_raw")
        .from("order_details_raw")
        .select("order_items_raw, order_date, so_amount")
        .gte("order_date", thirtyDaysAgo);

      if (orderError) {
        console.warn("[product-detail] Order error:", orderError.message);
      } else if (orderData) {
        let totalQty = 0;
        let totalRevenue = 0;
        const orderIds = new Set<string>();

        for (const order of orderData) {
          const items = order.order_items_raw;
          if (!Array.isArray(items)) continue;

          for (const item of items) {
            const skuCode = String(item?.skuCode || item?.sku_code || "");
            if (skuCode.startsWith(variationSku)) {
              const qty = Number(item?.qty || item?.quantity || 0);
              const amount = Number(
                item?.itemAmount || item?.item_amount || item?.amount || 0
              );
              totalQty += qty;
              totalRevenue += amount;
              orderIds.add(String(order.order_date || Math.random()));
            }
          }
        }

        salesSummary = {
          total_qty: totalQty,
          total_revenue: totalRevenue,
          order_count: orderIds.size,
          avg_daily: Math.round((totalQty / 30) * 100) / 100,
        };
      }
    } catch (err) {
      console.warn("[product-detail] Sales aggregation error:", err);
    }

    // ─── 7. JST product data ───────────────────────────────────────────────
    const { data: jstData, error: jstError } = await supabase
      .schema("jst_raw")
      .from("products_raw")
      .select("*")
      .or(
        `sku_code.ilike.${variationSku}%,sku_id.ilike.${variationSku}%`
      );

    if (jstError) {
      console.warn("[product-detail] JST products error:", jstError.message);
    }
    const jstProducts = (jstData || []) as Record<string, unknown>[];

    // ─── Response ──────────────────────────────────────────────────────────
    return NextResponse.json({
      variation_sku: variationSku,
      brand: detectedBrand,
      masterRows,
      pricing,
      platformMappings,
      damAssets,
      inventory,
      salesSummary,
      jstProducts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[product-detail] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
