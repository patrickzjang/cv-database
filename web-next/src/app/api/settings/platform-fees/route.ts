import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

// GET: List all platform_fee_config
export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`platform-fees:get:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase
      .schema("core")
      .from("platform_fee_config")
      .select("*")
      .order("platform_name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Update platform fees
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`platform-fees:post:${ip}`, 20, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.fees) || body.fees.length === 0) {
      return NextResponse.json({ error: "Missing or empty fees array." }, { status: 400 });
    }

    const fees = body.fees as Record<string, unknown>[];
    const now = new Date().toISOString();

    // Validate each fee has platform_name
    for (const fee of fees) {
      if (!fee.platform_name) {
        return NextResponse.json({ error: "Each fee must have platform_name." }, { status: 400 });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const rows = fees.map((f) => ({
      platform_name: String(f.platform_name),
      commission_rate: f.commission_rate != null ? Number(f.commission_rate) : null,
      service_fee_rate: f.service_fee_rate != null ? Number(f.service_fee_rate) : null,
      payment_fee_rate: f.payment_fee_rate != null ? Number(f.payment_fee_rate) : null,
      shipping_subsidy_rate: f.shipping_subsidy_rate != null ? Number(f.shipping_subsidy_rate) : null,
      other_fee_rate: f.other_fee_rate != null ? Number(f.other_fee_rate) : null,
      notes: f.notes ? String(f.notes) : null,
      updated_at: now,
    }));

    const { error } = await supabase
      .schema("core")
      .from("platform_fee_config")
      .upsert(rows, { onConflict: "platform_name" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, upserted: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
