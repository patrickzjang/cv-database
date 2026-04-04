import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";
import { callJst } from "@/lib/jst-api";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`after-sale-detail:${ip}`, 60, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const { id } = await params;
    const isNumeric = /^\d+$/.test(id);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    if (isNumeric) {
      // Query JST raw after-sale order by after_sale_order_id
      const { data, error } = await supabase
        .schema("jst_raw")
        .from("after_sale_orders_raw")
        .select("*")
        .eq("after_sale_order_id", parseInt(id, 10))
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ data, source: "jst" });
    } else {
      // Query internal return_requests by id (UUID)
      const { data, error } = await supabase
        .schema("core")
        .from("return_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ data, source: "internal" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`after-sale-update:${ip}`, 20, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const { id } = await params;
    const body = await req.json().catch(() => null);

    if (!body || !body.status) {
      return NextResponse.json(
        { error: "Body must include status." },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const updatePayload: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    };

    if (body.internal_notes !== undefined) {
      updatePayload.internal_notes = body.internal_notes;
    }

    const { data, error } = await supabase
      .schema("core")
      .from("return_requests")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If status is approved, optionally push to JST
    let jstResult = null;
    if (body.status === "approved" && data.warehouse_id && data.shop_id) {
      try {
        jstResult = await callJst("/api/AfterSaleOrder/CreateAfterSaleOrders", {
          warehouse_id: data.warehouse_id,
          shop_id: data.shop_id,
          platform_order_id: data.platform_order_id,
          after_sale_type: data.after_sale_type,
          items: data.items || [],
          remark: data.remark || "",
        });
      } catch (jstErr) {
        console.error("[after-sales] JST push on approval failed:", jstErr);
      }
    }

    return NextResponse.json({ data, jst_result: jstResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
