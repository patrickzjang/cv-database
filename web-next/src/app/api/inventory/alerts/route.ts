import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`inv-alerts:${ip}`, 60, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const url = new URL(req.url);
    const brand = url.searchParams.get("brand") || undefined;
    const q = url.searchParams.get("q") || undefined;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let query = supabase
      .schema("core")
      .from("reorder_config")
      .select("*");

    if (brand) {
      query = query.eq("brand", brand);
    }
    if (q) {
      query = query.ilike("sku_code", `%${q}%`);
    }

    query = query.order("sku_code", { ascending: true });

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
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
    if (!(await checkRateLimit(`inv-alerts-write:${ip}`, 30, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.configs) || body.configs.length === 0) {
      return NextResponse.json(
        { error: "Body must include configs array with at least one entry." },
        { status: 400 }
      );
    }

    // Validate each config
    for (const cfg of body.configs) {
      if (!cfg.sku_code || typeof cfg.sku_code !== "string") {
        return NextResponse.json(
          { error: "Each config must have a sku_code string." },
          { status: 400 }
        );
      }
      if (typeof cfg.min_stock !== "number" || cfg.min_stock < 0) {
        return NextResponse.json(
          { error: `Invalid min_stock for ${cfg.sku_code}.` },
          { status: 400 }
        );
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const rows = body.configs.map((cfg: any) => ({
      sku_code: cfg.sku_code,
      brand: cfg.brand || null,
      min_stock: cfg.min_stock,
      reorder_qty: cfg.reorder_qty ?? 0,
      lead_days: cfg.lead_days ?? 0,
    }));

    const { data, error } = await supabase
      .schema("core")
      .from("reorder_config")
      .upsert(rows, { onConflict: "sku_code" })
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [], upserted: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
