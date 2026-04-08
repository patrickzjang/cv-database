import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

// GET: Get price change history
export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`pricing-history:get:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const url = new URL(req.url);
    const itemSku = url.searchParams.get("item_sku") || undefined;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(500, Number(url.searchParams.get("pageSize")) || 50));
    const from = (page - 1) * pageSize;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let query = supabase
      .schema("core")
      .from("sku_pricing_history")
      .select("*", { count: "planned" })
      .order("changed_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (itemSku) {
      query = query.eq("item_sku", itemSku);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const total = count ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      data: data ?? [],
      total,
      page,
      pageSize,
      pageCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
