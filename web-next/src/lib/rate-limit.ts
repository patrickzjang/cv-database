/**
 * Rate limiter using Supabase (public.rate_limit_buckets table).
 *
 * Why: In serverless deployments (Vercel, etc.) each request can run in a
 * separate process/instance, so an in-memory Map resets on every cold start
 * and provides no real protection. Using Supabase as the backing store ensures
 * limits are shared across all instances.
 *
 * Required migration: see supabase/migrations/..._create_rate_limit_buckets.sql
 *
 * Fallback: if the DB call fails for any reason (network, table missing, etc.)
 * we ALLOW the request rather than blocking legitimate users. This is the safer
 * default for a search/upload tool — adjust if you need stricter behaviour.
 */

import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0]?.trim() || "unknown";
  }
  return req.headers.get("x-real-ip") || "unknown";
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  // If Supabase isn't configured yet, allow the request.
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return true;

  try {
    const now = Date.now();
    const windowSec = Math.ceil(windowMs / 1000);

    // Upsert a counter row for this key+window slot.
    // The window slot is the floor of (now / windowMs) so all requests
    // within the same window share the same row.
    const slot = Math.floor(now / windowMs);
    const resetAt = new Date((slot + 1) * windowMs).toISOString();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/check_rate_limit`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_key: key,
          p_limit: limit,
          p_window_sec: windowSec,
        }),
        cache: "no-store",
      }
    );

    if (!res.ok) {
      console.warn("[rate-limit] DB call failed, allowing request:", await res.text().catch(() => ""));
      return true; // fail open
    }

    const allowed: boolean = await res.json();
    return allowed;
  } catch (err) {
    console.warn("[rate-limit] Unexpected error, allowing request:", err);
    return true; // fail open
  }
}
