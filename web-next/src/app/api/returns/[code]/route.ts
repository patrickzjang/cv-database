import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

// Public endpoint - no auth required, but rate-limited
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }

    const ip = getClientIp(req);
    if (!(await checkRateLimit(`returns-status:${ip}`, 30, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const { code } = await params;

    if (!code || code.length < 5) {
      return NextResponse.json(
        { error: "Invalid tracking code." },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase
      .schema("core")
      .from("return_requests")
      .select("tracking_code, status, created_at, updated_at, items")
      .eq("tracking_code", code)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "Return request not found." },
        { status: 404 }
      );
    }

    // Return only public-safe fields (no internal_notes, no customer contact details)
    return NextResponse.json({
      tracking_code: data.tracking_code,
      status: data.status,
      created_at: data.created_at,
      updated_at: data.updated_at,
      items: data.items,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
