import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const variationSku = String(payload?.variation_sku || "").trim();
  const paths = Array.isArray(payload?.paths) ? payload.paths : [];
  const bucket = String(payload?.bucket || "").trim() || "product-images";

  if (!variationSku || paths.length === 0) {
    return jsonResponse({ error: "variation_sku and paths are required" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}`;
  const newUrls = paths.map((p: string) => `${baseUrl}/${p}`);

  const { error: rpcError } = await supabase.rpc("append_product_images_brand", {
    brand: String(payload?.brand || "PAN"),
    variation_sku: variationSku,
    urls: newUrls,
  });

  if (rpcError) {
    return jsonResponse({ error: rpcError.message }, 500);
  }

  return jsonResponse({ ok: true, count: newUrls.length });
});
