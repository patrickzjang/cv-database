import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";

/**
 * POST /api/inventory/sync
 *
 * Triggers the Supabase Edge Function `sync_inventory_hourly`
 * which syncs inventory from JST API → jst_raw.inventory_raw.
 * JST credentials are stored in Edge Function secrets.
 */
export async function POST(req: NextRequest) {
  if (!isAuthenticated(req))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`inventory-sync:${getClientIp(req)}`, 3, 60_000);
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  try {
    // Call the Edge Function which has JST secrets configured
    const edgeFnUrl = `${SUPABASE_URL}/functions/v1/sync_inventory_hourly`;
    const res = await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const json = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: json.error ?? "Edge function failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      synced_at: new Date().toISOString(),
      rows: json.totalInserted ?? 0,
      pages: json.pagesFetched ?? 0,
      warehouses: json.warehouses ?? [],
      message: json.message,
    });
  } catch (e: any) {
    console.error("inventory-sync error:", e);
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
