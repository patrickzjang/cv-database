"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type SkuPricing = {
  id?: number;
  item_sku: string;
  variation_sku: string;
  parents_sku: string;
  brand: string;
  group_code?: string;
  description?: string;
  price_tag?: number;
  cogs_ex_vat?: number;
  vat?: number;
  cogs_inc_vat?: number;
  rrp?: number;
  rsp?: number;
  price_campaign_a?: number;
  price_mega?: number;
  price_flash_sale?: number;
  min_price?: number;
  est_margin?: number;
};

type PricingRule = {
  id?: number;
  brand: string;
  collection_key?: string;
  parents_sku?: string;
  product_name?: string;
  category?: string;
  sub_category?: string;
  collection?: string;
  pct_rsp: number;
  pct_campaign_a: number;
  pct_mega: number;
  pct_flash_sale: number;
  pct_est_margin?: number;
};

type PlatformMapping = {
  id?: number;
  item_sku: string;
  brand: string;
  platform: string;
  platform_sku?: string;
  platform_product_id?: string;
  platform_option_id?: string;
  listing_status?: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const BRANDS = ["ALL", "DB", "PAN", "HC", "AN"] as const;
const PLATFORMS = ["Shopee", "Lazada", "TTS", "Shopify"] as const;
const TABS = ["Price Grid", "Pricing Rules", "Platform Mapping"] as const;
type TabKey = (typeof TABS)[number];
const PAGE_SIZE = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "–";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "–";
  return `${n.toFixed(1)}%`;
}

function marginColor(margin: number | null | undefined): string {
  if (margin == null || isNaN(margin)) return "transparent";
  if (margin < 10) return "rgba(220, 38, 38, 0.12)";
  if (margin < 20) return "rgba(217, 119, 6, 0.12)";
  return "rgba(5, 150, 105, 0.12)";
}

function marginTextColor(margin: number | null | undefined): string {
  if (margin == null || isNaN(margin)) return "var(--muted)";
  if (margin < 10) return "var(--error)";
  if (margin < 20) return "var(--warn)";
  return "var(--ok)";
}

function groupRowBg(index: number): string {
  return index % 2 === 0 ? "transparent" : "var(--surface-2)";
}

// ─── Inline Editable Cell ────────────────────────────────────────────────────

function EditableCell({
  value,
  onSave,
  format = "number",
  style,
}: {
  value: number | string | null | undefined;
  onSave: (val: string) => void;
  format?: "number" | "percent" | "text";
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const display =
    format === "percent"
      ? fmtPct(typeof value === "number" ? value : parseFloat(String(value ?? "")))
      : format === "number"
        ? fmt(typeof value === "number" ? value : parseFloat(String(value ?? "")))
        : String(value ?? "–");

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== String(value ?? "")) {
      onSave(trimmed);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={format === "text" ? "text" : "number"}
        step={format === "percent" ? "0.1" : "0.01"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          fontSize: "0.85rem",
          fontFamily: "inherit",
          padding: "2px 4px",
          outline: "none",
          borderBottom: "2px solid var(--cyan)",
          borderRadius: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setDraft(String(value ?? ""));
        setEditing(true);
      }}
      style={{
        cursor: "pointer",
        display: "block",
        padding: "2px 4px",
        borderRadius: 4,
        transition: "background 0.12s",
        minHeight: "1.3em",
        ...style,
      }}
      title="Click to edit"
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,180,216,0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {display}
    </span>
  );
}

// ─── Confirmation Dialog ─────────────────────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal modal-center">
      <div className="modal-backdrop" onClick={onCancel} />
      <div
        className="modal-content"
        style={{ maxWidth: 460, padding: "28px 32px" }}
      >
        <h3 style={{ marginBottom: 12 }}>{title}</h3>
        <p style={{ color: "var(--muted)", fontSize: "0.93rem", lineHeight: 1.6, marginBottom: 20 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={onConfirm}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({
  message,
  type,
  onClose,
}: {
  message: string;
  type: "ok" | "error";
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 1000,
        background: type === "ok" ? "var(--ok)" : "var(--error)",
        color: "#fff",
        padding: "12px 20px",
        borderRadius: 12,
        fontSize: "0.9rem",
        fontWeight: 600,
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        maxWidth: 360,
      }}
    >
      {message}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("Price Grid");
  const [toast, setToast] = useState<{ message: string; type: "ok" | "error" } | null>(null);

  // ── Price Grid state ──
  const [gridData, setGridData] = useState<SkuPricing[]>([]);
  const [gridTotal, setGridTotal] = useState(0);
  const [gridBrand, setGridBrand] = useState("ALL");
  const [gridSearch, setGridSearch] = useState("");
  const [gridPage, setGridPage] = useState(1);
  const [gridLoading, setGridLoading] = useState(false);
  const gridFileRef = useRef<HTMLInputElement>(null);

  // ── Pricing Rules state ──
  const [rulesData, setRulesData] = useState<PricingRule[]>([]);
  const [rulesBrand, setRulesBrand] = useState("ALL");
  const [rulesLoading, setRulesLoading] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const rulesFileRef = useRef<HTMLInputElement>(null);

  // ── Platform Mapping state ──
  const [mappingData, setMappingData] = useState<PlatformMapping[]>([]);
  const [mappingBrand, setMappingBrand] = useState("ALL");
  const [mappingPlatform, setMappingPlatform] = useState("ALL");
  const [mappingStatus, setMappingStatus] = useState("all");
  const [mappingLoading, setMappingLoading] = useState(false);
  const mappingFileRef = useRef<HTMLInputElement>(null);
  const [mappingStats, setMappingStats] = useState<Record<string, number>>({});

  // ── Fetch functions ────────────────────────────────────────────────────────

  const fetchGrid = useCallback(async () => {
    setGridLoading(true);
    try {
      const params = new URLSearchParams();
      if (gridBrand !== "ALL") params.set("brand", gridBrand);
      if (gridSearch) params.set("q", gridSearch);
      params.set("page", String(gridPage));
      params.set("limit", String(PAGE_SIZE));
      const res = await fetch(`/api/products/pricing?${params}`);
      const json = await res.json();
      if (res.ok) {
        setGridData(json.data ?? []);
        setGridTotal(json.total ?? 0);
      } else {
        setToast({ message: json.error ?? "Failed to load pricing data", type: "error" });
      }
    } catch (e: any) {
      setToast({ message: e.message ?? "Network error", type: "error" });
    } finally {
      setGridLoading(false);
    }
  }, [gridBrand, gridSearch, gridPage]);

  const fetchRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const params = new URLSearchParams();
      if (rulesBrand !== "ALL") params.set("brand", rulesBrand);
      const res = await fetch(`/api/products/pricing/rules?${params}`);
      const json = await res.json();
      if (res.ok) {
        setRulesData(json.data ?? []);
      } else {
        setToast({ message: json.error ?? "Failed to load rules", type: "error" });
      }
    } catch (e: any) {
      setToast({ message: e.message ?? "Network error", type: "error" });
    } finally {
      setRulesLoading(false);
    }
  }, [rulesBrand]);

  const fetchMapping = useCallback(async () => {
    setMappingLoading(true);
    try {
      const params = new URLSearchParams();
      if (mappingBrand !== "ALL") params.set("brand", mappingBrand);
      if (mappingPlatform !== "ALL") params.set("platform", mappingPlatform);
      if (mappingStatus !== "all") params.set("status", mappingStatus);
      const res = await fetch(`/api/products/pricing/mapping?${params}`);
      const json = await res.json();
      if (res.ok) {
        setMappingData(json.data ?? []);
        setMappingStats(json.stats ?? {});
      } else {
        setToast({ message: json.error ?? "Failed to load mappings", type: "error" });
      }
    } catch (e: any) {
      setToast({ message: e.message ?? "Network error", type: "error" });
    } finally {
      setMappingLoading(false);
    }
  }, [mappingBrand, mappingPlatform, mappingStatus]);

  // ── Load data on tab / filter change ───────────────────────────────────────

  useEffect(() => {
    if (activeTab === "Price Grid") fetchGrid();
  }, [activeTab, fetchGrid]);

  useEffect(() => {
    if (activeTab === "Pricing Rules") fetchRules();
  }, [activeTab, fetchRules]);

  useEffect(() => {
    if (activeTab === "Platform Mapping") fetchMapping();
  }, [activeTab, fetchMapping]);

  // Reset page when brand/search changes
  useEffect(() => { setGridPage(1); }, [gridBrand, gridSearch]);

  // ── Save single cell ──────────────────────────────────────────────────────

  async function savePricingCell(row: SkuPricing, field: string, value: string) {
    try {
      const res = await fetch("/api/products/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_sku: row.item_sku,
          variation_sku: row.variation_sku,
          [field]: value === "" ? null : parseFloat(value),
        }),
      });
      if (res.ok) {
        setToast({ message: "Saved", type: "ok" });
        // Update local state optimistically
        setGridData((prev) =>
          prev.map((r) =>
            r.item_sku === row.item_sku && r.variation_sku === row.variation_sku
              ? { ...r, [field]: value === "" ? null : parseFloat(value) }
              : r
          )
        );
      } else {
        const json = await res.json();
        setToast({ message: json.error ?? "Save failed", type: "error" });
      }
    } catch {
      setToast({ message: "Save failed", type: "error" });
    }
  }

  async function saveRuleCell(rule: PricingRule, field: string, value: string) {
    try {
      const res = await fetch("/api/products/pricing/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: rule.id,
          brand: rule.brand,
          collection_key: rule.collection_key,
          [field]: value === "" ? null : parseFloat(value),
        }),
      });
      if (res.ok) {
        setToast({ message: "Rule saved", type: "ok" });
        setRulesData((prev) =>
          prev.map((r) =>
            r.id === rule.id
              ? { ...r, [field]: value === "" ? null : parseFloat(value) }
              : r
          )
        );
      } else {
        const json = await res.json();
        setToast({ message: json.error ?? "Save failed", type: "error" });
      }
    } catch {
      setToast({ message: "Save failed", type: "error" });
    }
  }

  // ── Apply rules ────────────────────────────────────────────────────────────

  async function applyRules() {
    setApplyLoading(true);
    try {
      const res = await fetch("/api/products/pricing/apply-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: rulesBrand !== "ALL" ? rulesBrand : undefined }),
      });
      const json = await res.json();
      if (res.ok) {
        setToast({ message: `Rules applied to ${json.updated ?? 0} SKUs`, type: "ok" });
        fetchGrid();
      } else {
        setToast({ message: json.error ?? "Apply failed", type: "error" });
      }
    } catch {
      setToast({ message: "Apply failed", type: "error" });
    } finally {
      setApplyLoading(false);
      setConfirmApply(false);
    }
  }

  // ── Import handlers ────────────────────────────────────────────────────────

  async function handleImport(file: File, endpoint: string, onDone: () => void) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(endpoint, { method: "POST", body: formData });
      const json = await res.json();
      if (res.ok) {
        setToast({ message: `Imported ${json.count ?? 0} rows`, type: "ok" });
        onDone();
      } else {
        setToast({ message: json.error ?? "Import failed", type: "error" });
      }
    } catch {
      setToast({ message: "Import failed", type: "error" });
    }
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────

  function exportCsv() {
    if (!gridData.length) return;
    const headers = [
      "ITEM_SKU", "VARIATION_SKU", "Description", "Brand", "RRP", "RSP",
      "Campaign A", "Mega", "Flash Sale", "Min Price", "COGS", "Margin%",
    ];
    const rows = gridData.map((r) => [
      r.item_sku, r.variation_sku, r.description ?? "", r.brand,
      r.rrp ?? "", r.rsp ?? "", r.price_campaign_a ?? "", r.price_mega ?? "",
      r.price_flash_sale ?? "", r.min_price ?? "", r.cogs_inc_vat ?? "",
      r.est_margin != null ? r.est_margin.toFixed(1) : "",
    ]);
    const csv = [headers, ...rows].map((row) =>
      row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pricing-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Group grid data by variation_sku ───────────────────────────────────────

  const groupedGrid: { key: string; rows: SkuPricing[] }[] = [];
  const groupMap = new Map<string, SkuPricing[]>();
  for (const row of gridData) {
    const key = row.variation_sku || row.item_sku;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(row);
  }
  for (const [key, rows] of groupMap) {
    groupedGrid.push({ key, rows });
  }

  const totalGridPages = Math.max(1, Math.ceil(gridTotal / PAGE_SIZE));

  // ── Search debounce ────────────────────────────────────────────────────────

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function handleSearchChange(val: string) {
    setGridSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      // fetchGrid will fire via useEffect when gridSearch changes
    }, 300);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Topbar */}
      <div className="topbar">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="brand">
            <img
              src="/fav-logo-2026.png"
              alt="logo"
              className="logo"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div>
              <div className="brand-title">Pricing System</div>
              <div className="brand-sub">SKU pricing, rules & platform mapping</div>
            </div>
          </div>
          <button className="ghost" onClick={() => (window.location.href = "/")} style={{ fontSize: "0.9rem" }}>
            ← Back
          </button>
        </div>
      </div>

      <div className="page" style={{ maxWidth: 1440 }}>
        {/* ── Tab Switcher ── */}
        <div className="tabs" style={{ marginBottom: 20 }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              className={`tab${activeTab === tab ? " active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════════════════
            TAB 1: PRICE GRID
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "Price Grid" && (
          <div>
            {/* Filter bar */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                {/* Brand tabs */}
                <div className="brand-tabs">
                  {BRANDS.map((b) => (
                    <button
                      key={b}
                      className={`brand-tab${gridBrand === b ? " active" : ""}`}
                      onClick={() => setGridBrand(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <input
                  type="text"
                  placeholder="Search SKU or description..."
                  value={gridSearch}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  style={{ flex: 1, minWidth: 200 }}
                />

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                  <button className="ghost" onClick={() => gridFileRef.current?.click()}>
                    Import Excel
                  </button>
                  <input
                    ref={gridFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImport(f, "/api/products/pricing/import", fetchGrid);
                      e.target.value = "";
                    }}
                  />
                  <button className="ghost" onClick={exportCsv} disabled={!gridData.length}>
                    Export CSV
                  </button>
                </div>
              </div>
            </div>

            {/* Grid table */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {gridLoading ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
                  Loading pricing data...
                </div>
              ) : gridData.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
                  No pricing data found. Try adjusting your filters or import from Excel.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>ITEM SKU</th>
                        <th style={{ width: 130 }}>VAR SKU</th>
                        <th style={{ minWidth: 180 }}>Description</th>
                        <th style={{ width: 60 }}>Brand</th>
                        <th style={{ width: 90, textAlign: "right" }}>RRP</th>
                        <th style={{ width: 90, textAlign: "right" }}>RSP</th>
                        <th style={{ width: 95, textAlign: "right" }}>Campaign A</th>
                        <th style={{ width: 85, textAlign: "right" }}>Mega</th>
                        <th style={{ width: 95, textAlign: "right" }}>Flash Sale</th>
                        <th style={{ width: 90, textAlign: "right" }}>Min Price</th>
                        <th style={{ width: 85, textAlign: "right" }}>COGS</th>
                        <th style={{ width: 80, textAlign: "right" }}>Margin%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedGrid.map((group, gi) =>
                        group.rows.map((row, ri) => (
                          <tr
                            key={`${row.item_sku}-${row.variation_sku}`}
                            style={{ background: groupRowBg(gi) }}
                          >
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", fontWeight: 600 }}>
                              {row.item_sku}
                            </td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", color: "var(--muted)" }}>
                              {row.variation_sku}
                            </td>
                            <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                              {row.description ?? "–"}
                            </td>
                            <td>
                              <span
                                className="badge badge-brand"
                                style={{ fontSize: "0.72rem" }}
                              >
                                {row.brand}
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <EditableCell
                                value={row.rrp}
                                onSave={(v) => savePricingCell(row, "rrp", v)}
                              />
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <EditableCell
                                value={row.rsp}
                                onSave={(v) => savePricingCell(row, "rsp", v)}
                              />
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <EditableCell
                                value={row.price_campaign_a}
                                onSave={(v) => savePricingCell(row, "price_campaign_a", v)}
                              />
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <EditableCell
                                value={row.price_mega}
                                onSave={(v) => savePricingCell(row, "price_mega", v)}
                              />
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <EditableCell
                                value={row.price_flash_sale}
                                onSave={(v) => savePricingCell(row, "price_flash_sale", v)}
                              />
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <EditableCell
                                value={row.min_price}
                                onSave={(v) => savePricingCell(row, "min_price", v)}
                              />
                            </td>
                            <td style={{ textAlign: "right", color: "var(--muted)" }}>
                              {fmt(row.cogs_inc_vat)}
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                background: marginColor(row.est_margin),
                                color: marginTextColor(row.est_margin),
                                fontWeight: 700,
                                fontSize: "0.85rem",
                              }}
                            >
                              {fmtPct(row.est_margin)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {gridTotal > PAGE_SIZE && (
                <div
                  className="pager"
                  style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}
                >
                  <button
                    className="ghost"
                    disabled={gridPage <= 1}
                    onClick={() => setGridPage((p) => Math.max(1, p - 1))}
                    style={{ padding: "6px 14px", fontSize: "0.85rem" }}
                  >
                    Prev
                  </button>
                  <span className="pager-info">
                    Page {gridPage} of {totalGridPages}
                  </span>
                  <button
                    className="ghost"
                    disabled={gridPage >= totalGridPages}
                    onClick={() => setGridPage((p) => p + 1)}
                    style={{ padding: "6px 14px", fontSize: "0.85rem" }}
                  >
                    Next
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: "0.82rem", marginLeft: "auto" }}>
                    {gridTotal.toLocaleString("th-TH")} total rows
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB 2: PRICING RULES
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "Pricing Rules" && (
          <div>
            {/* Filter bar */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div className="brand-tabs">
                  {BRANDS.map((b) => (
                    <button
                      key={b}
                      className={`brand-tab${rulesBrand === b ? " active" : ""}`}
                      onClick={() => setRulesBrand(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                  <button className="ghost" onClick={() => rulesFileRef.current?.click()}>
                    Import COL Sheet
                  </button>
                  <input
                    ref={rulesFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImport(f, "/api/products/pricing/rules/import", fetchRules);
                      e.target.value = "";
                    }}
                  />
                  <button
                    className="primary"
                    onClick={() => setConfirmApply(true)}
                    disabled={applyLoading}
                  >
                    {applyLoading ? "Applying..." : "Apply Rules"}
                  </button>
                </div>
              </div>
            </div>

            {/* Rules table */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {rulesLoading ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
                  Loading rules...
                </div>
              ) : rulesData.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
                  No pricing rules found. Import a COL sheet to get started.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>Brand</th>
                        <th style={{ width: 110 }}>Collection Key</th>
                        <th style={{ width: 120 }}>Parents SKU</th>
                        <th style={{ minWidth: 140 }}>Product Name</th>
                        <th style={{ width: 100 }}>Category</th>
                        <th style={{ width: 100 }}>Sub-Cat</th>
                        <th style={{ width: 100 }}>Collection</th>
                        <th style={{ width: 75, textAlign: "right" }}>%RSP</th>
                        <th style={{ width: 75, textAlign: "right" }}>%A</th>
                        <th style={{ width: 75, textAlign: "right" }}>%Mega</th>
                        <th style={{ width: 75, textAlign: "right" }}>%FS</th>
                        <th style={{ width: 80, textAlign: "right" }}>%Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rulesData.map((rule, i) => (
                        <tr key={rule.id ?? i}>
                          <td>
                            <span className="badge badge-brand">{rule.brand}</span>
                          </td>
                          <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem" }}>
                            {rule.collection_key ?? "–"}
                          </td>
                          <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", color: "var(--muted)" }}>
                            {rule.parents_sku ?? "–"}
                          </td>
                          <td style={{ fontSize: "0.85rem" }}>{rule.product_name ?? "–"}</td>
                          <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{rule.category ?? "–"}</td>
                          <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{rule.sub_category ?? "–"}</td>
                          <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{rule.collection ?? "–"}</td>
                          <td style={{ textAlign: "right" }}>
                            <EditableCell
                              value={rule.pct_rsp}
                              format="percent"
                              onSave={(v) => saveRuleCell(rule, "pct_rsp", v)}
                            />
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <EditableCell
                              value={rule.pct_campaign_a}
                              format="percent"
                              onSave={(v) => saveRuleCell(rule, "pct_campaign_a", v)}
                            />
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <EditableCell
                              value={rule.pct_mega}
                              format="percent"
                              onSave={(v) => saveRuleCell(rule, "pct_mega", v)}
                            />
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <EditableCell
                              value={rule.pct_flash_sale}
                              format="percent"
                              onSave={(v) => saveRuleCell(rule, "pct_flash_sale", v)}
                            />
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              color: marginTextColor(rule.pct_est_margin),
                              fontWeight: 600,
                            }}
                          >
                            {fmtPct(rule.pct_est_margin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Apply rules confirmation */}
            <ConfirmDialog
              open={confirmApply}
              title="Apply Pricing Rules"
              message={`This will recalculate RSP, Campaign A, Mega, and Flash Sale prices for ${
                rulesBrand !== "ALL" ? `all ${rulesBrand}` : "all"
              } SKUs based on the current rules. Continue?`}
              onConfirm={applyRules}
              onCancel={() => setConfirmApply(false)}
            />
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB 3: PLATFORM MAPPING
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "Platform Mapping" && (
          <div>
            {/* Summary stats */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              {PLATFORMS.map((p) => (
                <div key={p} className="card" style={{ padding: "16px 20px", textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 6,
                    }}
                  >
                    {p}
                  </div>
                  <div
                    style={{
                      fontSize: "1.6rem",
                      fontWeight: 700,
                      background: "var(--grad)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    {(mappingStats[p] ?? 0).toLocaleString("th-TH")}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>
                    listed
                  </div>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div className="brand-tabs">
                  {BRANDS.map((b) => (
                    <button
                      key={b}
                      className={`brand-tab${mappingBrand === b ? " active" : ""}`}
                      onClick={() => setMappingBrand(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>

                <select
                  value={mappingPlatform}
                  onChange={(e) => setMappingPlatform(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 10 }}
                >
                  <option value="ALL">All Platforms</option>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>

                <select
                  value={mappingStatus}
                  onChange={(e) => setMappingStatus(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 10 }}
                >
                  <option value="all">All Status</option>
                  <option value="listed">Listed</option>
                  <option value="not_listed">Not Listed</option>
                </select>

                <div style={{ marginLeft: "auto" }}>
                  <button className="ghost" onClick={() => mappingFileRef.current?.click()}>
                    Import SKU Sheet
                  </button>
                  <input
                    ref={mappingFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImport(f, "/api/products/pricing/mapping/import", fetchMapping);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Mapping table */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {mappingLoading ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
                  Loading mappings...
                </div>
              ) : mappingData.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
                  No platform mappings found. Import a SKU sheet to get started.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>ITEM SKU</th>
                        <th style={{ width: 60 }}>Brand</th>
                        <th style={{ width: 90 }}>Platform</th>
                        <th style={{ width: 140 }}>Platform SKU</th>
                        <th style={{ width: 130 }}>Product ID</th>
                        <th style={{ width: 130 }}>Option ID</th>
                        <th style={{ width: 100 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappingData.map((m, i) => {
                        const isListed = m.listing_status === "listed";
                        return (
                          <tr key={m.id ?? i}>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", fontWeight: 600 }}>
                              {m.item_sku}
                            </td>
                            <td>
                              <span className="badge badge-brand">{m.brand}</span>
                            </td>
                            <td>
                              <span
                                className="badge"
                                style={{
                                  background:
                                    m.platform === "Shopee"
                                      ? "rgba(238, 77, 45, 0.08)"
                                      : m.platform === "Lazada"
                                        ? "rgba(15, 22, 120, 0.08)"
                                        : m.platform === "TTS"
                                          ? "rgba(0, 0, 0, 0.06)"
                                          : "rgba(150, 191, 72, 0.08)",
                                  color:
                                    m.platform === "Shopee"
                                      ? "#ee4d2d"
                                      : m.platform === "Lazada"
                                        ? "#0f1678"
                                        : m.platform === "TTS"
                                          ? "var(--text)"
                                          : "#96bf48",
                                  borderColor:
                                    m.platform === "Shopee"
                                      ? "rgba(238, 77, 45, 0.2)"
                                      : m.platform === "Lazada"
                                        ? "rgba(15, 22, 120, 0.2)"
                                        : m.platform === "TTS"
                                          ? "var(--border-2)"
                                          : "rgba(150, 191, 72, 0.2)",
                                }}
                              >
                                {m.platform}
                              </span>
                            </td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", color: "var(--muted)" }}>
                              {m.platform_sku ?? "–"}
                            </td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", color: "var(--muted)" }}>
                              {m.platform_product_id ?? "–"}
                            </td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", color: "var(--muted)" }}>
                              {m.platform_option_id ?? "–"}
                            </td>
                            <td>
                              <span
                                className="badge"
                                style={{
                                  background: isListed
                                    ? "rgba(5, 150, 105, 0.08)"
                                    : "rgba(220, 38, 38, 0.08)",
                                  color: isListed ? "var(--ok)" : "var(--error)",
                                  borderColor: isListed
                                    ? "rgba(5, 150, 105, 0.2)"
                                    : "rgba(220, 38, 38, 0.2)",
                                }}
                              >
                                {isListed ? "Listed" : "Not Listed"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
