import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

// Public endpoint - no auth required, but rate-limited
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }

    const ip = getClientIp(req);
    if (!(await checkRateLimit(`returns-lookup:${ip}`, 10, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body || !body.platform_order_id || !body.phone_or_email) {
      return NextResponse.json(
        { error: "platform_order_id and phone_or_email are required." },
        { status: 400 }
      );
    }

    const { platform_order_id, phone_or_email } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Query order_details_raw by platform_order_id
    const { data: orders, error } = await supabase
      .schema("jst_raw")
      .from("order_details_raw")
      .select("platform_order_id, order_date, status, items, shop_name")
      .eq("platform_order_id", platform_order_id)
      .limit(1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json(
        { error: "Order not found. Please check your order ID." },
        { status: 404 }
      );
    }

    const order = orders[0] as any;

    // Return only non-sensitive info
    return NextResponse.json({
      found: true,
      order: {
        platform_order_id: order.platform_order_id,
        order_date: order.order_date,
        status: order.status,
        shop_name: order.shop_name,
        items: Array.isArray(order.items)
          ? order.items.map((item: any) => ({
              sku_id: item.sku_id,
              item_name: item.item_name,
              qty: item.qty,
            }))
          : [],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
