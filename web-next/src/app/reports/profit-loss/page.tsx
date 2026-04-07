"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type DateRange = "today" | "7d" | "30d" | "month" | "custom";

type PLSummary = {
  gross_revenue: number;
  cogs: number;
  gross_profit: number;
  commission: number;
  service_fee: number;
  payment_fee: number;
  other_fee: number;
  platform_fees: number;
  freight_income: number;
  freight_fee: number;
  shipping_net: number;
  net_profit: number;
};

type PlatformBreakdown = {
  platform: string;
  orders: number;
  gross_revenue: number;
  cogs: number;
  gross_profit: number;
  commission: number;
  service_fee: number;
  payment_fee: number;
  total_fees: number;
  shipping_net: number;
  net_profit: number;
  margin_pct: number;
};

type DailyTrendRow = {
  day: string;
  gross_revenue: number;
  net_profit: number;
  cogs: number;
};

type SkuProfitRow = {
  sku: string;
  name: string;
  qty_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin_pct: number;
};

type PLData = {
  summary: PLSummary;
  platformBreakdown: PlatformBreakdown[];
  dailyTrend: DailyTrendRow[];
  topSkus: SkuProfitRow[];
  bottomSkus: SkuProfitRow[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "–";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return "–";
  return n.toLocaleString("th-TH");
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "–";
  return n.toFixed(1) + "%";
}

function marginColor(pct: number): string {
  if (pct < 10) return "var(--error)";
  if (pct < 20) return "var(--warn)";
  return "var(--ok)";
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BRANDS = [
  { code: "AN", label: "ARENA" },
  { code: "PN", label: "PAN" },
  { code: "HC", label: "HEELCARE" },
  { code: "DB", label: "DAYBREAK" },
];

const CHANNELS = [
  { code: "SHP", label: "Shopee" },
  { code: "LAZ", label: "Lazada" },
  { code: "TTS", label: "Tiktok Shop" },
  { code: "SPF", label: "Shopify" },
  { code: "ONS", label: "Other" },
];

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "7 Days" },
  { key: "30d",   label: "Last Month" },
  { key: "month", label: "This Month" },
  { key: "custom", label: "Custom" },
];

// ─── Multi-Select Filter ─────────────────────────────────────────────────────

function MultiSelectFilter({
  title, allLabel, options, selected, onChange,
}: {
  title: string;
  allLabel: string;
  options: { code: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (code: string) => {
    onChange(selected.includes(code) ? selected.filter((x) => x !== code) : [...selected, code]);
  };
  const allSelected = selected.length === 0;

  return (
    <div>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>{title}</div>
      <div ref={ref} style={{ position: "relative", minWidth: 160 }}>
        <button
          className="ghost"
          onClick={() => setOpen((o) => !o)}
          style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
        >
          <span>
            {allSelected ? allLabel : selected.map((c) => options.find((o) => o.code === c)?.label ?? c).join(", ")}
          </span>
          <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>{open ? "▲" : "▼"}</span>
        </button>

        {open && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: "100%",
            background: "#fff", border: "1px solid var(--border-2)", borderRadius: 10,
            boxShadow: "0 10px 28px rgba(0,0,0,0.12)", zIndex: 20, padding: 6,
          }}>
            <button
              className="ghost"
              style={{ width: "100%", textAlign: "left", marginBottom: 4,
                background: allSelected ? "rgba(0,180,216,0.08)" : "transparent",
                borderColor: allSelected ? "rgba(0,180,216,0.25)" : "transparent",
                color: allSelected ? "var(--cyan)" : "var(--text-muted)" }}
              onClick={() => { onChange([]); setOpen(false); }}
            >
              {allLabel}
            </button>
            {options.map(({ code, label }) => {
              const active = selected.includes(code);
              return (
                <button key={code}
                  className="ghost"
                  style={{ width: "100%", textAlign: "left",
                    background: active ? "rgba(0,180,216,0.08)" : "transparent",
                    borderColor: active ? "rgba(0,180,216,0.25)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    display: "flex", alignItems: "center", gap: 8 }}
                  onClick={() => toggle(code)}
                >
                  <span style={{ width: 14, height: 14, borderRadius: 3,
                    border: `2px solid ${active ? "var(--cyan)" : "var(--border-2)"}`,
                    background: active ? "var(--cyan)" : "transparent",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.6rem", flexShrink: 0, color: "#fff" }}>
                    {active ? "✓" : ""}
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SVG Line Chart ──────────────────────────────────────────────────────────

function PLChart({ data }: { data: DailyTrendRow[] }) {
  const W = 800, H = 200, PAD = { top: 20, right: 20, bottom: 32, left: 60 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (!data.length) {
    return (
      <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        No data
      </div>
    );
  }

  const allVals = data.flatMap((d) => [d.gross_revenue, d.net_profit, d.cogs]);
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  const xOf = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * innerW;
  const yOf = (v: number) => PAD.top + innerH - ((v - minVal) / range) * innerH;

  const makePath = (key: keyof DailyTrendRow) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(d[key] as number)}`).join(" ");

  const revPath = makePath("gross_revenue");
  const profitPath = makePath("net_profit");
  const cogsPath = makePath("cogs");

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const val = minVal + f * range;
    return { y: yOf(val), label: fmt(val).replace(".00", "") };
  });

  // X-axis labels
  const step = Math.max(1, Math.floor(data.length / 10));
  const xLabels = data
    .map((d, i) => ({ i, label: fmtDate(d.day) }))
    .filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
      <defs>
        <linearGradient id="plRevGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
            stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
          <text x={PAD.left - 6} y={t.y + 4} textAnchor="end"
            fontSize="10" fill="var(--text-muted)">{t.label}</text>
        </g>
      ))}

      {/* Area fill for revenue */}
      <path d={revPath + ` L${xOf(data.length - 1)},${PAD.top + innerH} L${xOf(0)},${PAD.top + innerH} Z`}
        fill="url(#plRevGrad)" />

      {/* Gross Revenue line (blue) */}
      <path d={revPath} fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* Net Profit line (green) */}
      <path d={profitPath} fill="none" stroke="var(--ok)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {/* COGS line (gray dashed) */}
      <path d={cogsPath} fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeDasharray="5 3"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* X labels */}
      {xLabels.map(({ i, label }) => (
        <text key={i} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
          {label}
        </text>
      ))}

      {/* Legend */}
      <rect x={PAD.left} y={4} width={10} height={10} rx="2" fill="var(--cyan)" />
      <text x={PAD.left + 14} y={12} fontSize="10" fill="var(--text-muted)">Revenue</text>
      <rect x={PAD.left + 70} y={4} width={10} height={10} rx="2" fill="var(--ok)" />
      <text x={PAD.left + 84} y={12} fontSize="10" fill="var(--text-muted)">Net Profit</text>
      <line x1={PAD.left + 148} y1={9} x2={PAD.left + 162} y2={9} stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="4 2" />
      <text x={PAD.left + 166} y={12} fontSize="10" fill="var(--text-muted)">COGS</text>
    </svg>
  );
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportCSV(data: PLData) {
  const lines: string[] = [];

  // Summary
  lines.push("--- P&L Summary ---");
  lines.push("Metric,Value");
  lines.push(`Gross Revenue,${data.summary.gross_revenue}`);
  lines.push(`COGS,${data.summary.cogs}`);
  lines.push(`Gross Profit,${data.summary.gross_profit}`);
  lines.push(`Platform Fees,${data.summary.platform_fees}`);
  lines.push(`Freight Income,${data.summary.freight_income}`);
  lines.push(`Freight Fee,${data.summary.freight_fee}`);
  lines.push(`Shipping Net,${data.summary.shipping_net}`);
  lines.push(`Net Profit,${data.summary.net_profit}`);
  lines.push("");

  // Platform breakdown
  lines.push("--- Platform Breakdown ---");
  lines.push("Platform,Orders,Gross Revenue,COGS,Gross Profit,Commission,Service Fee,Payment Fee,Total Fees,Shipping Net,Net Profit,Margin%");
  for (const p of data.platformBreakdown) {
    lines.push(`${p.platform},${p.orders},${p.gross_revenue},${p.cogs},${p.gross_profit},${p.commission},${p.service_fee},${p.payment_fee},${p.total_fees},${p.shipping_net},${p.net_profit},${p.margin_pct}`);
  }
  lines.push("");

  // Daily trend
  lines.push("--- Daily Trend ---");
  lines.push("Date,Gross Revenue,Net Profit,COGS");
  for (const d of data.dailyTrend) {
    lines.push(`${d.day},${d.gross_revenue},${d.net_profit},${d.cogs}`);
  }
  lines.push("");

  // Top SKUs
  lines.push("--- Top Profitable SKUs ---");
  lines.push("SKU,Name,Qty Sold,Revenue,Cost,Profit,Margin%");
  for (const s of data.topSkus) {
    lines.push(`"${s.sku}","${s.name}",${s.qty_sold},${s.revenue},${s.cost},${s.profit},${s.margin_pct}`);
  }
  lines.push("");

  // Bottom SKUs
  lines.push("--- Least Profitable SKUs ---");
  lines.push("SKU,Name,Qty Sold,Revenue,Cost,Profit,Margin%");
  for (const s of data.bottomSkus) {
    lines.push(`"${s.sku}","${s.name}",${s.qty_sold},${s.revenue},${s.cost},${s.profit},${s.margin_pct}`);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pl-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type SortCol = keyof PlatformBreakdown;

export default function ProfitLossPage() {
  const router = useRouter();

  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  const [data, setData] = useState<PLData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("net_profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [skuView, setSkuView] = useState<"top" | "bottom">("top");

  const effectivePlatforms = (() => {
    if (selectedBrands.length === 0 && selectedChannels.length === 0) return [];
    const brands = selectedBrands.length > 0 ? selectedBrands : BRANDS.map((b) => b.code);
    const channels = selectedChannels.length > 0 ? selectedChannels : CHANNELS.map((c) => c.code);
    return brands.flatMap((b) => channels.map((c) => `${b}_${c}`));
  })();

  const fetchReport = useCallback(async () => {
    if (dateRange === "custom" && (!dateFrom || !dateTo)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/profit-loss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateRange, dateFrom, dateTo, platforms: effectivePlatforms }),
      });
      const json = await res.json();
      if (json.error) {
        if (res.status === 401) { router.push("/login"); return; }
        setError(json.error);
      } else {
        // Map API response to UI format
        const totals = json.totals || json.summary || {};
        const grossProfit = (totals.gross_revenue ?? 0) - (totals.cogs ?? 0);
        setData({
          summary: {
            gross_revenue: totals.gross_revenue ?? 0,
            cogs: totals.cogs ?? 0,
            gross_profit: grossProfit,
            platform_fees: totals.platform_fees ?? 0,
            commission: totals.commission ?? 0,
            service_fee: totals.service_fee ?? 0,
            payment_fee: totals.payment_fee ?? 0,
            other_fee: totals.other_fee ?? 0,
            freight_income: totals.freight_income ?? 0,
            freight_fee: totals.freight_fee ?? 0,
            shipping_net: totals.shipping_net ?? 0,
            net_profit: totals.net_profit ?? 0,
          },
          platformBreakdown: json.platformSummary ?? json.platformBreakdown ?? [],
          dailyTrend: json.dailyTrend ?? [],
          topSkus: json.skuProfitability?.slice(0, 20) ?? json.topSkus ?? [],
          bottomSkus: json.skuProfitability?.slice(-20).reverse() ?? json.bottomSkus ?? [],
        });
      }
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [dateRange, dateFrom, dateTo, effectivePlatforms, router]);

  useEffect(() => {
    if (dateRange !== "custom") fetchReport();
  }, [dateRange, selectedBrands, selectedChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span style={{ opacity: 0.3, fontSize: "0.7rem" }}> ↕</span>;
    return <span style={{ fontSize: "0.7rem", color: "var(--cyan)" }}> {sortDir === "desc" ? "↓" : "↑"}</span>;
  }

  const sortedPlatforms = [...(data?.platformBreakdown ?? [])].sort((a, b) => {
    const dir = sortDir === "desc" ? -1 : 1;
    const av = a[sortCol] as number, bv = b[sortCol] as number;
    return dir * (av - bv);
  });

  const totals = sortedPlatforms.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      gross_revenue: acc.gross_revenue + r.gross_revenue,
      cogs: acc.cogs + r.cogs,
      gross_profit: acc.gross_profit + r.gross_profit,
      commission: acc.commission + r.commission,
      service_fee: acc.service_fee + r.service_fee,
      payment_fee: acc.payment_fee + r.payment_fee,
      total_fees: acc.total_fees + r.total_fees,
      shipping_net: acc.shipping_net + r.shipping_net,
      net_profit: acc.net_profit + r.net_profit,
    }),
    { orders: 0, gross_revenue: 0, cogs: 0, gross_profit: 0, commission: 0, service_fee: 0, payment_fee: 0, total_fees: 0, shipping_net: 0, net_profit: 0 }
  );
  const totalMargin = totals.gross_revenue > 0 ? (totals.net_profit / totals.gross_revenue) * 100 : 0;

  const skuData = skuView === "top" ? (data?.topSkus ?? []) : (data?.bottomSkus ?? []);

  const summary = data?.summary;

  return (
    <div>
      <div className="page">
        {/* ── Filters ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>TIME RANGE</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DATE_RANGES.map(({ key, label }) => (
                  <button key={key}
                    className={`tab${dateRange === key ? " active" : ""}`}
                    style={{ padding: "8px 14px", fontSize: "0.88rem" }}
                    onClick={() => setDateRange(key)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {dateRange === "custom" && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 }}>FROM</div>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 }}>TO</div>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <button className="primary" onClick={fetchReport}
                  disabled={!dateFrom || !dateTo || loading}
                  style={{ padding: "9px 16px" }}>
                  Apply
                </button>
              </div>
            )}

            <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <MultiSelectFilter title="BRAND" allLabel="All Brands" options={BRANDS}
                selected={selectedBrands} onChange={setSelectedBrands} />
              <MultiSelectFilter title="PLATFORM" allLabel="All Platforms" options={CHANNELS}
                selected={selectedChannels} onChange={setSelectedChannels} />
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 12,
            padding: "12px 16px", color: "var(--error)", marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "60px 0" }}>
            Loading report...
          </div>
        )}

        {!loading && data && (
          <>
            {/* ── P&L Summary Cards ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 16 }}>
              {[
                { label: "Gross Revenue", value: `฿${fmt(summary?.gross_revenue)}`, color: "var(--ok)", bg: "rgba(5,150,105,0.06)", tooltip: "" },
                { label: "COGS", value: `-฿${fmt(summary?.cogs)}`, color: "var(--text-muted)", bg: "var(--surface-2)", tooltip: "" },
                { label: "Gross Profit", value: `฿${fmt(summary?.gross_profit)}`, color: "var(--app-accent)", bg: "rgba(30,64,175,0.06)", tooltip: "Gross Revenue - COGS" },
                { label: "Commission", value: `-฿${fmt((summary as any)?.commission)}`, color: "var(--error)", bg: "rgba(220,38,38,0.04)", tooltip: "" },
                { label: "Service Fee", value: `-฿${fmt((summary as any)?.service_fee)}`, color: "var(--error)", bg: "rgba(220,38,38,0.04)", tooltip: "" },
                { label: "Payment Fee", value: `-฿${fmt((summary as any)?.payment_fee)}`, color: "var(--error)", bg: "rgba(220,38,38,0.04)", tooltip: "" },
                { label: "Other Fee", value: `-฿${fmt((summary as any)?.other_fee)}`, color: "var(--error)", bg: "rgba(220,38,38,0.04)", tooltip: "" },
                { label: "Total Fees", value: `-฿${fmt(summary?.platform_fees)}`, color: "var(--error)", bg: "rgba(220,38,38,0.06)", tooltip: "Commission + Service + Payment + Other" },
              ].map(({ label, value, color, bg, tooltip }) => (
                <div key={label} className="card" style={{ padding: "18px 20px", background: bg }} title={tooltip}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: "1.3rem", fontWeight: 700, color, letterSpacing: "-0.02em" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Net Profit Card (large) ── */}
            <div className="card" style={{
              marginBottom: 16, padding: "24px 28px", textAlign: "center",
              background: (summary?.net_profit ?? 0) >= 0 ? "rgba(5,150,105,0.06)" : "rgba(220,38,38,0.06)",
              border: `1px solid ${(summary?.net_profit ?? 0) >= 0 ? "rgba(5,150,105,0.2)" : "rgba(220,38,38,0.2)"}`,
            }}>
              <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Net Profit
              </div>
              <div style={{
                fontSize: "2.4rem", fontWeight: 700, letterSpacing: "-0.03em",
                color: (summary?.net_profit ?? 0) >= 0 ? "var(--ok)" : "var(--error)",
              }}>
                ฿{fmt(summary?.net_profit)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 4 }}>
                Gross Profit - Platform Fees + Shipping Net
              </div>
            </div>

            {/* ── Daily Profit Trend ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 14, fontSize: "1rem" }}>Daily Profit Trend</div>
              <PLChart data={data.dailyTrend} />
            </div>

            {/* ── Platform Comparison Table ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 14, fontSize: "1rem" }}>Platform Comparison</div>
              <div style={{ overflowX: "auto" }}>
                <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                  <thead>
                    <tr>
                      {([
                        ["platform", "Platform"],
                        ["orders", "Orders"],
                        ["gross_revenue", "Gross Rev"],
                        ["cogs", "COGS"],
                        ["gross_profit", "Gross Profit"],
                        ["commission", "Commission"],
                        ["service_fee", "Service Fee"],
                        ["payment_fee", "Payment Fee"],
                        ["total_fees", "Total Fees"],
                        ["shipping_net", "Ship Net"],
                        ["net_profit", "Net Profit"],
                        ["margin_pct", "Margin%"],
                      ] as [SortCol, string][]).map(([col, label]) => (
                        <th key={col}
                          onClick={() => toggleSort(col)}
                          style={{ textAlign: col === "platform" ? "left" : "right", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                          {label}<SortIcon col={col} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlatforms.map((row) => (
                      <tr key={row.platform}>
                        <td style={{ fontWeight: 600 }}>{row.platform}</td>
                        <td style={{ textAlign: "right" }}>{fmtInt(row.orders)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(row.gross_revenue)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(row.cogs)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(row.gross_profit)}</td>
                        <td style={{ textAlign: "right", color: "var(--error)" }}>{fmt(row.commission)}</td>
                        <td style={{ textAlign: "right", color: "var(--error)" }}>{fmt(row.service_fee)}</td>
                        <td style={{ textAlign: "right", color: "var(--error)" }}>{fmt(row.payment_fee)}</td>
                        <td style={{ textAlign: "right", color: "var(--error)", fontWeight: 600 }}>{fmt(row.total_fees)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(row.shipping_net)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: row.net_profit >= 0 ? "var(--ok)" : "var(--error)" }}>
                          {fmt(row.net_profit)}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: marginColor(row.margin_pct) }}>
                          {fmtPct(row.margin_pct)}
                        </td>
                      </tr>
                    ))}
                    {/* Total row */}
                    {sortedPlatforms.length > 0 && (
                      <tr style={{ background: "var(--surface-2)", fontWeight: 700 }}>
                        <td>Total</td>
                        <td style={{ textAlign: "right" }}>{fmtInt(totals.orders)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(totals.gross_revenue)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(totals.cogs)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(totals.gross_profit)}</td>
                        <td style={{ textAlign: "right", color: "var(--error)" }}>{fmt(totals.commission)}</td>
                        <td style={{ textAlign: "right", color: "var(--error)" }}>{fmt(totals.service_fee)}</td>
                        <td style={{ textAlign: "right", color: "var(--error)" }}>{fmt(totals.payment_fee)}</td>
                        <td style={{ textAlign: "right", color: "var(--error)" }}>{fmt(totals.total_fees)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(totals.shipping_net)}</td>
                        <td style={{ textAlign: "right", color: totals.net_profit >= 0 ? "var(--ok)" : "var(--error)" }}>
                          {fmt(totals.net_profit)}
                        </td>
                        <td style={{ textAlign: "right", color: marginColor(totalMargin) }}>
                          {fmtPct(totalMargin)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Top / Bottom SKUs ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: "1rem" }}>SKU Profitability</div>
                <div style={{ display: "flex", gap: 4, background: "var(--surface-2)", borderRadius: 12, padding: 4, border: "1px solid var(--border)" }}>
                  <button
                    className={`tab${skuView === "top" ? " active" : ""}`}
                    style={{ padding: "6px 14px", fontSize: "0.85rem" }}
                    onClick={() => setSkuView("top")}>
                    Most Profitable
                  </button>
                  <button
                    className={`tab${skuView === "bottom" ? " active" : ""}`}
                    style={{ padding: "6px 14px", fontSize: "0.85rem" }}
                    onClick={() => setSkuView("bottom")}>
                    Least Profitable
                  </button>
                </div>
              </div>
              {skuData.length === 0 ? (
                <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 20 }}>No data</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>SKU</th>
                        <th>Name</th>
                        <th style={{ textAlign: "right" }}>Qty Sold</th>
                        <th style={{ textAlign: "right" }}>Revenue (฿)</th>
                        <th style={{ textAlign: "right" }}>Cost (฿)</th>
                        <th style={{ textAlign: "right" }}>Profit (฿)</th>
                        <th style={{ textAlign: "right" }}>Margin%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skuData.map((row, i) => (
                        <tr key={row.sku}>
                          <td style={{ color: "var(--text-muted)", textAlign: "center" }}>{i + 1}</td>
                          <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--purple)" }}>{row.sku}</td>
                          <td style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>{row.name ?? "–"}</td>
                          <td style={{ textAlign: "right" }}>{fmtInt(row.qty_sold)}</td>
                          <td style={{ textAlign: "right" }}>{fmt(row.revenue)}</td>
                          <td style={{ textAlign: "right" }}>{fmt(row.cost)}</td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: row.profit >= 0 ? "var(--ok)" : "var(--error)" }}>
                            {fmt(row.profit)}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: marginColor(row.margin_pct) }}>
                            {fmtPct(row.margin_pct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && !data && !error && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-muted)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: "1.1rem" }}>Loading report...</div>
          </div>
        )}
      </div>
    </div>
  );
}
