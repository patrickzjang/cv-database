"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type InventoryItem = {
  sku_id: string;
  sku_code: string;
  item_name: string;
  warehouse_id: number;
  warehouse_name: string;
  available_qty: number;
  actual_qty: number;
  locked_qty: number;
  defective_qty: number;
  min_stock: number;
  reorder_qty: number;
  lead_days: number;
  cost_price: number;
  avg_daily_sales: number | null;
};

type InventoryResponse = {
  items: InventoryItem[];
  total: number;
  page: number;
  pageSize: number;
};

type AlertConfig = {
  sku_id: string;
  sku_code: string;
  min_stock: number;
  reorder_qty: number;
  lead_days: number;
};

type SortKey =
  | "sku_code"
  | "item_name"
  | "warehouse_name"
  | "available_qty"
  | "actual_qty"
  | "locked_qty"
  | "defective_qty"
  | "min_stock"
  | "days_left";

type SortDir = "asc" | "desc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "\u2013";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return "\u2013";
  return n.toLocaleString("th-TH");
}

function stockStatus(item: InventoryItem): "ok" | "low" | "out" {
  if (item.available_qty === 0) return "out";
  if (item.available_qty <= item.min_stock) return "low";
  return "ok";
}

function daysLeft(item: InventoryItem): number | null {
  if (!item.avg_daily_sales || item.avg_daily_sales <= 0) return null;
  return Math.round(item.available_qty / item.avg_daily_sales);
}

function downloadCsv(rows: InventoryItem[]) {
  const header = "SKU,Current Stock,Min Stock,Suggested Reorder Qty,Lead Days\n";
  const body = rows
    .map(
      (r) =>
        `"${r.sku_code}",${r.available_qty},${r.min_stock},${r.reorder_qty || r.min_stock * 2},${r.lead_days || 7}`
    )
    .join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reorder-list-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BRANDS = ["ALL", "DAYBREAK", "PAN", "HEELCARE", "ARENA"] as const;
const WAREHOUSES = [
  { id: 0, name: "All Warehouses" },
  { id: 1, name: "Main Warehouse" },
  { id: 2, name: "Secondary Warehouse" },
  { id: 3, name: "Returns Warehouse" },
];
const STOCK_STATUSES = ["all", "low", "out"] as const;
const PAGE_SIZE = 50;

const STATUS_BADGE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  ok:  { bg: "rgba(5,150,105,0.08)",  color: "var(--ok)",    border: "rgba(5,150,105,0.25)", label: "In Stock" },
  low: { bg: "rgba(217,119,6,0.08)",  color: "var(--warn)",  border: "rgba(217,119,6,0.25)", label: "Low Stock" },
  out: { bg: "rgba(220,38,38,0.08)",  color: "var(--error)", border: "rgba(220,38,38,0.25)", label: "Out of Stock" },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function InventoryPage() {
  // Data
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [brand, setBrand] = useState("ALL");
  const [warehouseId, setWarehouseId] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | "low" | "out">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("available_qty");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Modals
  const [alertModal, setAlertModal] = useState<AlertConfig | null>(null);
  const [adjustModal, setAdjustModal] = useState<{
    sku_id: string;
    sku_code: string;
    warehouse_id: number;
    warehouse_name: string;
    current_qty: number;
    new_qty: number;
  } | null>(null);

  // Reorder panel
  const [reorderOpen, setReorderOpen] = useState(false);

  // Saving states
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
      if (warehouseId) params.set("warehouse_id", String(warehouseId));
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("q", search.trim());
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));

      const res = await fetch(`/api/inventory?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setItems(json.data ?? json.items ?? []);
      setTotal(json.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load inventory");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [brand, warehouseId, statusFilter, search, page]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  // ─── Debounced search ───────────────────────────────────────────────────────

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
    }, 350);
  };

  // ─── Sort logic ─────────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedItems = [...items].sort((a, b) => {
    let va: number | string;
    let vb: number | string;
    if (sortKey === "days_left") {
      va = daysLeft(a) ?? 99999;
      vb = daysLeft(b) ?? 99999;
    } else {
      va = a[sortKey as keyof InventoryItem] as number | string;
      vb = b[sortKey as keyof InventoryItem] as number | string;
    }
    if (typeof va === "string") {
      return sortDir === "asc"
        ? (va as string).localeCompare(vb as string)
        : (vb as string).localeCompare(va as string);
    }
    return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
  });

  // ─── Summary calculations ─────────────────────────────────────────────────

  const totalSkus = items.length;
  const lowStock = items.filter((i) => i.available_qty > 0 && i.available_qty <= i.min_stock).length;
  const outOfStock = items.filter((i) => i.available_qty === 0).length;
  const totalValue = items.reduce((s, i) => s + i.available_qty * (i.cost_price || 0), 0);
  const reorderItems = items.filter((i) => i.available_qty <= i.min_stock);

  // ─── Alert save ─────────────────────────────────────────────────────────────

  const saveAlert = async () => {
    if (!alertModal) return;
    setAlertSaving(true);
    try {
      const res = await fetch("/api/inventory/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: [
            {
              sku_id: alertModal.sku_id,
              min_stock: alertModal.min_stock,
              reorder_qty: alertModal.reorder_qty,
              lead_days: alertModal.lead_days,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAlertModal(null);
      fetchInventory();
    } catch {
      alert("Failed to save alert configuration");
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
      alert("Failed to adjust stock");
    } finally {
      setAdjustSaving(false);
    }
  };

  // ─── Pagination ─────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const thStyle = (key: SortKey): React.CSSProperties => ({
    cursor: "pointer",
    userSelect: "none",
  });

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return " \u2195";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  // ─── JST Sync ───────────────────────────────────────────────────────────────

  const syncFromJst = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/inventory/sync", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        setSyncResult(`Synced ${json.rows} items from JST`);
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="grad-text" style={{ fontSize: "1.5rem" }}>
            Inventory Management
          </h1>
          <p className="subtitle">Monitor stock levels, set alerts, and manage reorders</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {syncResult && (
            <span style={{ fontSize: "0.82rem", color: syncResult.startsWith("Error") ? "var(--error)" : "var(--ok)" }}>
              {syncResult}
            </span>
          )}
          <button
            className="ghost"
            onClick={syncFromJst}
            disabled={syncing}
            style={{ fontSize: "0.85rem", padding: "8px 16px", display: "flex", alignItems: "center", gap: 6 }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M1 8a7 7 0 0 1 13-3.5M15 8a7 7 0 0 1-13 3.5" />
              <path d="M14 1v4h-4" /><path d="M2 15v-4h4" />
            </svg>
            {syncing ? "Syncing..." : "Sync from JST"}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
          marginBottom: 22,
        }}
      >
        {/* Total SKUs */}
        <div className="kpi-card">
          <div className="kpi-label">Total SKUs</div>
          <div className="kpi-value grad-text">{fmtInt(totalSkus)}</div>
        </div>

        {/* Low Stock */}
        <div className="kpi-card">
          <div className="kpi-label">Low Stock</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="kpi-value" style={{ color: "var(--warn)" }}>
              {fmtInt(lowStock)}
            </div>
            {lowStock > 0 && (
              <span
                className="badge"
                style={{
                  background: "rgba(217,119,6,0.08)",
                  color: "var(--warn)",
                  borderColor: "rgba(217,119,6,0.25)",
                  fontSize: "0.7rem",
                }}
              >
                Needs Attention
              </span>
            )}
          </div>
        </div>

        {/* Out of Stock */}
        <div className="kpi-card">
          <div className="kpi-label">Out of Stock</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="kpi-value" style={{ color: "var(--error)" }}>
              {fmtInt(outOfStock)}
            </div>
            {outOfStock > 0 && (
              <span
                className="badge"
                style={{
                  background: "rgba(220,38,38,0.08)",
                  color: "var(--error)",
                  borderColor: "rgba(220,38,38,0.25)",
                  fontSize: "0.7rem",
                }}
              >
                Critical
              </span>
            )}
          </div>
        </div>

        {/* Total Stock Value */}
        <div className="kpi-card">
          <div className="kpi-label">Total Stock Value</div>
          <div className="kpi-value grad-text" style={{ fontSize: "1.4rem" }}>
            {fmt(totalValue)}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {/* Brand */}
          <select
            className="select"
            value={brand}
            onChange={(e) => {
              setBrand(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: 130 }}
          >
            {BRANDS.map((b) => (
              <option key={b} value={b}>
                {b === "ALL" ? "All Brands" : b}
              </option>
            ))}
          </select>

          {/* Warehouse */}
          <select
            className="select"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(Number(e.target.value));
              setPage(1);
            }}
            style={{ minWidth: 160 }}
          >
            {WAREHOUSES.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>

          {/* Stock Status */}
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as "all" | "low" | "out");
              setPage(1);
            }}
            style={{ minWidth: 130 }}
          >
            <option value="all">All Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>

          {/* Search */}
          <input
            type="text"
            placeholder="Search SKU or product name..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.2)",
            color: "var(--error)",
            marginBottom: 14,
            fontSize: "0.9rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="results-table">
            <thead>
              <tr>
                <th style={{ ...thStyle("sku_code"), width: 120 }} onClick={() => handleSort("sku_code")}>
                  SKU Code{sortIndicator("sku_code")}
                </th>
                <th style={{ ...thStyle("item_name"), minWidth: 180 }} onClick={() => handleSort("item_name")}>
                  Item Name{sortIndicator("item_name")}
                </th>
                <th style={{ ...thStyle("warehouse_name"), width: 130 }} onClick={() => handleSort("warehouse_name")}>
                  Warehouse{sortIndicator("warehouse_name")}
                </th>
                <th style={{ ...thStyle("available_qty"), width: 90, textAlign: "right" }} onClick={() => handleSort("available_qty")}>
                  Available{sortIndicator("available_qty")}
                </th>
                <th style={{ ...thStyle("actual_qty"), width: 80, textAlign: "right" }} onClick={() => handleSort("actual_qty")}>
                  Actual{sortIndicator("actual_qty")}
                </th>
                <th style={{ ...thStyle("locked_qty"), width: 80, textAlign: "right" }} onClick={() => handleSort("locked_qty")}>
                  Locked{sortIndicator("locked_qty")}
                </th>
                <th style={{ ...thStyle("defective_qty"), width: 90, textAlign: "right" }} onClick={() => handleSort("defective_qty")}>
                  Defective{sortIndicator("defective_qty")}
                </th>
                <th style={{ ...thStyle("min_stock"), width: 90, textAlign: "right" }} onClick={() => handleSort("min_stock")}>
                  Min Stock{sortIndicator("min_stock")}
                </th>
                <th style={{ width: 100, textAlign: "center" }}>Status</th>
                <th style={{ ...thStyle("days_left"), width: 90, textAlign: "right" }} onClick={() => handleSort("days_left")}>
                  Days Left{sortIndicator("days_left")}
                </th>
                <th style={{ width: 150, textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                    Loading inventory...
                  </td>
                </tr>
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                    No inventory items found
                  </td>
                </tr>
              ) : (
                sortedItems.map((item) => {
                  const status = stockStatus(item);
                  const badge = STATUS_BADGE[status];
                  const dl = daysLeft(item);
                  return (
                    <tr key={`${item.sku_id}-${item.warehouse_id}`}>
                      <td>
                        <span
                          style={{
                            fontFamily: '"IBM Plex Mono", monospace',
                            fontWeight: 600,
                            fontSize: "0.82rem",
                          }}
                        >
                          {item.sku_code}
                        </span>
                      </td>
                      <td>{item.item_name}</td>
                      <td>{item.warehouse_name}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtInt(item.available_qty)}</td>
                      <td style={{ textAlign: "right" }}>{fmtInt(item.actual_qty)}</td>
                      <td style={{ textAlign: "right" }}>{fmtInt(item.locked_qty)}</td>
                      <td style={{ textAlign: "right" }}>{fmtInt(item.defective_qty)}</td>
                      <td style={{ textAlign: "right" }}>{fmtInt(item.min_stock)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span
                          className="badge"
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderColor: badge.border,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {dl != null ? (
                          <span style={{ color: dl <= 7 ? "var(--error)" : dl <= 14 ? "var(--warn)" : "var(--text)" }}>
                            {dl}d
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>{"\u2014"}</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <button
                            className="ghost"
                            style={{ padding: "5px 10px", fontSize: "0.78rem" }}
                            onClick={() =>
                              setAlertModal({
                                sku_id: item.sku_id,
                                sku_code: item.sku_code,
                                min_stock: item.min_stock,
                                reorder_qty: item.reorder_qty || 0,
                                lead_days: item.lead_days || 7,
                              })
                            }
                          >
                            Set Alert
                          </button>
                          <button
                            className="ghost"
                            style={{ padding: "5px 10px", fontSize: "0.78rem" }}
                            onClick={() =>
                              setAdjustModal({
                                sku_id: item.sku_id,
                                sku_code: item.sku_code,
                                warehouse_id: item.warehouse_id,
                                warehouse_name: item.warehouse_name,
                                current_qty: item.available_qty,
                                new_qty: item.available_qty,
                              })
                            }
                          >
                            Adjust
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            className="pager"
            style={{
              padding: "12px 16px",
              borderTop: "1px solid var(--border)",
              justifyContent: "center",
            }}
          >
            <button
              className="ghost"
              style={{ padding: "6px 14px", fontSize: "0.85rem" }}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className="pager-info">
              Page {page} of {totalPages}
            </span>
            <button
              className="ghost"
              style={{ padding: "6px 14px", fontSize: "0.85rem" }}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Reorder Suggestions Panel */}
      <div className="card" style={{ marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
          }}
          onClick={() => setReorderOpen(!reorderOpen)}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
              Reorder Suggestions
              {reorderItems.length > 0 && (
                <span
                  className="badge"
                  style={{
                    marginLeft: 8,
                    background: "rgba(217,119,6,0.08)",
                    color: "var(--warn)",
                    borderColor: "rgba(217,119,6,0.25)",
                  }}
                >
                  {reorderItems.length}
                </span>
              )}
            </h3>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
              Items at or below minimum stock level
            </p>
          </div>
          <span
            style={{
              fontSize: "1.2rem",
              color: "var(--text-muted)",
              transform: reorderOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            {"\u25BC"}
          </span>
        </div>

        {reorderOpen && (
          <div style={{ marginTop: 14 }}>
            {reorderItems.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>
                No items currently need reordering.
              </p>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th style={{ width: 120 }}>SKU</th>
                        <th style={{ width: 100, textAlign: "right" }}>Current Stock</th>
                        <th style={{ width: 100, textAlign: "right" }}>Min Stock</th>
                        <th style={{ width: 140, textAlign: "right" }}>Suggested Reorder Qty</th>
                        <th style={{ width: 90, textAlign: "right" }}>Lead Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorderItems.map((item) => (
                        <tr key={`reorder-${item.sku_id}-${item.warehouse_id}`}>
                          <td>
                            <span
                              style={{
                                fontFamily: '"IBM Plex Mono", monospace',
                                fontWeight: 600,
                                fontSize: "0.82rem",
                              }}
                            >
                              {item.sku_code}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>{fmtInt(item.available_qty)}</td>
                          <td style={{ textAlign: "right" }}>{fmtInt(item.min_stock)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>
                            {fmtInt(item.reorder_qty || item.min_stock * 2)}
                          </td>
                          <td style={{ textAlign: "right" }}>{item.lead_days || 7}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button className="primary" onClick={() => downloadCsv(reorderItems)}>
                    Export Reorder List
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Alert Configuration Modal */}
      {alertModal && (
        <div className="modal modal-center">
          <div className="modal-backdrop" onClick={() => setAlertModal(null)} />
          <div className="modal-content" style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <span className="modal-title">Configure Stock Alert</span>
              <button
                className="ghost"
                style={{ padding: "4px 10px", fontSize: "1rem" }}
                onClick={() => setAlertModal(null)}
              >
                {"\u2715"}
              </button>
            </div>
            <div className="modal-body" style={{ display: "grid", gap: 14 }}>
              {/* SKU */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 5,
                  }}
                >
                  SKU
                </label>
                <input
                  type="text"
                  value={alertModal.sku_code}
                  readOnly
                  style={{ width: "100%", background: "var(--surface-2)", cursor: "default" }}
                />
              </div>

              {/* Min Stock */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 5,
                  }}
                >
                  Min Stock
                </label>
                <input
                  type="number"
                  min={0}
                  value={alertModal.min_stock}
                  onChange={(e) =>
                    setAlertModal({ ...alertModal, min_stock: parseInt(e.target.value) || 0 })
                  }
                  style={{ width: "100%" }}
                />
              </div>

              {/* Reorder Quantity */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 5,
                  }}
                >
                  Reorder Quantity
                </label>
                <input
                  type="number"
                  min={0}
                  value={alertModal.reorder_qty}
                  onChange={(e) =>
                    setAlertModal({ ...alertModal, reorder_qty: parseInt(e.target.value) || 0 })
                  }
                  style={{ width: "100%" }}
                />
              </div>

              {/* Lead Days */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 5,
                  }}
                >
                  Lead Days
                </label>
                <input
                  type="number"
                  min={0}
                  value={alertModal.lead_days}
                  onChange={(e) =>
                    setAlertModal({ ...alertModal, lead_days: parseInt(e.target.value) || 0 })
                  }
                  style={{ width: "100%" }}
                />
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button className="ghost" onClick={() => setAlertModal(null)}>
                  Cancel
                </button>
                <button className="primary" onClick={saveAlert} disabled={alertSaving}>
                  {alertSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustModal && (
        <div className="modal modal-center">
          <div className="modal-backdrop" onClick={() => setAdjustModal(null)} />
          <div className="modal-content" style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <span className="modal-title">Adjust Stock</span>
              <button
                className="ghost"
                style={{ padding: "4px 10px", fontSize: "1rem" }}
                onClick={() => setAdjustModal(null)}
              >
                {"\u2715"}
              </button>
            </div>
            <div className="modal-body" style={{ display: "grid", gap: 14 }}>
              {/* SKU */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 5,
                  }}
                >
                  SKU
                </label>
                <input
                  type="text"
                  value={adjustModal.sku_code}
                  readOnly
                  style={{ width: "100%", background: "var(--surface-2)", cursor: "default" }}
                />
              </div>

              {/* Warehouse */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 5,
                  }}
                >
                  Warehouse
                </label>
                <select
                  className="select"
                  value={adjustModal.warehouse_id}
                  onChange={(e) =>
                    setAdjustModal({
                      ...adjustModal,
                      warehouse_id: Number(e.target.value),
                      warehouse_name:
                        WAREHOUSES.find((w) => w.id === Number(e.target.value))?.name ?? "",
                    })
                  }
                  style={{ width: "100%" }}
                >
                  {WAREHOUSES.filter((w) => w.id !== 0).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Current Qty */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 5,
                  }}
                >
                  Current Quantity
                </label>
                <input
                  type="number"
                  value={adjustModal.current_qty}
                  readOnly
                  style={{ width: "100%", background: "var(--surface-2)", cursor: "default" }}
                />
              </div>

              {/* New Qty */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 5,
                  }}
                >
                  New Quantity
                </label>
                <input
                  type="number"
                  min={0}
                  value={adjustModal.new_qty}
                  onChange={(e) =>
                    setAdjustModal({ ...adjustModal, new_qty: parseInt(e.target.value) || 0 })
                  }
                  style={{ width: "100%" }}
                />
              </div>

              {/* Warning */}
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "rgba(217,119,6,0.06)",
                  border: "1px solid rgba(217,119,6,0.2)",
                  color: "var(--warn)",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
              >
                This will adjust stock in JST ERP
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button className="ghost" onClick={() => setAdjustModal(null)}>
                  Cancel
                </button>
                <button className="primary" onClick={saveAdjust} disabled={adjustSaving}>
                  {adjustSaving ? "Confirming..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
