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
    if (!(await checkRateLimit(`returns-submit:${ip}`, 5, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const {
      platform_order_id,
      customer_name,
      customer_phone,
      customer_email,
      brand,
      reason,
      description,
      items,
      photo_urls,
    } = body;

    // Validate required fields
    if (!platform_order_id || !customer_name || !reason) {
      return NextResponse.json(
        { error: "platform_order_id, customer_name, and reason are required." },
        { status: 400 }
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "At least one item is required." },
        { status: 400 }
      );
    }

    // Validate items
    for (const item of items) {
      if (!item.sku || typeof item.qty !== "number" || item.qty <= 0) {
        return NextResponse.json(
          { error: "Each item must have a sku and positive qty." },
          { status: 400 }
        );
      }
    }

    // Validate photo_urls if provided
    if (photo_urls && !Array.isArray(photo_urls)) {
      return NextResponse.json(
        { error: "photo_urls must be an array of strings." },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Generate tracking code
    const trackingCode = `RET-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const { data, error } = await supabase
      .schema("core")
      .from("return_requests")
      .insert({
        platform_order_id,
        customer_name,
        customer_phone: customer_phone || null,
        customer_email: customer_email || null,
        brand: brand || null,
        reason,
        description: description || null,
        items,
        photo_urls: photo_urls || [],
        tracking_code: trackingCode,
        status: "submitted",
        source: "customer_portal",
      })
      .select("tracking_code, status, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      tracking_code: data.tracking_code,
      status: data.status,
      created_at: data.created_at,
      message: "Return request submitted successfully. Use the tracking code to check status.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
