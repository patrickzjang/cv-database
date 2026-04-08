import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";
import { callJst } from "@/lib/jst-api";

export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`after-sales:${ip}`, 60, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const q = url.searchParams.get("q") || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10)));
    const dateFrom = url.searchParams.get("dateFrom") || undefined;
    const dateTo = url.searchParams.get("dateTo") || undefined;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Query JST raw after-sale orders
    let jstQuery = supabase
      .schema("jst_raw")
      .from("after_sale_orders_raw")
      .select("*");

    if (status) {
      jstQuery = jstQuery.eq("status", status);
    }
    if (q) {
      jstQuery = jstQuery.ilike("platform_order_id", `%${q}%`);
    }
    if (dateFrom) {
      jstQuery = jstQuery.gte("created_at", dateFrom);
    }
    if (dateTo) {
      jstQuery = jstQuery.lte("created_at", dateTo + "T23:59:59.999Z");
    }

    const { data: jstRows, error: jstError } = await jstQuery;

    // Query internal return requests
    let internalQuery = supabase
      .schema("core")
      .from("return_requests")
      .select("*");

    if (status) {
      internalQuery = internalQuery.eq("status", status);
    }
    if (q) {
      internalQuery = internalQuery.ilike("platform_order_id", `%${q}%`);
    }
    if (dateFrom) {
      internalQuery = internalQuery.gte("created_at", dateFrom);
    }
    if (dateTo) {
      internalQuery = internalQuery.lte("created_at", dateTo + "T23:59:59.999Z");
    }

    const { data: internalRows, error: internalError } = await internalQuery;

    if (jstError && internalError) {
      return NextResponse.json(
        { error: `JST: ${jstError.message}; Internal: ${internalError.message}` },
        { status: 500 }
      );
    }

    // Merge both sources and sort by date DESC
    const jstNormalized = (jstRows ?? []).map((r: any) => ({
      ...r,
      source: "jst",
      sort_date: r.created_at || r.order_date || "1970-01-01",
    }));

    const internalNormalized = (internalRows ?? []).map((r: any) => ({
      ...r,
      source: "internal",
      sort_date: r.created_at || "1970-01-01",
    }));

    const merged = [...jstNormalized, ...internalNormalized].sort(
      (a, b) => new Date(b.sort_date).getTime() - new Date(a.sort_date).getTime()
    );

    // Paginate
    const total = merged.length;
    const from = (page - 1) * pageSize;
    const paged = merged.slice(from, from + pageSize);

    return NextResponse.json({ data: paged, page, pageSize, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`after-sales-create:${ip}`, 10, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const {
      warehouse_id,
      shop_id,
      platform_order_id,
      order_id,
      after_sale_type,
      items,
      remark,
    } = body;

    if (!platform_order_id || !after_sale_type || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "platform_order_id, after_sale_type, and items are required." },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let jstResult = null;

    // Push to JST if warehouse_id and shop_id are provided
    if (warehouse_id && shop_id) {
      try {
        jstResult = await callJst("/api/AfterSaleOrder/CreateAfterSaleOrders", {
          warehouse_id,
          shop_id,
          platform_order_id,
          order_id: order_id || undefined,
          after_sale_type,
          items: items.map((item: any) => ({
            sku_id: item.sku_id,
            qty: item.qty,
            type: item.type,
            remark: item.remark || "",
          })),
          remark: remark || "",
        });
      } catch (jstErr) {
        // Log but don't fail — we still create the internal record
        console.error("[after-sales] JST push failed:", jstErr);
      }
    }

    // Create internal record
    const trackingCode = `RET-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const { data: insertedRow, error: insertError } = await supabase
      .schema("core")
      .from("return_requests")
      .insert({
        platform_order_id,
        after_sale_type,
        status: "pending",
        items,
        remark: remark || null,
        tracking_code: trackingCode,
        warehouse_id: warehouse_id || null,
        shop_id: shop_id || null,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      data: insertedRow,
      jst_result: jstResult,
      tracking_code: trackingCode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
