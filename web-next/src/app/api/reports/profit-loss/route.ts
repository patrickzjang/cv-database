import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

type PlatformFeeConfig = {
  platform?: string;
  platform_name?: string;
  commission_rate: number;
  service_fee_rate: number;
  payment_fee_rate: number;
  other_fee_rate?: number;
};

type SkuPricing = {
  sku_code: string;
  cost_price: number;
};

type OrderRow = {
  platform_order_id: string;
  order_time: string;
  shop_name: string;
  amount: number;
  freight_income: number;
  freight_fee: number;
  items: Array<{
    sku_id: string;
    qty: number;
    amount?: number;
  }>;
};

export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`pnl-report:${ip}`, 30, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Request body required." }, { status: 400 });
    }

    // Support both direct dates and dateRange presets (like dashboard)
    let dateFrom = body.dateFrom;
    let dateTo = body.dateTo;
    const now = new Date();

    if (!dateFrom || !dateTo) {
      const range = body.dateRange || "30d";
      if (range === "today") {
        dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        dateTo = now.toISOString();
      } else if (range === "7d") {
        const from = new Date(now); from.setDate(now.getDate() - 6); from.setHours(0, 0, 0, 0);
        dateFrom = from.toISOString(); dateTo = now.toISOString();
      } else if (range === "month") {
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        dateTo = now.toISOString();
      } else {
        // default 30d = last calendar month in UTC
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const prevM = m === 0 ? 11 : m - 1;
        const prevY = m === 0 ? y - 1 : y;
        dateFrom = new Date(Date.UTC(prevY, prevM, 1, 0, 0, 0, 0)).toISOString();
        dateTo = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)).toISOString();
      }
    }

    const platforms = body.platforms;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Fetch all data (paginate to overcome 1000 row limit)
    const effectiveDateTo = dateTo.includes("T") ? dateTo : dateTo + "T23:59:59.999Z";

    // Fetch orders (paginated)
    const allOrders: any[] = [];
    let offset = 0;
    while (true) {
      let q = supabase.schema("jst_raw").from("order_details_raw")
        .select("order_id, order_time, shop_name, amount, paid_amount, freight_income, freight_fee, platform_free_amount, shop_free_amount, order_items_raw")
        .gte("order_time", dateFrom)
        .lte("order_time", effectiveDateTo)
        .range(offset, offset + 999);
      if (Array.isArray(platforms) && platforms.length > 0) q = q.in("shop_name", platforms);
      const { data: batch, error } = await q;
      if (error) return NextResponse.json({ error: `Orders: ${error.message}` }, { status: 500 });
      if (!batch || batch.length === 0) break;
      allOrders.push(...batch);
      if (batch.length < 1000) break;
      offset += 1000;
    }

    // Fetch fees + pricing in parallel
    const [feesRes, pricingAll] = await Promise.all([
      supabase.schema("core").from("platform_fee_config").select("*"),
      (async () => {
        const all: any[] = [];
        let off = 0;
        while (true) {
          const { data: b } = await supabase.schema("core").from("sku_pricing").select("item_sku, cogs_inc_vat").range(off, off + 999);
          if (!b || b.length === 0) break;
          all.push(...b);
          if (b.length < 1000) break;
          off += 1000;
        }
        return all;
      })(),
    ]);

    if (feesRes.error) {
      return NextResponse.json({ error: `Fees: ${feesRes.error.message}` }, { status: 500 });
    }

    const orders = allOrders;
    const feeConfigs = (feesRes.data ?? []) as PlatformFeeConfig[];
    const skuPricing = pricingAll;

    // Build lookup maps
    // platform_fee_config uses platform_name (Shopee, Lazada, etc.)
    // orders use shop_name (PN_SHP, DB_LAZ, etc.) — need to map
    const feeMap: Record<string, PlatformFeeConfig> = {};
    for (const fc of feeConfigs) {
      const key = (fc.platform_name || fc.platform || "").toLowerCase();
      feeMap[key] = fc;
    }
    // Map shop_name suffix to platform_fee_config key
    const SHOP_TO_PLATFORM: Record<string, string> = {
      SHP: "shopee", LAZ: "lazada", TTS: "tiktok shop", SPF: "shopify",
      ONS: "shopify", LSP: "lazada", EXC: "", REQ: "",
    };
    function getPlatformFee(shopName: string): PlatformFeeConfig | null {
      const parts = shopName.split("_");
      const suffix = parts[parts.length - 1] || "";
      const platformKey = SHOP_TO_PLATFORM[suffix];
      if (platformKey) return feeMap[platformKey] ?? null;
      // Try matching by name
      const lower = shopName.toLowerCase();
      if (lower.includes("shp") || lower.includes("shopee")) return feeMap["shopee"] ?? null;
      if (lower.includes("laz")) return feeMap["lazada"] ?? null;
      if (lower.includes("tts") || lower.includes("tiktok")) return feeMap["tiktok shop"] ?? null;
      if (lower.includes("spf") || lower.includes("shopify")) return feeMap["shopify"] ?? null;
      return null;
    }

    const costMap: Record<string, number> = {};
    for (const sp of skuPricing) {
      if (sp.item_sku && sp.cogs_inc_vat) costMap[sp.item_sku] = Number(sp.cogs_inc_vat);
    }

    // 2. Calculate per-platform P&L
    const platformStats: Record<
      string,
      {
        gross_revenue: number;
        commission: number;
        service_fee: number;
        payment_fee: number;
        other_fee: number;
        platform_fees: number;
        shipping_net: number;
        cogs: number;
        order_count: number;
      }
    > = {};

    // Daily trend accumulator
    const dailyStats: Record<
      string,
      { gross_revenue: number; cogs: number; net_profit: number; order_count: number }
    > = {};

    // Per-SKU profitability accumulator
    const skuStats: Record<
      string,
      { revenue: number; cogs: number; qty: number; name: string }
    > = {};

    for (const order of orders) {
      const platform = order.shop_name || "Unknown";
      const paidAmount = Number(order.paid_amount) || 0;
      const platDiscount = Number(order.platform_free_amount) || 0;
      const amount = paidAmount + platDiscount; // Gross Revenue = paid + platform discount (same as Dashboard)
      const freightIncome = Number(order.freight_income) || 0;
      const freightFee = Number(order.freight_fee) || 0;

      // Initialize platform bucket
      if (!platformStats[platform]) {
        platformStats[platform] = {
          gross_revenue: 0,
          commission: 0,
          service_fee: 0,
          payment_fee: 0,
          other_fee: 0,
          platform_fees: 0,
          shipping_net: 0,
          cogs: 0,
          order_count: 0,
        };
      }

      const ps = platformStats[platform];
      ps.gross_revenue += amount;
      ps.shipping_net += freightIncome - freightFee;
      ps.order_count += 1;

      // Platform fees (estimated from configured rates)
      const feeConfig = getPlatformFee(platform);
      if (feeConfig) {
        const comm = amount * (Number(feeConfig.commission_rate) || 0);
        const svc = amount * (Number(feeConfig.service_fee_rate) || 0);
        const pay = amount * (Number(feeConfig.payment_fee_rate) || 0);
        const other = amount * (Number(feeConfig.other_fee_rate) || 0);
        ps.commission += comm;
        ps.service_fee += svc;
        ps.payment_fee += pay;
        ps.other_fee += other;
        ps.platform_fees += comm + svc + pay + other;
      }

      // COGS from order items
      let orderCogs = 0;
      const orderItems = Array.isArray(order.order_items_raw) ? order.order_items_raw : [];
      for (const item of orderItems) {
        const skuId = item.skuId || item.sku_id || item.skuCode || "";
        const cost = costMap[skuId] || 0;
        const qty = Number(item.qty || item.quantity) || 0;
        const price = Number(item.price || item.amount) || 0;
        const itemCogs = cost * qty;
        orderCogs += itemCogs;

        // Per-SKU accumulation
        const skuKey = skuId.slice(0, 9) || skuId; // VARIATION_SKU level
        if (skuKey) {
          if (!skuStats[skuKey]) {
            skuStats[skuKey] = { revenue: 0, cogs: 0, qty: 0, name: item.name || item.skuName || "" };
          }
          skuStats[skuKey].revenue += price * qty;
          skuStats[skuKey].cogs += itemCogs;
          skuStats[skuKey].qty += qty;
        }
      }
      ps.cogs += orderCogs;

      // Daily trend
      const day = (order.order_time || "").slice(0, 10); // YYYY-MM-DD
      if (day) {
        if (!dailyStats[day]) {
          dailyStats[day] = { gross_revenue: 0, cogs: 0, net_profit: 0, order_count: 0 };
        }
        dailyStats[day].gross_revenue += amount;
        dailyStats[day].cogs += orderCogs;
        dailyStats[day].order_count += 1;
      }
    }

    // 3. Build platform summary with fee breakdown + net_profit
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const platformSummary = Object.entries(platformStats).map(([platform, ps]) => {
      const gross_profit = ps.gross_revenue - ps.cogs;
      const net_profit = gross_profit - ps.platform_fees + ps.shipping_net;
      const margin_pct = ps.gross_revenue > 0 ? (net_profit / ps.gross_revenue) * 100 : 0;
      return {
        platform,
        order_count: ps.order_count,
        gross_revenue: r2(ps.gross_revenue),
        cogs: r2(ps.cogs),
        gross_profit: r2(gross_profit),
        commission: r2(ps.commission),
        service_fee: r2(ps.service_fee),
        payment_fee: r2(ps.payment_fee),
        other_fee: r2(ps.other_fee),
        total_fees: r2(ps.platform_fees),
        shipping_net: r2(ps.shipping_net),
        net_profit: r2(net_profit),
        margin_pct: r2(margin_pct),
      };
    });

    // 4. Compute daily trend with net_profit
    const dailyTrend = Object.entries(dailyStats)
      .map(([date, ds]) => {
        // Sum platform fees proportionally for this day — simplified approach
        const net_profit = ds.gross_revenue - ds.cogs;
        return {
          date,
          gross_revenue: Math.round(ds.gross_revenue * 100) / 100,
          cogs: Math.round(ds.cogs * 100) / 100,
          net_profit: Math.round(net_profit * 100) / 100,
          order_count: ds.order_count,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // 5. Per-SKU profitability (top 50)
    const skuProfitability = Object.entries(skuStats)
      .map(([sku_id, ss]) => ({
        sku_id,
        sku: sku_id,
        name: ss.name || "",
        revenue: r2(ss.revenue),
        cogs: r2(ss.cogs),
        cost: r2(ss.cogs),
        profit: r2(ss.revenue - ss.cogs),
        qty: ss.qty,
        margin_pct: ss.revenue > 0 ? r2((ss.revenue - ss.cogs) / ss.revenue * 100) : 0,
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 50);

    // 6. Totals
    const totals = platformSummary.reduce(
      (acc, p) => ({
        gross_revenue: acc.gross_revenue + p.gross_revenue,
        cogs: acc.cogs + p.cogs,
        gross_profit: acc.gross_profit + p.gross_profit,
        commission: acc.commission + p.commission,
        service_fee: acc.service_fee + p.service_fee,
        payment_fee: acc.payment_fee + p.payment_fee,
        other_fee: acc.other_fee + p.other_fee,
        platform_fees: acc.platform_fees + p.total_fees,
        shipping_net: acc.shipping_net + p.shipping_net,
        net_profit: acc.net_profit + p.net_profit,
        order_count: acc.order_count + p.order_count,
      }),
      { gross_revenue: 0, cogs: 0, gross_profit: 0, commission: 0, service_fee: 0, payment_fee: 0, other_fee: 0, platform_fees: 0, shipping_net: 0, net_profit: 0, order_count: 0 }
    );

    return NextResponse.json({
      dateFrom,
      dateTo,
      totals: {
        gross_revenue: r2(totals.gross_revenue),
        cogs: r2(totals.cogs),
        gross_profit: r2(totals.gross_profit),
        commission: r2(totals.commission),
        service_fee: r2(totals.service_fee),
        payment_fee: r2(totals.payment_fee),
        other_fee: r2(totals.other_fee),
        platform_fees: r2(totals.platform_fees),
        shipping_net: r2(totals.shipping_net),
        net_profit: r2(totals.net_profit),
        order_count: totals.order_count,
      },
      platformSummary,
      dailyTrend,
      skuProfitability,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
