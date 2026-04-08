import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";
import { createClient } from "@supabase/supabase-js";

/* GET /api/products/[sku]/assets — list DAM assets for a VARIATION_SKU */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`prod-assets:${getClientIp(req)}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  const { sku } = await params;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await sb
    .schema("dam")
    .from("assets")
    .select("id, sku, brand, asset_type, title, status, raw_filename, raw_mime, thumbnail_path, web_path, stream_thumbnail_url, stream_hls_url, stream_status, width_px, height_px, created_at")
    .eq("sku", sku)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ assets: data ?? [] });
}

/* POST /api/products/[sku]/assets — link assets to a product */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`prod-assets-w:${getClientIp(req)}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  const { sku } = await params;
  const { asset_ids, brand } = await req.json();

  if (!Array.isArray(asset_ids) || asset_ids.length === 0)
    return NextResponse.json({ error: "asset_ids required" }, { status: 400 });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { error } = await sb
    .schema("dam")
    .from("assets")
    .update({ sku, brand: brand || undefined })
    .in("id", asset_ids);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Log events
  for (const aid of asset_ids) {
    await sb
      .schema("dam")
      .from("asset_events")
      .insert({
        asset_id: aid,
        actor: "system",
        event: "linked_to_product",
        metadata: { sku, brand },
      });
  }

  return NextResponse.json({ linked: asset_ids.length });
}
