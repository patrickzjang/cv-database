import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";
import { callJst } from "@/lib/jst-api";

interface ComboDetail {
  SrcSkuId: string;
  SrcSkuQtyExpend: number;
}

interface ComboSet {
  ItemId: string;
  CombineId: string;
  Name: string;
  CostPrice?: number;
  SalePrice?: number;
  Barcode?: string;
  CombineDetails: ComboDetail[];
}

// GET: List combo/set products from local DB
export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`combo:get:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const url = new URL(req.url);
    const q = url.searchParams.get("q") || undefined;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(500, Number(url.searchParams.get("pageSize")) || 50));
    const from = (page - 1) * pageSize;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let query = supabase
      .schema("jst_raw")
      .from("products_raw")
      .select("*", { count: "planned" })
      .not("raw_json->combineDetails", "is", null)
      .order("updated_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (q) {
      query = query.or(`sku_id.ilike.%${q}%,raw_json->>name.ilike.%${q}%`);
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

// POST: Create/update combo set in JST via /api/SkuCombine/Save
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`combo:post:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.combos) || body.combos.length === 0) {
      return NextResponse.json({ error: "Missing or empty combos array." }, { status: 400 });
    }

    const combos: ComboSet[] = body.combos;

    // Validate required fields
    for (const combo of combos) {
      if (!combo.ItemId || !combo.CombineId || !combo.Name) {
        return NextResponse.json(
          { error: "Each combo must have ItemId, CombineId, and Name." },
          { status: 400 },
        );
      }
      if (!Array.isArray(combo.CombineDetails) || combo.CombineDetails.length === 0) {
        return NextResponse.json(
          { error: "Each combo must have at least one item in CombineDetails." },
          { status: 400 },
        );
      }
      for (const detail of combo.CombineDetails) {
        if (!detail.SrcSkuId || !detail.SrcSkuQtyExpend || detail.SrcSkuQtyExpend < 1) {
          return NextResponse.json(
            { error: "Each CombineDetail must have SrcSkuId and SrcSkuQtyExpend >= 1." },
            { status: 400 },
          );
        }
      }
    }

    const results: { comboId: string; response: unknown }[] = [];
    const errors: { comboId: string; error: string }[] = [];

    for (const combo of combos) {
      try {
        const jstPayload = {
          ItemId: combo.ItemId,
          CombineId: combo.CombineId,
          Name: combo.Name,
          ...(combo.CostPrice != null && { CostPrice: combo.CostPrice }),
          ...(combo.SalePrice != null && { SalePrice: combo.SalePrice }),
          ...(combo.Barcode != null && { Barcode: combo.Barcode }),
          CombineDetails: combo.CombineDetails.map((d) => ({
            SrcSkuId: d.SrcSkuId,
            SrcSkuQtyExpend: d.SrcSkuQtyExpend,
          })),
        };

        const response = await callJst("/api/SkuCombine/Save", jstPayload);
        results.push({ comboId: combo.CombineId, response });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ comboId: combo.CombineId, error: message });
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      totalCombos: combos.length,
      results,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
