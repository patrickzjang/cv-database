"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type DateRange = "today" | "7d" | "30d" | "month" | "custom";

type Summary = {
  total_orders: number;
  gross_revenue: number;
  shop_discounts: number;
  platform_discounts: number;
  net_revenue: number;
  avg_order_value: number;
};

type StatusRow = { status: string; cnt: number };
type TrendRow  = { day: string; orders: number; revenue: number; paid: number; net_revenue: number };
type SkuRow    = { variation_sku: string; sku_name: string; total_qty: number; total_revenue: number };
type PlatformRow = { platform: string; orders: number; gross_revenue: number; platform_discounts: number; net_revenue: number };

type DashboardData = {
  from: string;
  to: string;
  summary: Summary;
  prevSummary?: Summary | null;
  rrpTotal?: number;
  prevRrpTotal?: number;
  statusBreakdown: StatusRow[];
  dailyTrend: TrendRow[];
  topSkus: SkuRow[];
  platformSummary: PlatformRow[];
  platformList: string[];
};

function pctChange(current: number | null | undefined, prev: number | null | undefined): string | null {
  if (!current || !prev || prev === 0) return null;
  const change = ((current - prev) / Math.abs(prev)) * 100;
  return change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`;
}

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

const STATUS_LABELS: Record<string, string> = {
  "0": "Pending",
  "1": "Awaiting Payment",
  "2": "Paid",
  "3": "Shipped",
  "4": "Completed",
  "5": "Cancelled",
  "6": "Returned",
};

const STATUS_COLORS: Record<string, string> = {
  "0": "#9db0d0",
  "1": "#f5a623",
  "2": "#5be49b",
  "3": "#3d5afe",
  "4": "#5be49b",
  "5": "#ff6b6b",
  "6": "#ff9f43",
};

function statusLabel(s: string) {
  return STATUS_LABELS[s] ?? s;
}
function statusColor(s: string) {
  return STATUS_COLORS[s] ?? "#9db0d0";
}

// ─── SVG Line Chart ──────────────────────────────────────────────────────────

function LineChart({ data }: { data: TrendRow[] }) {
  const W = 800, H = 180, PAD = { top: 12, right: 20, bottom: 32, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (!data.length) {
    return (
      <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        No data
      </div>
    );
  }

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const maxOrders = Math.max(...data.map((d) => d.orders), 1);

  const xOf = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * innerW;
  const yRevOf   = (v: number) => PAD.top + innerH - (v / maxRev) * innerH;
  const yOrdOf   = (v: number) => PAD.top + innerH - (v / maxOrders) * innerH;

  const revPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yRevOf(d.revenue)}`).join(" ");
  const netRevPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yRevOf(d.net_revenue ?? 0)}`).join(" ");
  const ordPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOrdOf(d.orders)}`).join(" ");

  // area fill for revenue
  const areaPath = revPath + ` L${xOf(data.length - 1)},${PAD.top + innerH} L${xOf(0)},${PAD.top + innerH} Z`;

  // Y-axis ticks (revenue)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD.top + innerH - f * innerH,
    label: fmt(maxRev * f).replace(".00", ""),
  }));

  // X-axis labels: show up to 10 evenly spaced
  const step = Math.max(1, Math.floor(data.length / 10));
  const xLabels = data
    .map((d, i) => ({ i, label: fmtDate(d.day) }))
    .filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
      <defs>
        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#3d5afe" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#3d5afe" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTicks.map((t) => (
        <g key={t.y}>
          <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
            stroke="var(--border-2)" strokeWidth="1" strokeDasharray="3 4" />
          <text x={PAD.left - 6} y={t.y + 4} textAnchor="end"
            fontSize="10" fill="var(--text-muted)">{t.label}</text>
        </g>
      ))}

      {/* Area */}
      <path d={areaPath} fill="url(#revGrad)" />

      {/* Gross revenue line */}
      <path d={revPath} fill="none" stroke="#3d5afe" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* Net revenue line */}
      <path d={netRevPath} fill="none" stroke="#00c853" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {/* Orders line */}
      <path d={ordPath} fill="none" stroke="#f5a623" strokeWidth="1.8" strokeDasharray="5 3"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* X labels */}
      {xLabels.map(({ i, label }) => (
        <text key={i} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
          {label}
        </text>
      ))}

      {/* Legend */}
      <rect x={PAD.left} y={2} width={10} height={10} rx="2" fill="#3d5afe" />
      <text x={PAD.left + 14} y={11} fontSize="10" fill="var(--text)">Gross</text>
      <rect x={PAD.left + 52} y={2} width={10} height={10} rx="2" fill="#00c853" />
      <text x={PAD.left + 66} y={11} fontSize="10" fill="var(--text)">Net</text>
      <line x1={PAD.left + 92} y1={7} x2={PAD.left + 102} y2={7} stroke="#f5a623" strokeWidth="2" strokeDasharray="4 2" />
      <text x={PAD.left + 106} y={11} fontSize="10" fill="var(--text)">Orders</text>
    </svg>
  );
}

// ─── Brand / Channel definitions ─────────────────────────────────────────────

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

// ─── Generic Multi-Select Filter ─────────────────────────────────────────────

function MultiSelectFilter({
  title,
  allLabel,
  options,
  selected,
  onChange,
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
            background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)", zIndex: 999, padding: 6,
          }}>
            <button
              className="ghost"
              style={{ width: "100%", textAlign: "left", marginBottom: 4,
                background: allSelected ? "rgba(30,64,175,0.08)" : "transparent",
                borderColor: allSelected ? "rgba(30,64,175,0.2)" : "transparent",
                color: allSelected ? "var(--app-accent)" : "var(--text-muted)",
                fontWeight: allSelected ? 600 : 400 }}
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
                    background: active ? "rgba(30,64,175,0.08)" : "transparent",
                    borderColor: active ? "rgba(30,64,175,0.2)" : "transparent",
                    color: active ? "var(--app-accent)" : "var(--text)",
                    fontWeight: active ? 600 : 400,
                    display: "flex", alignItems: "center", gap: 8 }}
                  onClick={() => toggle(code)}
                >
                  <span style={{ width: 14, height: 14, borderRadius: 3,
                    border: `2px solid ${active ? "var(--app-accent)" : "var(--border-2)"}`,
                    background: active ? "var(--app-accent)" : "transparent",
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

// ─── Main Dashboard ──────────────────────────────────────────────────────────

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "7 Days" },
  { key: "30d",   label: "Last Month" },
  { key: "month", label: "This Month" },
  { key: "custom",label: "Custom" },
];

export default function DashboardPage() {
  const router = useRouter();

  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [dateFrom,  setDateFrom]  = useState("");
  const [dateTo,    setDateTo]    = useState("");
  const [selectedBrands,   setSelectedBrands]   = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  // Top SKU table filter + sort
  const [skuSearch,  setSkuSearch]  = useState("");
  const [skuSort,    setSkuSort]    = useState<"total_qty" | "total_revenue" | "variation_sku">("total_qty");
  const [skuSortDir, setSkuSortDir] = useState<"desc" | "asc">("desc");

  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Compute cross-product of selected brands × channels → platform codes for API
  const effectivePlatforms = (() => {
    if (selectedBrands.length === 0 && selectedChannels.length === 0) return [];
    const brands   = selectedBrands.length   > 0 ? selectedBrands   : BRANDS.map((b) => b.code);
    const channels = selectedChannels.length > 0 ? selectedChannels : CHANNELS.map((c) => c.code);
    return brands.flatMap((b) => channels.map((c) => `${b}_${c}`));
  })();

  const fetchDashboard = useCallback(async () => {
    if (dateRange === "custom" && (!dateFrom || !dateTo)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateRange, dateFrom, dateTo, platforms: effectivePlatforms }),
      });
      const json = await res.json();
      if (json.error) {
        if (res.status === 401) { router.push("/login"); return; }
        setError(json.error);
      } else {
        setData(json);
      }
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [dateRange, dateFrom, dateTo, effectivePlatforms, router]);

  // Auto-fetch when filter changes (except custom which requires both dates)
  useEffect(() => {
    if (dateRange !== "custom") fetchDashboard();
  }, [dateRange, selectedBrands, selectedChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = data?.summary;
  const maxStatus = data?.statusBreakdown.reduce((m, r) => Math.max(m, r.cnt), 1) ?? 1;

  const filteredSkus = (data?.topSkus ?? [])
    .filter((r) => {
      const q = skuSearch.toLowerCase();
      return !q || r.variation_sku?.toLowerCase().includes(q) || r.sku_name?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const dir = skuSortDir === "desc" ? -1 : 1;
      if (skuSort === "variation_sku") return dir * a.variation_sku.localeCompare(b.variation_sku);
      return dir * ((a[skuSort] as number) - (b[skuSort] as number));
    });

  function toggleSkuSort(col: typeof skuSort) {
    if (skuSort === col) setSkuSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSkuSort(col); setSkuSortDir("desc"); }
  }

  function SortIcon({ col }: { col: typeof skuSort }) {
    if (skuSort !== col) return <span style={{ opacity: 0.3, fontSize: "0.7rem" }}>↕</span>;
    return <span style={{ fontSize: "0.7rem", color: "#8ea1ff" }}>{skuSortDir === "desc" ? "↓" : "↑"}</span>;
  }

  return (
    <div>
      <div className="page">
        {/* ── Filters ── */}
        <div className="card" style={{ marginBottom: 16, position: "relative", zIndex: 50 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>

            {/* Date range buttons */}
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

            {/* Custom date pickers */}
            {dateRange === "custom" && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 }}>FROM</div>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                    style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid var(--border-2)",
                      background: "var(--surface-2)", color: "var(--text)", fontSize: "0.9rem" }} />
                </div>
                <div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 }}>TO</div>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                    style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid var(--border-2)",
                      background: "var(--surface-2)", color: "var(--text)", fontSize: "0.9rem" }} />
                </div>
                <button className="primary" onClick={fetchDashboard}
                  disabled={!dateFrom || !dateTo || loading}
                  style={{ padding: "9px 16px" }}>
                  Apply
                </button>
              </div>
            )}

            {/* Brand + Channel filters */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <MultiSelectFilter
                title="BRAND"
                allLabel="All Brands"
                options={BRANDS}
                selected={selectedBrands}
                onChange={setSelectedBrands}
              />
              <MultiSelectFilter
                title="PLATFORM"
                allLabel="All Platforms"
                options={CHANNELS}
                selected={selectedChannels}
                onChange={setSelectedChannels}
              />
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ background: "rgba(220,38,38,0.06)", border: "1px solid #ff6b6b", borderRadius: 12,
            padding: "12px 16px", color: "#ff6b6b", marginBottom: 16 }}>
            ⚠ {error}
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: "1.4rem", marginBottom: 8 }}>⟳</div>
            Loading dashboard…
          </div>
        )}

        {!loading && data && (
          <>
            {/* ── Summary Cards (main row) ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 10 }}>
              {(() => {
                const prev = data?.prevSummary;
                const rrp = data?.rrpTotal ?? 0;
                const prevRrp = data?.prevRrpTotal ?? 0;
                const paidAmt = summary?.net_revenue ?? 0;
                const platDisc = summary?.platform_discounts ?? 0;
                const grossRev = paidAmt + platDisc; // Gross Revenue = paid_amount + platform discount
                const totalDisc = rrp - grossRev; // Discount = RRP - Gross Revenue (shop discount ที่ร้านแบกรับ)

                const prevPaid = prev?.net_revenue ?? 0;
                const prevPlatDisc = prev?.platform_discounts ?? 0;
                const prevGross = prevPaid + prevPlatDisc;
                const prevTotalDisc = prevRrp - prevGross;

                return [
                  { label: "Total Orders", value: fmtInt(summary?.total_orders), icon: "📦", color: "#3d5afe", change: pctChange(summary?.total_orders, prev?.total_orders) },
                  { label: "RRP", value: `฿${fmt(rrp)}`, icon: "💰", color: "#f5a623", tooltip: "ราคาป้ายรวม (จาก SKU pricing × จำนวน)", change: pctChange(rrp, prevRrp) },
                  { label: "Discounts", value: `-฿${fmt(totalDisc)}`, icon: "🏷️", color: "#ff6b6b", tooltip: "ส่วนลดจากร้าน (RRP - Gross Revenue)", change: pctChange(totalDisc, prevTotalDisc) },
                  { label: "Gross Revenue", value: `฿${fmt(grossRev)}`, icon: "✅", color: "#00c853", tooltip: "ยอดขายจริง = paid_amount + platform discount", change: pctChange(grossRev, prevGross) },
                ];
              })().map(({ label, value, icon, color, tooltip, change }) => (
                <div key={label} className="card" style={{ padding: "20px 22px" }} title={tooltip}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>{icon}</div>
                    {change && (
                      <span style={{
                        fontSize: "0.78rem", fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                        color: change.startsWith("+") ? "var(--ok)" : "var(--error)",
                        background: change.startsWith("+") ? "rgba(5,150,105,0.08)" : "rgba(220,38,38,0.08)",
                      }}>
                        {change}
                      </span>
                    )}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.82rem", fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 700, color, letterSpacing: "-0.02em" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Summary Cards (secondary row) ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
              {(() => {
                // Calculate cancel + return rate from status breakdown
                const totalOrders = summary?.total_orders || 0;
                const cancelCount = data?.statusBreakdown?.find((s) => s.status === "5" || s.status === "Cancelled")?.cnt ?? 0;
                const returnCount = data?.statusBreakdown?.find((s) => s.status === "6" || s.status === "Returned" || s.status === "Question")?.cnt ?? 0;
                const cancelRate = totalOrders > 0 ? ((cancelCount / totalOrders) * 100).toFixed(1) : "0";
                const returnRate = totalOrders > 0 ? ((returnCount / totalOrders) * 100).toFixed(1) : "0";
                return [
                  { label: "Avg Order Value", value: `฿${fmt(summary?.avg_order_value)}`, color: "var(--app-accent)" },
                  { label: "Cancel Rate", value: `${cancelRate}% (${fmtInt(cancelCount)})`, color: Number(cancelRate) > 10 ? "var(--error)" : Number(cancelRate) > 5 ? "var(--warn)" : "var(--ok)" },
                  { label: "Return Rate", value: `${returnRate}% (${fmtInt(returnCount)})`, color: Number(returnRate) > 5 ? "var(--error)" : Number(returnRate) > 2 ? "var(--warn)" : "var(--ok)" },
                ];
              })().map(({ label, value, color }) => (
                <div key={label} className="card" style={{ padding: "14px 18px" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 700, color, letterSpacing: "-0.02em" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Revenue Trend + Status Breakdown ── */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 16 }}>

              {/* Trend Chart */}
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: 14, fontSize: "1rem" }}>Revenue & Orders Trend</div>
                <LineChart data={data.dailyTrend} />
              </div>

              {/* Status Breakdown */}
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: 14, fontSize: "1rem" }}>Order Status</div>
                {data.statusBreakdown.length === 0 ? (
                  <div style={{ color: "var(--text-muted)" }}>No data</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {data.statusBreakdown.map((row) => {
                      const pct = Math.round((row.cnt / maxStatus) * 100);
                      const col = statusColor(row.status);
                      return (
                        <div key={row.status}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: "0.88rem" }}>
                            <span style={{ color: col, fontWeight: 600 }}>{statusLabel(row.status)}</span>
                            <span style={{ color: "var(--text-muted)" }}>{fmtInt(row.cnt)}</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 999, background: "var(--surface-2)" }}>
                            <div style={{ height: "100%", borderRadius: 999, width: `${pct}%`, background: col, transition: "width 0.4s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Platform Breakdown ── */}
            {(data.platformSummary ?? []).length > 0 && (() => {
              const sorted = [...data.platformSummary].sort((a, b) => (b.net_revenue ?? 0) - (a.net_revenue ?? 0));
              const totalNet = sorted.reduce((s, r) => s + (r.net_revenue ?? 0), 0);
              return (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 14, fontSize: "1rem" }}>Platform Breakdown</div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                      <thead>
                        <tr>
                          <th>Platform</th>
                          <th style={{ textAlign: "right" }}>Orders</th>
                          <th style={{ textAlign: "right" }}>Gross Revenue</th>
                          <th style={{ textAlign: "right" }}>Discounts</th>
                          <th style={{ textAlign: "right" }}>Net Revenue</th>
                          <th style={{ textAlign: "right" }}>% Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((row) => {
                          const pct = totalNet > 0 ? ((row.net_revenue ?? 0) / totalNet) * 100 : 0;
                          return (
                            <tr key={row.platform}>
                              <td style={{ fontWeight: 600 }}>{row.platform}</td>
                              <td style={{ textAlign: "right" }}>{fmtInt(row.orders)}</td>
                              <td style={{ textAlign: "right" }}>{fmt(row.gross_revenue)}</td>
                              <td style={{ textAlign: "right", color: "#ff6b6b" }}>-{fmt(row.platform_discounts)}</td>
                              <td style={{ textAlign: "right", fontWeight: 700, color: "#00c853" }}>{fmt(row.net_revenue)}</td>
                              <td style={{ textAlign: "right" }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                                  <div style={{ width: 60, height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
                                    <div style={{ height: "100%", borderRadius: 999, width: `${pct}%`, background: "linear-gradient(90deg, #3d5afe, #8ea1ff)", transition: "width 0.4s ease" }} />
                                  </div>
                                  <span style={{ minWidth: 40 }}>{pct.toFixed(1)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* ── Top Selling SKUs ── */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                  Top Selling Products <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: "0.85rem" }}>by VARIATION_SKU</span>
                </div>
                <input
                  type="text"
                  placeholder="Search SKU or name…"
                  value={skuSearch}
                  onChange={(e) => setSkuSearch(e.target.value)}
                  style={{
                    background: "var(--surface-2)", border: "1px solid var(--border-2)", borderRadius: 8,
                    color: "var(--text)", padding: "6px 12px", fontSize: "0.85rem", width: 200,
                    outline: "none",
                  }}
                />
              </div>
              {data.topSkus.length === 0 ? (
                <div style={{ color: "var(--text-muted)" }}>No data</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th onClick={() => toggleSkuSort("variation_sku")} style={{ cursor: "pointer", userSelect: "none" }}>
                          VARIATION SKU <SortIcon col="variation_sku" />
                        </th>
                        <th>Name</th>
                        <th style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }} onClick={() => toggleSkuSort("total_qty")}>
                          Qty Sold <SortIcon col="total_qty" />
                        </th>
                        <th style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }} onClick={() => toggleSkuSort("total_revenue")}>
                          Revenue (฿) <SortIcon col="total_revenue" />
                        </th>
                        <th style={{ width: 160 }}>Volume Bar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSkus.length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 20 }}>No matching SKUs</td></tr>
                      ) : (
                        filteredSkus.map((row, i) => {
                          const maxQty = Math.max(...filteredSkus.map((r) => r.total_qty), 1);
                          const pct = Math.round((row.total_qty / maxQty) * 100);
                          return (
                            <tr key={row.variation_sku}>
                              <td style={{ color: "var(--text-muted)", textAlign: "center" }}>{i + 1}</td>
                              <td>
                                <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--accent-2)" }}>
                                  {row.variation_sku}
                                </span>
                              </td>
                              <td style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>{row.sku_name ?? "–"}</td>
                              <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtInt(row.total_qty)}</td>
                              <td style={{ textAlign: "right" }}>{fmt(row.total_revenue)}</td>
                              <td>
                                <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
                                  <div style={{
                                    height: "100%", borderRadius: 999, width: `${pct}%`,
                                    background: "linear-gradient(90deg, #3d5afe, #8ea1ff)",
                                    transition: "width 0.4s ease",
                                  }} />
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty state (first load, not loading) */}
        {!loading && !data && !error && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-muted)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: "1.1rem" }}>Loading dashboard…</div>
          </div>
        )}
      </div>
    </div>
  );
}
