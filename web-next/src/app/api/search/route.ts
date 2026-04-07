import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";
import { createClient } from "@supabase/supabase-js";

type SearchPayload = {
  brand?: string;
  query?: string;
  pageSize?: number;
  currentPage?: number;
};

export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode: search is temporarily disabled." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`search:${ip}`, 120, 60_000)) {
      return NextResponse.json({ error: "Too many search requests. Please slow down." }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as SearchPayload;
    const brand = String(body.brand || "PAN").toUpperCase();
    const query = String(body.query || "").trim();
    const pageSize = Math.max(1, Math.min(1000, Number(body.pageSize) || 100));
    const currentPage = Math.max(1, Number(body.currentPage) || 1);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Get unique variation_skus with filters (paginated)
    const allVarSet = new Set<string>();
    let varOffset = 0;
    while (true) {
      let q = sb.schema("core").from("sku_pricing")
        .select("variation_sku")
        .range(varOffset, varOffset + 999);

      // Brand filter
      if (brand === "PAN") q = q.in("brand", ["JN", "PN", "PAN"]);
      else q = q.eq("brand", brand === "DAYBREAK" ? "DB" : brand === "HEELCARE" ? "HC" : brand === "ARENA" ? "AN" : brand);

      // Search filter
      if (query) q = q.or(`variation_sku.ilike.%${query}%,item_sku.ilike.%${query}%,description.ilike.%${query}%`);

      const { data: batch } = await q;
      if (!batch || batch.length === 0) break;
      for (const r of batch) allVarSet.add(r.variation_sku);
      if (batch.length < 1000) break;
      varOffset += 1000;
    }

    const uniqueVars = [...allVarSet].sort();
    const total = uniqueVars.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    // Step 2: Get page of variations
    const from = (currentPage - 1) * pageSize;
    const pageVars = uniqueVars.slice(from, from + pageSize);

    if (pageVars.length === 0) {
      return NextResponse.json({ rows: [], total, pageCount, shown: 0 });
    }

    // Step 3: Fetch all items for these variations
    const rows: any[] = [];
    const chunkSize = 100;
    for (let i = 0; i < pageVars.length; i += chunkSize) {
      const chunk = pageVars.slice(i, i + chunkSize);
      let rowOffset = 0;
      while (true) {
        const { data: batch } = await sb.schema("core").from("sku_pricing")
          .select("*")
          .in("variation_sku", chunk)
          .order("variation_sku")
          .order("item_sku")
          .range(rowOffset, rowOffset + 999);
        if (!batch || batch.length === 0) break;
        rows.push(...batch);
        if (batch.length < 1000) break;
        rowOffset += 1000;
      }
    }

    // Map to expected format for frontend (VARIATION_SKU column name)
    const mappedRows = rows.map((r) => ({
      BRAND: r.brand,
      GROUP: r.group_code,
      PARENTS_SKU: r.parents_sku,
      VARIATION_SKU: r.variation_sku,
      ITEM_SKU: r.item_sku,
      DESCRIPTION: r.description,
      "Price Tag": r.price_tag ?? r.rrp,
    }));

    return NextResponse.json({
      rows: mappedRows,
      total,
      pageCount,
      shown: pageVars.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
