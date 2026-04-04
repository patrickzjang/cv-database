import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

type PlatformFeeConfig = {
  platform: string;
  commission_rate: number;
  service_fee_rate: number;
  payment_fee_rate: number;
};

type SkuPricing = {
  sku_code: string;
  cost_price: number;
};

type OrderRow = {
  platform_order_id: string;
  order_date: string;
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
    if (!body || !body.dateFrom || !body.dateTo) {
      return NextResponse.json(
        { error: "dateFrom and dateTo are required." },
        { status: 400 }
      );
    }

    const { dateFrom, dateTo, platforms } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Fetch order data, platform fee configs, and SKU pricing in parallel
    let ordersQuery = supabase
      .schema("jst_raw")
      .from("order_details_raw")
      .select("platform_order_id, order_date, shop_name, amount, freight_income, freight_fee, items")
      .gte("order_date", dateFrom)
      .lte("order_date", dateTo + "T23:59:59.999Z");

    if (Array.isArray(platforms) && platforms.length > 0) {
      ordersQuery = ordersQuery.in("shop_name", platforms);
    }

    const [ordersRes, feesRes, pricingRes] = await Promise.all([
      ordersQuery,
      supabase.schema("core").from("platform_fee_config").select("*"),
      supabase.schema("core").from("sku_pricing").select("sku_code, cost_price"),
    ]);

    if (ordersRes.error) {
      return NextResponse.json({ error: `Orders: ${ordersRes.error.message}` }, { status: 500 });
    }
    if (feesRes.error) {
      return NextResponse.json({ error: `Fees: ${feesRes.error.message}` }, { status: 500 });
    }
    if (pricingRes.error) {
      return NextResponse.json({ error: `Pricing: ${pricingRes.error.message}` }, { status: 500 });
    }

    const orders = (ordersRes.data ?? []) as OrderRow[];
    const feeConfigs = (feesRes.data ?? []) as PlatformFeeConfig[];
    const skuPricing = (pricingRes.data ?? []) as SkuPricing[];

    // Build lookup maps
    const feeMap: Record<string, PlatformFeeConfig> = {};
    for (const fc of feeConfigs) {
      feeMap[fc.platform] = fc;
    }

    const costMap: Record<string, number> = {};
    for (const sp of skuPricing) {
      costMap[sp.sku_code] = sp.cost_price;
    }

    // 2. Calculate per-platform P&L
    const platformStats: Record<
      string,
      {
        gross_revenue: number;
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
      { revenue: number; cogs: number; qty: number }
    > = {};

    for (const order of orders) {
      const platform = order.shop_name || "Unknown";
      const amount = Number(order.amount) || 0;
      const freightIncome = Number(order.freight_income) || 0;
      const freightFee = Number(order.freight_fee) || 0;

      // Initialize platform bucket
      if (!platformStats[platform]) {
        platformStats[platform] = {
          gross_revenue: 0,
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

      // Platform fees
      const feeConfig = feeMap[platform];
      if (feeConfig) {
        const totalFeeRate =
          (feeConfig.commission_rate || 0) +
          (feeConfig.service_fee_rate || 0) +
          (feeConfig.payment_fee_rate || 0);
        ps.platform_fees += amount * totalFeeRate;
      }

      // COGS from order items
      let orderCogs = 0;
      const orderItems = Array.isArray(order.items) ? order.items : [];
      for (const item of orderItems) {
        const cost = costMap[item.sku_id] || 0;
        const qty = Number(item.qty) || 0;
        const itemCogs = cost * qty;
        orderCogs += itemCogs;

        // Per-SKU accumulation
        if (!skuStats[item.sku_id]) {
          skuStats[item.sku_id] = { revenue: 0, cogs: 0, qty: 0 };
        }
        skuStats[item.sku_id].revenue += Number(item.amount) || 0;
        skuStats[item.sku_id].cogs += itemCogs;
        skuStats[item.sku_id].qty += qty;
      }
      ps.cogs += orderCogs;

      // Daily trend
      const day = (order.order_date || "").slice(0, 10); // YYYY-MM-DD
      if (day) {
        if (!dailyStats[day]) {
          dailyStats[day] = { gross_revenue: 0, cogs: 0, net_profit: 0, order_count: 0 };
        }
        dailyStats[day].gross_revenue += amount;
        dailyStats[day].cogs += orderCogs;
        dailyStats[day].order_count += 1;
      }
    }

    // 3. Build platform summary with net_profit
    const platformSummary = Object.entries(platformStats).map(([platform, ps]) => {
      const net_profit = ps.gross_revenue - ps.platform_fees - ps.cogs + ps.shipping_net;
      return {
        platform,
        gross_revenue: Math.round(ps.gross_revenue * 100) / 100,
        platform_fees: Math.round(ps.platform_fees * 100) / 100,
        shipping_net: Math.round(ps.shipping_net * 100) / 100,
        cogs: Math.round(ps.cogs * 100) / 100,
        net_profit: Math.round(net_profit * 100) / 100,
        order_count: ps.order_count,
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
        revenue: Math.round(ss.revenue * 100) / 100,
        cogs: Math.round(ss.cogs * 100) / 100,
        profit: Math.round((ss.revenue - ss.cogs) * 100) / 100,
        qty: ss.qty,
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 50);

    // 6. Totals
    const totals = platformSummary.reduce(
      (acc, p) => ({
        gross_revenue: acc.gross_revenue + p.gross_revenue,
        platform_fees: acc.platform_fees + p.platform_fees,
        shipping_net: acc.shipping_net + p.shipping_net,
        cogs: acc.cogs + p.cogs,
        net_profit: acc.net_profit + p.net_profit,
        order_count: acc.order_count + p.order_count,
      }),
      { gross_revenue: 0, platform_fees: 0, shipping_net: 0, cogs: 0, net_profit: 0, order_count: 0 }
    );

    return NextResponse.json({
      dateFrom,
      dateTo,
      totals: {
        gross_revenue: Math.round(totals.gross_revenue * 100) / 100,
        platform_fees: Math.round(totals.platform_fees * 100) / 100,
        shipping_net: Math.round(totals.shipping_net * 100) / 100,
        cogs: Math.round(totals.cogs * 100) / 100,
        net_profit: Math.round(totals.net_profit * 100) / 100,
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
