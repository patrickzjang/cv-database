"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type InventoryItem = {
  sku_id: string;
  sku_code: string;
  item_name: string;
  brand: string | null;
  available_qty: number;
  actual_qty: number;
  locked_qty: number;
  defective_qty: number;
  cost_price: number;
  rsp: number | null;
  rrp: number | null;
  avg_daily_sales: number | null;
  warehouse: string | null;
  stock_status: string;
  reorder_config: { min_stock: number; reorder_qty: number; lead_days: number } | null;
};

type SortKey = "sku_code" | "item_name" | "brand" | "available_qty" | "days_left" | "avg_daily_sales";
type SortDir = "asc" | "desc";
type AlertLevel = "critical" | "urgent" | "warning";

type AlertItem = InventoryItem & { alert_level: AlertLevel; days_left: number | null };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtInt(n: number | null | undefined): string {
  if (n == null) return "\u2013";
  return n.toLocaleString("th-TH");
}

function calcDaysLeft(item: InventoryItem): number | null {
  if (!item.avg_daily_sales || item.avg_daily_sales <= 0) return null;
  return Math.round(item.available_qty / item.avg_daily_sales);
}

function getMinStock(item: InventoryItem): number {
  return item.reorder_config?.min_stock ?? 0;
}

function getLeadDays(item: InventoryItem): number {
  return item.reorder_config?.lead_days ?? 7;
}

function classifyAlert(item: InventoryItem): AlertLevel | null {
  const sales = item.avg_daily_sales ?? 0;
  const dl = calcDaysLeft(item);
  const lead = getLeadDays(item);

  // Critical: out of stock with demand
  if (item.available_qty <= 0 && sales > 0) return "critical";
  // Urgent: will run out before reorder arrives, meaningful sales
  if (dl != null && dl <= lead && sales > 1) return "urgent";
  // Warning: within 2x lead time buffer, some sales
  if (dl != null && dl <= lead * 2 && sales > 0.5) return "warning";
  return null;
}

function downloadAlertsCsv(alerts: AlertItem[]) {
  const header = "Alert Level,SKU,Item Name,Brand,Available,Avg Daily Sales,Days Left,Lead Days,Suggested Order Qty\n";
  const body = alerts
    .map((r) => {
      const reorderQty = r.reorder_config?.reorder_qty || Math.max(10, Math.ceil((r.avg_daily_sales ?? 0) * getLeadDays(r) * 1.5));
      return `"${r.alert_level}","${r.sku_code}","${(r.item_name || "").replace(/"/g, '""')}","${r.brand || ""}",${r.available_qty},${r.avg_daily_sales?.toFixed(1) ?? ""},${r.days_left ?? ""},${getLeadDays(r)},${reorderQty}`;
    })
    .join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stock-alerts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BRANDS = ["ALL", "DAYBREAK", "PAN", "HEELCARE", "ARENA"] as const;
const WAREHOUSES = [
  { value: "", label: "All Warehouses" },
  { value: "WICE_BA_A", label: "WICE_BA_A" },
  { value: "WICE_PAF_A", label: "WICE_PAF_A" },
  { value: "WICE_WBLP_A", label: "WICE_WBLP_A" },
  { value: "WICE_WBLP_B", label: "WICE_WBLP_B" },
];
const STOCK_STATUSES = [
  { value: "all", label: "All Stock" },
  { value: "low_stock", label: "Low Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
];
const PAGE_SIZES = [50, 100, 200, 500, 1000] as const;

const ALERT_STYLES: Record<AlertLevel, { bg: string; color: string; border: string; label: string }> = {
  critical: { bg: "rgba(220,38,38,0.08)", color: "var(--error)", border: "rgba(220,38,38,0.25)", label: "Critical" },
  urgent:   { bg: "rgba(217,119,6,0.08)", color: "var(--warn)",  border: "rgba(217,119,6,0.25)", label: "Urgent" },
  warning:  { bg: "rgba(234,179,8,0.08)", color: "#b45309",      border: "rgba(234,179,8,0.25)", label: "Warning" },
};

const STATUS_BADGE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  normal:       { bg: "rgba(5,150,105,0.08)",  color: "var(--ok)",    border: "rgba(5,150,105,0.25)", label: "In Stock" },
  low_stock:    { bg: "rgba(217,119,6,0.08)",  color: "var(--warn)",  border: "rgba(217,119,6,0.25)", label: "Low Stock" },
  out_of_stock: { bg: "rgba(220,38,38,0.08)",  color: "var(--error)", border: "rgba(220,38,38,0.25)", label: "Out of Stock" },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState({ total_skus: 0, total_qty: 0, low_stock: 0, out_of_stock: 0, stock_value: 0 });

  // Filters
  const [brand, setBrand] = useState("ALL");
  const [warehouse, setWarehouse] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("available_qty");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Expanded row details
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Alert panel
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(true);

  // Modals
  const [alertModal, setAlertModal] = useState<{
    sku_code: string;
    min_stock: number;
    reorder_qty: number;
    lead_days: number;
  } | null>(null);
  const [adjustModal, setAdjustModal] = useState<{
    sku_id: string;
    sku_code: string;
    warehouse_id: number;
    warehouse_name: string;
    current_qty: number;
    new_qty: number;
  } | null>(null);

  const [alertSaving, setAlertSaving] = useState(false);
  const [adjustSaving, setAdjustSaving] = useState(false);

  // JST Sync
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (brand !== "ALL") params.set("brand", brand);
      if (warehouse) params.set("warehouse", warehouse);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("q", search.trim());
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const res = await fetch(`/api/inventory?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setItems(json.data ?? json.items ?? []);
      setTotal(json.total ?? 0);
      if (json.summary) setSummary(json.summary);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load inventory");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [brand, warehouse, statusFilter, search, page, pageSize]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  // ─── Debounced search ───────────────────────────────────────────────────────

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setPage(1), 350);
  };

  // ─── Sort ───────────────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sortedItems = [...items].sort((a, b) => {
    let va: number | string;
    let vb: number | string;
    if (sortKey === "days_left") {
      va = calcDaysLeft(a) ?? 99999;
      vb = calcDaysLeft(b) ?? 99999;
    } else if (sortKey === "avg_daily_sales") {
      va = a.avg_daily_sales ?? -1;
      vb = b.avg_daily_sales ?? -1;
    } else {
      va = (a[sortKey as keyof InventoryItem] as number | string) ?? "";
      vb = (b[sortKey as keyof InventoryItem] as number | string) ?? "";
    }
    if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
    return sortDir === "asc" ? va - (vb as number) : (vb as number) - va;
  });

  // ─── Smart alerts ──────────────────────────────────────────────────────────

  const alerts: AlertItem[] = items
    .map((item) => {
      const level = classifyAlert(item);
      if (!level) return null;
      return { ...item, alert_level: level, days_left: calcDaysLeft(item) };
    })
    .filter(Boolean) as AlertItem[];

  // Sort: critical first, then urgent, then warning; within each by days_left asc
  const alertOrder: Record<AlertLevel, number> = { critical: 0, urgent: 1, warning: 2 };
  alerts.sort((a, b) => {
    const oa = alertOrder[a.alert_level] - alertOrder[b.alert_level];
    if (oa !== 0) return oa;
    return (a.days_left ?? 99999) - (b.days_left ?? 99999);
  });

  const criticalCount = alerts.filter((a) => a.alert_level === "critical").length;
  const urgentCount = alerts.filter((a) => a.alert_level === "urgent").length;
  const warningCount = alerts.filter((a) => a.alert_level === "warning").length;

  // ─── Summary ────────────────────────────────────────────────────────────────

  // Summary from API — covers ALL filtered data, not just current page
  const { total_skus: totalSkus, total_qty: totalQty, low_stock: lowStock, out_of_stock: outOfStock, stock_value: totalValue } = summary;

  // ─── Alert save ─────────────────────────────────────────────────────────────

  const saveAlert = async () => {
    if (!alertModal) return;
    setAlertSaving(true);
    try {
      const res = await fetch("/api/inventory/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: [{
            sku_code: alertModal.sku_code,
            min_stock: alertModal.min_stock,
            reorder_qty: alertModal.reorder_qty,
            lead_days: alertModal.lead_days,
          }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAlertModal(null);
      fetchInventory();
    } catch {
      window.alert("Failed to save alert configuration");
    } finally {
      setAlertSaving(false);
    }
  };

  // ─── Adjust save ──────────────────────────────────────────────────────────

  const saveAdjust = async () => {
    if (!adjustModal) return;
    setAdjustSaving(true);
    try {
      const res = await fetch("/api/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: adjustModal.warehouse_id,
          items: [{ sku_id: adjustModal.sku_id, after_qty: adjustModal.new_qty }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAdjustModal(null);
      fetchInventory();
    } catch {
      window.alert("Failed to adjust stock");
    } finally {
      setAdjustSaving(false);
    }
  };

  // ─── JST Sync ───────────────────────────────────────────────────────────────

  const syncFromJst = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/inventory/sync", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        const whInfo = json.warehouses?.length ? ` (${json.warehouses.join(", ")})` : "";
        setSyncResult(`Synced ${json.rows} items from JST${whInfo}`);
        fetchInventory();
      } else {
        setSyncResult(`Error: ${json.error}`);
      }
    } catch {
      setSyncResult("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // ─── Pagination ─────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleExpand = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return " \u2195";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 className="grad-text" style={{ fontSize: "1.5rem" }}>Inventory Management</h1>
          <p className="subtitle">Monitor stock levels, smart alerts for high-demand items</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {syncResult && (
            <span style={{ fontSize: "0.82rem", color: syncResult.startsWith("Error") ? "var(--error)" : "var(--ok)" }}>
              {syncResult}
            </span>
          )}
          <button className="ghost" onClick={syncFromJst} disabled={syncing} style={{ fontSize: "0.85rem", padding: "8px 16px", display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M1 8a7 7 0 0 1 13-3.5M15 8a7 7 0 0 1-13 3.5" />
              <path d="M14 1v4h-4" /><path d="M2 15v-4h4" />
            </svg>
            {syncing ? "Syncing..." : "Sync from JST"}
          </button>
        </div>
      </div>

      {/* Smart Stock Alerts Panel */}
      {alerts.length > 0 && (
        <div className="card" style={{ marginBottom: 16, border: "1px solid rgba(220,38,38,0.15)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setAlertsPanelOpen(!alertsPanelOpen)}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Stock Alerts</h3>
              {criticalCount > 0 && (
                <span className="badge" style={{ background: ALERT_STYLES.critical.bg, color: ALERT_STYLES.critical.color, borderColor: ALERT_STYLES.critical.border }}>
                  {criticalCount} Critical
                </span>
              )}
              {urgentCount > 0 && (
                <span className="badge" style={{ background: ALERT_STYLES.urgent.bg, color: ALERT_STYLES.urgent.color, borderColor: ALERT_STYLES.urgent.border }}>
                  {urgentCount} Urgent
                </span>
              )}
              {warningCount > 0 && (
                <span className="badge" style={{ background: ALERT_STYLES.warning.bg, color: ALERT_STYLES.warning.color, borderColor: ALERT_STYLES.warning.border }}>
                  {warningCount} Warning
                </span>
              )}
            </div>
            <span style={{ fontSize: "1.2rem", color: "var(--text-muted)", transform: alertsPanelOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>{"\u25BC"}</span>
          </div>

          {alertsPanelOpen && (
            <div style={{ marginTop: 14 }}>
              <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", margin: "0 0 10px" }}>
                Only showing SKUs with significant sales volume that are running low or out of stock.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="results-table">
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Alert</th>
                      <th style={{ width: 130 }}>SKU</th>
                      <th style={{ minWidth: 160 }}>Item Name</th>
                      <th style={{ width: 80 }}>Brand</th>
                      <th style={{ width: 90, textAlign: "right" }}>Available</th>
                      <th style={{ width: 100, textAlign: "right" }}>Avg Sales/Day</th>
                      <th style={{ width: 80, textAlign: "right" }}>Days Left</th>
                      <th style={{ width: 80, textAlign: "right" }}>Lead Days</th>
                      <th style={{ width: 110, textAlign: "right" }}>Order Qty</th>
                      <th style={{ width: 80 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((item) => {
                      const style = ALERT_STYLES[item.alert_level];
                      const suggestedQty = item.reorder_config?.reorder_qty || Math.max(10, Math.ceil((item.avg_daily_sales ?? 0) * getLeadDays(item) * 1.5));
                      return (
                        <tr key={`alert-${item.sku_code}`}>
                          <td>
                            <span className="badge" style={{ background: style.bg, color: style.color, borderColor: style.border, fontSize: "0.72rem" }}>
                              {style.label}
                            </span>
                          </td>
                          <td><span style={{ fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, fontSize: "0.82rem" }}>{item.sku_code}</span></td>
                          <td style={{ fontSize: "0.85rem" }}>{item.item_name}</td>
                          <td style={{ fontSize: "0.82rem" }}>{item.brand || "\u2013"}</td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: item.available_qty <= 0 ? "var(--error)" : undefined }}>{fmtInt(item.available_qty)}</td>
                          <td style={{ textAlign: "right", fontSize: "0.85rem" }}>{item.avg_daily_sales?.toFixed(1) ?? "\u2013"}</td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: item.days_left != null && item.days_left <= 7 ? "var(--error)" : item.days_left != null && item.days_left <= 14 ? "var(--warn)" : undefined }}>
                            {item.days_left != null ? `${item.days_left}d` : "\u2014"}
                          </td>
                          <td style={{ textAlign: "right" }}>{getLeadDays(item)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtInt(suggestedQty)}</td>
                          <td>
                            <button className="ghost" style={{ padding: "4px 10px", fontSize: "0.75rem" }} onClick={() => setAlertModal({
                              sku_code: item.sku_code,
                              min_stock: getMinStock(item),
                              reorder_qty: item.reorder_config?.reorder_qty ?? suggestedQty,
                              lead_days: getLeadDays(item),
                            })}>
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="primary" style={{ fontSize: "0.85rem", padding: "8px 18px" }} onClick={() => downloadAlertsCsv(alerts)}>
                  Export Alerts CSV
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 22 }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Available</div>
          <div className="kpi-value grad-text">{fmtInt(totalQty)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total SKUs</div>
          <div className="kpi-value grad-text">{fmtInt(totalSkus)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Low Stock</div>
          <div className="kpi-value" style={{ color: "var(--warn)" }}>{fmtInt(lowStock)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Out of Stock</div>
          <div className="kpi-value" style={{ color: "var(--error)" }}>{fmtInt(outOfStock)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Stock Value (RSP)</div>
          <div className="kpi-value grad-text" style={{ fontSize: "1.2rem" }}>{totalValue.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select className="select" value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }} style={{ minWidth: 130 }}>
            {BRANDS.map((b) => <option key={b} value={b}>{b === "ALL" ? "All Brands" : b}</option>)}
          </select>
          <select className="select" value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setPage(1); }} style={{ minWidth: 180 }}>
            {WAREHOUSES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
          <select className="select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ minWidth: 130 }}>
            {STOCK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <input type="text" placeholder="Search SKU or product name..." value={search} onChange={(e) => handleSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        </div>
      </div>

      {/* Pagination + Rows per page */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem" }}>
          <span style={{ color: "var(--text-muted)" }}>Rows per page:</span>
          <select className="select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ width: 80, padding: "4px 8px", fontSize: "0.85rem" }}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>{total} total</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="ghost" style={{ padding: "6px 14px", fontSize: "0.85rem" }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span className="pager-info">Page {page} / {totalPages}</span>
          <button className="ghost" style={{ padding: "6px 14px", fontSize: "0.85rem" }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)", color: "var(--error)", marginBottom: 14, fontSize: "0.9rem" }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="results-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th style={{ cursor: "pointer", userSelect: "none", width: 130 }} onClick={() => handleSort("sku_code")}>SKU{sortIndicator("sku_code")}</th>
                <th style={{ cursor: "pointer", userSelect: "none", minWidth: 180 }} onClick={() => handleSort("item_name")}>Item Name{sortIndicator("item_name")}</th>
                <th style={{ cursor: "pointer", userSelect: "none", width: 90 }} onClick={() => handleSort("brand")}>Brand{sortIndicator("brand")}</th>
                <th style={{ cursor: "pointer", userSelect: "none", width: 90, textAlign: "right" }} onClick={() => handleSort("available_qty")}>Available{sortIndicator("available_qty")}</th>
                <th style={{ width: 100, textAlign: "center" }}>Status</th>
                <th style={{ cursor: "pointer", userSelect: "none", width: 100, textAlign: "right" }} onClick={() => handleSort("avg_daily_sales")}>Sales/Day{sortIndicator("avg_daily_sales")}</th>
                <th style={{ cursor: "pointer", userSelect: "none", width: 90, textAlign: "right" }} onClick={() => handleSort("days_left")}>Days Left{sortIndicator("days_left")}</th>
                <th style={{ width: 120 }}>Warehouse</th>
                <th style={{ width: 130, textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading inventory...</td></tr>
              ) : sortedItems.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No inventory items found</td></tr>
              ) : (
                sortedItems.map((item, idx) => {
                  const rowKey = `${item.sku_code}-${idx}`;
                  const badge = STATUS_BADGE[item.stock_status] || STATUS_BADGE.normal;
                  const dl = calcDaysLeft(item);
                  const isExpanded = expandedRows.has(rowKey);

                  return (
                    <tr key={rowKey} style={{ cursor: "pointer" }} onClick={() => toggleExpand(rowKey)}>
                      <td style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>{isExpanded ? "\u25BE" : "\u25B8"}</td>
                      <td><span style={{ fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, fontSize: "0.82rem" }}>{item.sku_code}</span></td>
                      <td>{item.item_name}</td>
                      <td style={{ fontSize: "0.82rem" }}>{item.brand || "\u2013"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtInt(item.available_qty)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className="badge" style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}>{badge.label}</span>
                      </td>
                      <td style={{ textAlign: "right", fontSize: "0.85rem" }}>{item.avg_daily_sales?.toFixed(1) ?? "\u2013"}</td>
                      <td style={{ textAlign: "right" }}>
                        {dl != null ? (
                          <span style={{ fontWeight: 600, color: dl <= 7 ? "var(--error)" : dl <= 14 ? "var(--warn)" : "var(--text)" }}>{dl}d</span>
                        ) : <span style={{ color: "var(--text-muted)" }}>{"\u2014"}</span>}
                      </td>
                      <td style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{item.warehouse || "\u2013"}</td>
                      <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                          <button className="ghost" style={{ padding: "4px 8px", fontSize: "0.75rem" }} onClick={() => setAlertModal({
                            sku_code: item.sku_code,
                            min_stock: getMinStock(item),
                            reorder_qty: item.reorder_config?.reorder_qty ?? 0,
                            lead_days: getLeadDays(item),
                          })}>Alert</button>
                          <button className="ghost" style={{ padding: "4px 8px", fontSize: "0.75rem" }} onClick={() => setAdjustModal({
                            sku_id: item.sku_id,
                            sku_code: item.sku_code,
                            warehouse_id: 0,
                            warehouse_name: "Total",
                            current_qty: item.available_qty,
                            new_qty: item.available_qty,
                          })}>Adjust</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Expanded row details */}
          {sortedItems.map((item, idx) => {
            const rowKey = `${item.sku_code}-${idx}`;
            if (!expandedRows.has(rowKey)) return null;
            return (
              <div key={`detail-${rowKey}`} style={{ padding: "12px 20px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>
                {/* Summary stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px 20px", marginBottom: 0 }}>
                  <div><span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Actual Qty</span><br /><strong>{fmtInt(item.actual_qty)}</strong></div>
                  <div><span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Locked</span><br /><strong>{fmtInt(item.locked_qty)}</strong></div>
                  <div><span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Defective</span><br /><strong>{fmtInt(item.defective_qty)}</strong></div>
                  <div><span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Min Stock</span><br /><strong>{fmtInt(getMinStock(item))}</strong></div>
                  <div><span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Reorder Qty</span><br /><strong>{fmtInt(item.reorder_config?.reorder_qty ?? 0)}</strong></div>
                  <div><span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Lead Days</span><br /><strong>{getLeadDays(item)}</strong></div>
                  <div><span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Cost Price</span><br /><strong>{item.cost_price?.toLocaleString("th-TH", { minimumFractionDigits: 2 }) ?? "\u2013"}</strong></div>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Alert Configuration Modal */}
      {alertModal && (
        <div className="modal modal-center">
          <div className="modal-backdrop" onClick={() => setAlertModal(null)} />
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <span className="modal-title">Stock Alert: {alertModal.sku_code}</span>
              <button className="ghost" style={{ padding: "4px 10px", fontSize: "1rem" }} onClick={() => setAlertModal(null)}>{"\u2715"}</button>
            </div>
            <div className="modal-body" style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Min Stock</label>
                <input type="number" min={0} value={alertModal.min_stock} onChange={(e) => setAlertModal({ ...alertModal, min_stock: parseInt(e.target.value) || 0 })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Reorder Quantity</label>
                <input type="number" min={0} value={alertModal.reorder_qty} onChange={(e) => setAlertModal({ ...alertModal, reorder_qty: parseInt(e.target.value) || 0 })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Lead Days</label>
                <input type="number" min={0} value={alertModal.lead_days} onChange={(e) => setAlertModal({ ...alertModal, lead_days: parseInt(e.target.value) || 0 })} style={{ width: "100%" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button className="ghost" onClick={() => setAlertModal(null)}>Cancel</button>
                <button className="primary" onClick={saveAlert} disabled={alertSaving}>{alertSaving ? "Saving..." : "Save"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustModal && (
        <div className="modal modal-center">
          <div className="modal-backdrop" onClick={() => setAdjustModal(null)} />
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <span className="modal-title">Adjust Stock: {adjustModal.sku_code}</span>
              <button className="ghost" style={{ padding: "4px 10px", fontSize: "1rem" }} onClick={() => setAdjustModal(null)}>{"\u2715"}</button>
            </div>
            <div className="modal-body" style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Inventory</label>
                <input type="text" value="Total (all warehouses)" readOnly style={{ width: "100%", background: "var(--surface-2)", cursor: "default" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Current Quantity</label>
                <input type="number" value={adjustModal.current_qty} readOnly style={{ width: "100%", background: "var(--surface-2)", cursor: "default" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>New Quantity</label>
                <input type="number" min={0} value={adjustModal.new_qty} onChange={(e) => setAdjustModal({ ...adjustModal, new_qty: parseInt(e.target.value) || 0 })} style={{ width: "100%" }} />
              </div>
              <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.2)", color: "var(--warn)", fontSize: "0.85rem", fontWeight: 500 }}>
                This will adjust stock in JST ERP
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button className="ghost" onClick={() => setAdjustModal(null)}>Cancel</button>
                <button className="primary" onClick={saveAdjust} disabled={adjustSaving}>{adjustSaving ? "Confirming..." : "Confirm"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
