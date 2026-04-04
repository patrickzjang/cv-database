import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";
import { callJst, extractListFromData } from "@/lib/jst-api";

// GET: List suppliers (local cache first, fallback to JST)
export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`suppliers:get:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Try local cache first
    const { data: localData, error: localError } = await supabase
      .schema("jst_raw")
      .from("suppliers_raw")
      .select("*")
      .order("updated_at", { ascending: false });

    if (!localError && localData && localData.length > 0) {
      return NextResponse.json({ data: localData, source: "local" });
    }

    // Fallback: fetch from JST and cache
    const jstResponse = await callJst("/api/Supplier/GetSuppliers", {});
    const suppliers = extractListFromData(jstResponse);

    // Cache to local DB
    if (suppliers.length > 0) {
      const now = new Date().toISOString();
      const rows = suppliers.map((s: any) => ({
        supplier_code: s.SupplierCode || s.supplierCode || null,
        supplier_name: s.SupplierName || s.supplierName || null,
        raw_json: s,
        updated_at: now,
      }));

      await supabase
        .schema("jst_raw")
        .from("suppliers_raw")
        .upsert(rows, { onConflict: "supplier_code" });
    }

    return NextResponse.json({ data: suppliers, source: "jst" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Create supplier in JST and cache locally
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`suppliers:post:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body || !body.SupplierCode || !body.SupplierName) {
      return NextResponse.json(
        { error: "SupplierCode and SupplierName are required." },
        { status: 400 },
      );
    }

    const jstPayload = {
      SupplierCode: body.SupplierCode,
      SupplierName: body.SupplierName,
      ...(body.ContactName != null && { ContactName: body.ContactName }),
      ...(body.ContactPhone != null && { ContactPhone: body.ContactPhone }),
      ...(body.Address != null && { Address: body.Address }),
    };

    // Create in JST
    const jstResponse = await callJst("/api/Supplier/Create", jstPayload);

    // Cache locally
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const now = new Date().toISOString();
    await supabase
      .schema("jst_raw")
      .from("suppliers_raw")
      .upsert(
        {
          supplier_code: body.SupplierCode,
          supplier_name: body.SupplierName,
          raw_json: jstPayload,
          updated_at: now,
        },
        { onConflict: "supplier_code" },
      );

    return NextResponse.json({ ok: true, response: jstResponse });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
