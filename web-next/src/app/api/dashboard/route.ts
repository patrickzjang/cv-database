import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

export type DashboardPayload = {
  dateRange?: "today" | "7d" | "30d" | "month" | "custom";
  dateFrom?: string;
  dateTo?: string;
  platforms?: string[];
};

function getDateRange(payload: DashboardPayload): { from: Date; to: Date } {
  const now = new Date();

  if (payload.dateRange === "custom" && payload.dateFrom && payload.dateTo) {
    return {
      from: new Date(payload.dateFrom + (payload.dateFrom.includes("T") ? "" : "T00:00:00.000Z")),
      to:   new Date(payload.dateTo + (payload.dateTo.includes("T") ? "" : "T23:59:59.999Z")),
    };
  }

  if (payload.dateRange === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }

  if (payload.dateRange === "7d") {
    const from = new Date(now);
    from.setDate(now.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }

  if (payload.dateRange === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: now };
  }

  // default: 30d = last calendar month (1st to last day) in UTC
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // current month (0-based)
  const prevM = m === 0 ? 11 : m - 1;
  const prevY = m === 0 ? y - 1 : y;
  const lastMonthStart = new Date(Date.UTC(prevY, prevM, 1, 0, 0, 0, 0));
  const lastMonthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)); // day 0 of current month = last day of prev month
  return { from: lastMonthStart, to: lastMonthEnd };
}

export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`dashboard:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = (await req.json().catch(() => ({}))) as DashboardPayload;
    const { from, to } = getDateRange(body);
    const platforms = Array.isArray(body.platforms) && body.platforms.length > 0
      ? body.platforms
      : null;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Fetch platform list first so we can apply exclusion filter
    const platformsRes = await supabase.schema("jst_raw").rpc("dashboard_platforms");
    const allPlatforms: string[] = (platformsRes.data ?? [])
      .map((r: any) => r.shop_name as string)
      .filter(Boolean);
    const filteredPlatforms = allPlatforms.filter(
      (p) => !p.includes("_EXC") && !p.includes("_REQ")
    );

    // When user selects specific platforms, honour their selection (but still exclude _EXC/_REQ).
    // When no platforms selected (all), use the pre-filtered list so _EXC/_REQ are never queried.
    const effectivePlatforms: string[] | null = platforms
      ? platforms.filter((p) => !p.includes("_EXC") && !p.includes("_REQ"))
      : filteredPlatforms.length > 0 ? filteredPlatforms : null;

    // Calculate previous period for comparison
    const periodMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - periodMs);
    const prevTo = new Date(from.getTime());

    // Run remaining queries in parallel (including previous period summary)
    const [summaryRes, prevSummaryRes, rrpRes, prevRrpRes, statusRes, trendRes, skusRes, platformSummaryRes] = await Promise.all([
      supabase.schema("jst_raw").rpc("dashboard_summary", {
        p_from: from.toISOString(),
        p_to:   to.toISOString(),
        p_platforms: effectivePlatforms,
      }),
      supabase.schema("jst_raw").rpc("dashboard_summary", {
        p_from: prevFrom.toISOString(),
        p_to:   prevTo.toISOString(),
        p_platforms: effectivePlatforms,
      }),
      supabase.schema("jst_raw").rpc("dashboard_rrp_total", {
        p_from: from.toISOString(),
        p_to:   to.toISOString(),
        p_platforms: effectivePlatforms,
      }),
      supabase.schema("jst_raw").rpc("dashboard_rrp_total", {
        p_from: prevFrom.toISOString(),
        p_to:   prevTo.toISOString(),
        p_platforms: effectivePlatforms,
      }),
      supabase.schema("jst_raw").rpc("dashboard_status_breakdown", {
        p_from: from.toISOString(),
        p_to:   to.toISOString(),
        p_platforms: effectivePlatforms,
      }),
      supabase.schema("jst_raw").rpc("dashboard_daily_trend", {
        p_from: from.toISOString(),
        p_to:   to.toISOString(),
        p_platforms: effectivePlatforms,
      }),
      supabase.schema("jst_raw").rpc("dashboard_top_skus", {
        p_from: from.toISOString(),
        p_to:   to.toISOString(),
        p_platforms: effectivePlatforms,
        p_limit: 20,
      }),
      supabase.schema("jst_raw").rpc("dashboard_platform_summary", {
        p_from: from.toISOString(),
        p_to:   to.toISOString(),
        p_platforms: effectivePlatforms,
      }),
    ]);

    // Surface any DB errors
    const errors = [summaryRes, prevSummaryRes, rrpRes, prevRrpRes, statusRes, trendRes, skusRes, platformsRes, platformSummaryRes]
      .map((r) => r.error?.message)
      .filter(Boolean);
    if (errors.length) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 500 });
    }

    const summary = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
    const prevSummary = Array.isArray(prevSummaryRes.data) ? prevSummaryRes.data[0] : prevSummaryRes.data;

    return NextResponse.json({
      from: from.toISOString(),
      to:   to.toISOString(),
      summary: summary ?? {
        total_orders: 0,
        gross_revenue: 0,
        platform_discounts: 0,
        shipping_income: 0,
        shipping_cost: 0,
        net_revenue: 0,
        avg_order_value: 0,
      },
      prevSummary: prevSummary ?? null,
      rrpTotal: rrpRes.data ?? 0,
      prevRrpTotal: prevRrpRes.data ?? 0,
      statusBreakdown:  statusRes.data          ?? [],
      dailyTrend:       trendRes.data           ?? [],
      topSkus:          skusRes.data             ?? [],
      platformSummary:  platformSummaryRes.data  ?? [],
      platformList:     filteredPlatforms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: return just the platform list (for populating the filter dropdown on load)
export async function GET(req: Request) {
  try {
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    requireServerConfig();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.schema("jst_raw").rpc("dashboard_platforms");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      platformList: (data ?? [])
        .map((r: any) => r.shop_name as string)
        .filter((p: string) => p && !p.includes("_EXC") && !p.includes("_REQ")),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
