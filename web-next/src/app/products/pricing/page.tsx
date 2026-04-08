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
  category?: string;
  collection?: string;
  size?: string;
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
  cogs_ratio?: number; // avg(cogs_inc_vat / rrp) for real-time margin calc
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

const BRANDS = ["PAN", "DB", "AN", "HC", "ALL"] as const;
const PLATFORMS = ["Shopee", "Lazada", "TikTok", "Shopify"] as const;
const PLATFORM_DB_KEY: Record<string, string> = { Shopee: "shopee", Lazada: "lazada", TikTok: "tiktok", Shopify: "shopify" };
const TABS = ["Price Grid", "Pricing Rules", "Platform Mapping"] as const;
type TabKey = (typeof TABS)[number];
const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000] as const;
const DEFAULT_PAGE_SIZE = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "–";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "–";
  // Values stored as decimal (0.9 = 90%), display as percentage
  return `${(n * 100).toFixed(1)}%`;
}

// Margin stored as decimal (0.225 = 22.5%)
function marginPct(margin: number | null | undefined, isDecimal = false): number | null {
  if (margin == null || isNaN(margin)) return null;
  // isDecimal=true: value is like 0.207 (=20.7%) — used for pct_est_margin in rules
  // isDecimal=false: value is already % like 20.7 or -0.6 — used for est_margin in grid
  return isDecimal ? margin * 100 : margin;
}

function marginColor(margin: number | null | undefined, isDecimal = false): string {
  const pct = marginPct(margin, isDecimal);
  if (pct == null) return "transparent";
  if (pct < 10) return "rgba(220, 38, 38, 0.12)";
  if (pct < 20) return "rgba(217, 119, 6, 0.12)";
  return "rgba(5, 150, 105, 0.12)";
}

function marginTextColor(margin: number | null | undefined, isDecimal = false): string {
  const pct = marginPct(margin, isDecimal);
  if (pct == null) return "var(--text-muted)";
  if (pct < 10) return "var(--error)";
  if (pct < 20) return "var(--warn)";
  return "var(--ok)";
}

/**
 * Real-time margin calc using weighted avg selling price:
 * RSP 40%, Campaign A 30%, Mega 15%, Flash Sale 15%
 * weighted_pct = 0.4×%RSP + 0.3×%A + 0.15×%Mega + 0.15×%FS
 * margin = (weightedPrice - COGS - platformFee) / weightedPrice
 *        = 1 - (cogs_ratio / weighted_pct) - platformFeeRate
 */
function calcRuleMargin(rule: PricingRule, platformFeeRate: number): number | null {
  if (rule.cogs_ratio == null || rule.cogs_ratio <= 0) return null;
  const rsp = rule.pct_rsp ?? 0;
  const a = rule.pct_campaign_a ?? 0;
  const mega = rule.pct_mega ?? 0;
  const fs = rule.pct_flash_sale ?? 0;
  const weightedPct = 0.4 * rsp + 0.3 * a + 0.15 * mega + 0.15 * fs;
  if (weightedPct <= 0) return null;
  return 1 - (rule.cogs_ratio / weightedPct) - platformFeeRate;
}

function groupRowBg(index: number): string {
  return index % 2 === 0 ? "transparent" : "var(--surface-2)";
}

// ─── Brand & Platform Colors ────────────────────────────────────────────────

const BRAND_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  PAN: { bg: "rgba(239,68,68,0.08)", color: "#ef4444", border: "rgba(239,68,68,0.2)" },
  PN:  { bg: "rgba(239,68,68,0.08)", color: "#ef4444", border: "rgba(239,68,68,0.2)" },
  JN:  { bg: "rgba(249,115,22,0.08)", color: "#f97316", border: "rgba(249,115,22,0.2)" },
  DB:  { bg: "rgba(52,211,153,0.08)", color: "#10b981", border: "rgba(52,211,153,0.2)" },
  HC:  { bg: "rgba(236,72,153,0.08)", color: "#db2777", border: "rgba(236,72,153,0.2)" },
  AN:  { bg: "rgba(0,0,0,0.06)", color: "#111", border: "rgba(0,0,0,0.15)" },
};

const PLATFORM_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  shopee:  { bg: "rgba(238,77,45,0.08)", color: "#ee4d2d", border: "rgba(238,77,45,0.2)" },
  lazada:  { bg: "rgba(15,19,109,0.08)", color: "#0f136d", border: "rgba(15,19,109,0.2)" },
  tiktok:  { bg: "rgba(0,0,0,0.06)", color: "#111", border: "rgba(0,0,0,0.15)" },
  shopify: { bg: "rgba(150,191,72,0.08)", color: "#5e8e3e", border: "rgba(150,191,72,0.2)" },
};

function BrandBadge({ brand }: { brand: string }) {
  const c = BRAND_COLORS[brand] ?? { bg: "var(--surface-2)", color: "var(--text-muted)", border: "var(--border-2)" };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {brand}
    </span>
  );
}

function PlatformBadge({ platform, status = "listed" }: { platform: string; status?: string }) {
  const key = platform.toLowerCase();
  const c = status === "listed"
    ? (PLATFORM_COLORS[key] ?? { bg: "var(--surface-2)", color: "var(--text-muted)", border: "var(--border-2)" })
    : { bg: "rgba(220,38,38,0.08)", color: "var(--error)", border: "rgba(220,38,38,0.2)" };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {platform}
    </span>
  );
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

  const numVal = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  const display =
    format === "percent"
      ? fmtPct(numVal)
      : format === "number"
        ? fmt(numVal)
        : String(value ?? "–");

  // For percent: show "90" in the input (not "0.9"), save back as "0.9"
  function startEdit() {
    if (format === "percent" && !isNaN(numVal)) {
      setDraft(String(Math.round(numVal * 1000) / 10)); // 0.9 -> "90"
    } else {
      setDraft(String(value ?? ""));
    }
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    let trimmed = draft.trim();
    if (format === "percent") {
      // Convert "90" back to "0.9"
      const pctVal = parseFloat(trimmed);
      if (!isNaN(pctVal)) trimmed = String(pctVal / 100);
    }
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
      onClick={startEdit}
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
        <p style={{ color: "var(--text-muted)", fontSize: "0.93rem", lineHeight: 1.6, marginBottom: 20 }}>
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

// ─── Drag Fill Handle ───────────────────────────────────────────────────────

function DragHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onMouseDown(e); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute", right: 0, bottom: 0, width: 10, height: 10,
        background: hover ? "var(--app-accent)" : "var(--app-accent)",
        borderRadius: 2, cursor: "crosshair",
        opacity: hover ? 1 : 0.35, transition: "opacity 0.15s",
        border: "1.5px solid #fff",
        zIndex: 2,
      }}
      title="Drag to fill"
    />
  );
}

// ─── Drag Fill Hook ─────────────────────────────────────────────────────────

type DragFillState = {
  active: boolean;
  sourceRow: number;
  sourceCol: string;
  sourceValue: number | string | null;
  targetRow: number;
  targetCol: string;
};

function useDragFill(
  columns: string[],
  onApplyVertical: (col: string, value: number | string | null, fromRow: number, toRow: number) => void,
  onApplyHorizontal: (row: number, value: number | string | null, fromCol: string, toCol: string) => void,
) {
  const [drag, setDrag] = useState<DragFillState>({
    active: false, sourceRow: -1, sourceCol: "", sourceValue: null, targetRow: -1, targetCol: "",
  });

  function startDrag(row: number, col: string, value: number | string | null) {
    setDrag({ active: true, sourceRow: row, sourceCol: col, sourceValue: value, targetRow: row, targetCol: col });
    const handleMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el?.closest("td");
      const tr = el?.closest("tr");
      if (tr) {
        const idx = Number(tr.dataset.rowIdx);
        if (!isNaN(idx)) {
          // Detect column from td data attribute
          const colName = td?.getAttribute("data-col") || "";
          setDrag((prev) => ({ ...prev, targetRow: idx, targetCol: colName || prev.targetCol }));
        }
      }
    };
    const handleUp = () => {
      setDrag((prev) => {
        if (!prev.active) return { active: false, sourceRow: -1, sourceCol: "", sourceValue: null, targetRow: -1, targetCol: "" };

        const rowDiff = Math.abs(prev.targetRow - prev.sourceRow);
        const srcColIdx = columns.indexOf(prev.sourceCol);
        const tgtColIdx = columns.indexOf(prev.targetCol);
        const colDiff = Math.abs(tgtColIdx - srcColIdx);

        if (rowDiff > 0 && rowDiff >= colDiff) {
          // Vertical fill
          const from = Math.min(prev.sourceRow, prev.targetRow);
          const to = Math.max(prev.sourceRow, prev.targetRow);
          onApplyVertical(prev.sourceCol, prev.sourceValue, from, to);
        } else if (colDiff > 0) {
          // Horizontal fill
          const fromIdx = Math.min(srcColIdx, tgtColIdx);
          const toIdx = Math.max(srcColIdx, tgtColIdx);
          onApplyHorizontal(prev.sourceRow, prev.sourceValue, columns[fromIdx], columns[toIdx]);
        }

        return { active: false, sourceRow: -1, sourceCol: "", sourceValue: null, targetRow: -1, targetCol: "" };
      });
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }

  function isHighlighted(row: number, col: string): boolean {
    if (!drag.active) return false;
    const srcColIdx = columns.indexOf(drag.sourceCol);
    const tgtColIdx = columns.indexOf(drag.targetCol);
    const colIdx = columns.indexOf(col);
    const fromRow = Math.min(drag.sourceRow, drag.targetRow);
    const toRow = Math.max(drag.sourceRow, drag.targetRow);
    const fromCol = Math.min(srcColIdx, tgtColIdx);
    const toCol = Math.max(srcColIdx, tgtColIdx);

    const rowDiff = Math.abs(drag.targetRow - drag.sourceRow);
    const colDiffAbs = Math.abs(tgtColIdx - srcColIdx);

    if (rowDiff > 0 && rowDiff >= colDiffAbs) {
      // Vertical: same col, range of rows
      return col === drag.sourceCol && row >= fromRow && row <= toRow;
    } else if (colDiffAbs > 0) {
      // Horizontal: same row, range of cols
      return row === drag.sourceRow && colIdx >= fromCol && colIdx <= toCol;
    }
    return false;
  }

  return { drag, startDrag, isHighlighted };
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("Price Grid");
  const [toast, setToast] = useState<{ message: string; type: "ok" | "error" } | null>(null);

  // ── Price Grid state ──
  const [gridData, setGridData] = useState<SkuPricing[]>([]);
  const [gridTotal, setGridTotal] = useState(0);
  const [gridBrand, setGridBrand] = useState("PAN");
  const [gridSearch, setGridSearch] = useState("");
  const [gridPage, setGridPage] = useState(1);
  const [gridPageSize, setGridPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [gridLoading, setGridLoading] = useState(false);
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());
  const gridFileRef = useRef<HTMLInputElement>(null);

  // ── Drag fill ──
  const GRID_DRAG_COLS = ["rrp", "rsp", "price_campaign_a", "price_mega", "price_flash_sale", "min_price"];
  const { startDrag: gridStartDrag, isHighlighted: gridIsHighlighted } = useDragFill(
    GRID_DRAG_COLS,
    (col, value, fromRow, toRow) => {
      const affected = groupedGrid.slice(fromRow, toRow + 1);
      for (const group of affected) {
        savePricingCell(group.rows[0], col, String(value ?? ""));
      }
      setToast({ message: `Filled ${affected.length} rows`, type: "ok" });
    },
    (_row, _value, _fromCol, _toCol) => { /* grid is read-only, no horizontal fill */ },
  );

  // ── Drag fill for rules ──
  const RULES_DRAG_COLS = ["category", "sub_category", "pct_rsp", "pct_campaign_a", "pct_mega", "pct_flash_sale"];
  const { startDrag: rulesStartDrag, isHighlighted: rulesIsHighlighted } = useDragFill(
    RULES_DRAG_COLS,
    // Vertical fill
    (col, value, fromRow, toRow) => {
      const affected = rulesData.slice(fromRow, toRow + 1);
      for (const rule of affected) {
        saveRuleCell(rule, col, String(value ?? ""));
      }
      setToast({ message: `Filled ${affected.length} rules`, type: "ok" });
    },
    // Horizontal fill — copy value across columns in same row
    (row, value, fromCol, toCol) => {
      const rule = rulesData[row];
      if (!rule) return;
      const fromIdx = RULES_DRAG_COLS.indexOf(fromCol);
      const toIdx = RULES_DRAG_COLS.indexOf(toCol);
      if (fromIdx < 0 || toIdx < 0) return;
      const cols = RULES_DRAG_COLS.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1);
      for (const col of cols) {
        saveRuleCell(rule, col, String(value ?? ""));
      }
      setToast({ message: `Filled ${cols.length} columns`, type: "ok" });
    },
  );

  // ── Google Sheet Sync ──
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ active: boolean; pct: number; label: string }>({ active: false, pct: 0, label: "" });

  async function syncGoogleSheet() {
    setSyncing(true);
    setSyncProgress({ active: true, pct: 10, label: "Downloading Google Sheet..." });

    // Animate progress
    let pct = 10;
    const timer = setInterval(() => {
      pct = Math.min(pct + Math.random() * 6 + 2, 90);
      setSyncProgress((p) => p.active && p.pct < 100 ? { ...p, pct: Math.round(pct) } : p);
    }, 600);

    try {
      setSyncProgress({ active: true, pct: 30, label: "Parsing & uploading data..." });
      const res = await fetch("/api/master-data/sync-gsheet", { method: "POST" });
      clearInterval(timer);
      const json = await res.json();

      if (res.ok && json.ok) {
        setSyncProgress({ active: true, pct: 100, label: "Complete!" });
        setToast({ message: `Synced! ${json.pricing_rows} SKUs + ${json.rules_rows} rules`, type: "ok" });
        // Refresh current tab data
        fetchGrid();
        fetchRules();
      } else {
        setToast({ message: json.error ?? "Sync failed", type: "error" });
      }
    } catch {
      clearInterval(timer);
      setToast({ message: "Sync failed", type: "error" });
    }

    setTimeout(() => setSyncProgress({ active: false, pct: 0, label: "" }), 2000);
    setSyncing(false);
  }

  // ── Pricing Rules state ──
  const [rulesData, setRulesData] = useState<PricingRule[]>([]);
  const [rulesTotal, setRulesTotal] = useState(0);
  const [maxPlatformFeeRate, setMaxPlatformFeeRate] = useState(0);
  const [rulesBrand, setRulesBrand] = useState("PAN");
  const [rulesPage, setRulesPage] = useState(1);
  const [rulesPageSize, setRulesPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const rulesFileRef = useRef<HTMLInputElement>(null);

  // ── Platform Mapping state ──
  const [mappingData, setMappingData] = useState<PlatformMapping[]>([]);
  const [mappingBrand, setMappingBrand] = useState("PAN");
  const [mappingPlatform, setMappingPlatform] = useState("ALL");
  const [mappingStatus, setMappingStatus] = useState("all"); // all | full | incomplete | missing

  const [mappingLoading, setMappingLoading] = useState(false);
  const [allVariations, setAllVariations] = useState<{ variation_sku: string; brand: string }[]>([]);
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
      params.set("pageSize", String(gridPageSize));
      const res = await fetch(`/api/products/pricing?${params}`);
      const json = await res.json();
      if (res.ok) {
        setGridData(json.data ?? []);
        setGridTotal(json.totalVariations ?? json.total ?? 0);
        setSelectedVars(new Set()); // clear selection on page change
      } else {
        setToast({ message: json.error ?? "Failed to load pricing data", type: "error" });
      }
    } catch (e: any) {
      setToast({ message: e.message ?? "Network error", type: "error" });
    } finally {
      setGridLoading(false);
    }
  }, [gridBrand, gridSearch, gridPage, gridPageSize]);

  const fetchRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const params = new URLSearchParams();
      if (rulesBrand !== "ALL") params.set("brand", rulesBrand);
      params.set("page", String(rulesPage));
      params.set("pageSize", String(rulesPageSize));
      const res = await fetch(`/api/products/pricing/rules?${params}`);
      const json = await res.json();
      if (res.ok) {
        setRulesData(json.data ?? []);
        setRulesTotal(json.total ?? json.data?.length ?? 0);
        if (json.maxPlatformFeeRate != null) setMaxPlatformFeeRate(json.maxPlatformFeeRate);
      } else {
        setToast({ message: json.error ?? "Failed to load rules", type: "error" });
      }
    } catch (e: any) {
      setToast({ message: e.message ?? "Network error", type: "error" });
    } finally {
      setRulesLoading(false);
    }
  }, [rulesBrand, rulesPage, rulesPageSize]);

  useEffect(() => { setRulesPage(1); }, [rulesBrand, rulesPageSize]);

  const fetchMapping = useCallback(async () => {
    setMappingLoading(true);
    try {
      // Fetch all pages to group by variation_sku
      const allData: PlatformMapping[] = [];
      let page = 1;
      while (true) {
        const params = new URLSearchParams();
        if (mappingBrand !== "ALL") params.set("brand", mappingBrand);
        // Don't filter by status/platform at API level — filter in UI after grouping by variation
        params.set("page", String(page));
        params.set("pageSize", "500");
        const res = await fetch(`/api/products/platform-mapping?${params}`);
        const json = await res.json();
        if (!res.ok) break;
        const batch = json.data ?? [];
        allData.push(...batch);
        if (batch.length < 500) break;
        page++;
      }
      setMappingData(allData);

      // Also fetch all unique variation_skus from sku_pricing
      const allVars: { variation_sku: string; brand: string }[] = [];
      const seenVars = new Set<string>();
      let varPage = 1;
      while (true) {
        const vParams = new URLSearchParams({ page: String(varPage), pageSize: "1000" });
        if (mappingBrand !== "ALL") vParams.set("brand", mappingBrand);
        const vRes = await fetch(`/api/products/pricing?${vParams}`);
        const vJson = await vRes.json();
        const vBatch = vJson.data ?? [];
        for (const r of vBatch) {
          if (r.variation_sku && !seenVars.has(r.variation_sku)) {
            seenVars.add(r.variation_sku);
            allVars.push({ variation_sku: r.variation_sku, brand: r.brand });
          }
        }
        if (vBatch.length < 1000) break;
        varPage++;
      }
      setAllVariations(allVars);
    } catch (e: any) {
      setToast({ message: e.message ?? "Network error", type: "error" });
    } finally {
      setMappingLoading(false);
    }
  }, [mappingBrand]);

  // ── Load data on tab / filter change ───────────────────────────────────────

  useEffect(() => {
    if (activeTab === "Price Grid") { fetchGrid(); fetchMapping(); }
  }, [activeTab, fetchGrid]);

  useEffect(() => {
    if (activeTab === "Pricing Rules") fetchRules();
  }, [activeTab, fetchRules]);

  useEffect(() => {
    if (activeTab === "Platform Mapping") fetchMapping();
  }, [activeTab, fetchMapping]);

  // Reset page when brand/search changes
  useEffect(() => { setGridPage(1); }, [gridBrand, gridSearch, gridPageSize]);

  // ── Save single cell ──────────────────────────────────────────────────────

  // Save a pricing field and apply to ALL sizes under the same VARIATION_SKU
  async function savePricingCell(row: SkuPricing, field: string, value: string) {
    const textFields = ["category", "collection", "size"];
    const isText = textFields.includes(field);
    const parsedVal = value === "" ? null : isText ? value : parseFloat(value);
    // Find all ITEM_SKUs under this VARIATION_SKU
    const siblings = gridData.filter((r) => r.variation_sku === row.variation_sku);
    const items = siblings.map((s) => ({
      item_sku: s.item_sku,
      variation_sku: s.variation_sku,
      [field]: parsedVal,
    }));

    try {
      const res = await fetch("/api/products/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        setToast({ message: `Saved to ${items.length} sizes`, type: "ok" });
        // Update all siblings in local state
        setGridData((prev) =>
          prev.map((r) =>
            r.variation_sku === row.variation_sku
              ? { ...r, [field]: parsedVal }
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
    const textFields = ["product_name", "category", "sub_category", "collection", "collection_key", "parents_sku"];
    const isText = textFields.includes(field);
    const parsed = value === "" ? null : isText ? value : parseFloat(value);

    try {
      const res = await fetch("/api/products/pricing/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: [{
            id: rule.id,
            brand: rule.brand,
            collection_key: rule.collection_key,
            [field]: parsed,
          }],
        }),
      });
      if (res.ok) {
        setToast({ message: "Rule saved", type: "ok" });
        setRulesData((prev) =>
          prev.map((r) =>
            r.id === rule.id
              ? { ...r, [field]: parsed }
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
    setConfirmApply(false);
    setSyncProgress({ active: true, pct: 5, label: "Applying pricing rules..." });

    let pct = 5;
    const timer = setInterval(() => {
      pct = Math.min(pct + Math.random() * 5 + 2, 85);
      setSyncProgress((p) => p.active && p.pct < 100 ? { ...p, pct: Math.round(pct), label: pct < 30 ? "Loading rules..." : pct < 60 ? "Calculating prices..." : "Updating database..." } : p);
    }, 600);

    try {
      const res = await fetch("/api/products/pricing/apply-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: rulesBrand !== "ALL" ? rulesBrand : undefined }),
      });
      clearInterval(timer);
      const json = await res.json();

      if (res.ok) {
        setSyncProgress({ active: true, pct: 95, label: "Pushing to Google Sheet..." });
        await new Promise((r) => setTimeout(r, 1000));
        setSyncProgress({ active: true, pct: 100, label: `Done! ${(json.updated ?? 0).toLocaleString()} SKUs updated` });
        setToast({ message: `Rules applied to ${(json.updated ?? 0).toLocaleString()} SKUs + pushed to Sheet`, type: "ok" });
        fetchGrid();
        fetchRules();
      } else {
        setSyncProgress({ active: true, pct: 100, label: "Failed" });
        setToast({ message: json.error ?? "Apply failed", type: "error" });
      }
    } catch {
      clearInterval(timer);
      setSyncProgress({ active: true, pct: 100, label: "Failed" });
      setToast({ message: "Apply failed", type: "error" });
    } finally {
      setTimeout(() => setSyncProgress({ active: false, pct: 0, label: "" }), 3000);
      setApplyLoading(false);
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

  function buildCsv(data: SkuPricing[]): string {
    // Build platform mapping lookup
    const mpMap = new Map<string, Record<string, PlatformMapping>>();
    for (const m of mappingData ?? []) {
      if (!mpMap.has(m.item_sku)) mpMap.set(m.item_sku, {});
      mpMap.get(m.item_sku)![m.platform] = m;
    }

    const headers = [
      "ITEM_SKU", "VARIATION_SKU", "Description", "Brand", "RRP", "RSP",
      "Campaign A", "Mega", "Flash Sale", "Min Price", "COGS", "Margin%",
      "Shopee Product ID", "Shopee Option ID",
      "Lazada Product ID", "Lazada Shop SKU",
      "TikTok Product ID", "TikTok SKU ID",
      "Shopify Product ID", "Shopify SKU ID",
    ];
    const rows = data.map((r) => {
      const mp = mpMap.get(r.item_sku) ?? {};
      return [
        r.item_sku, r.variation_sku, r.description ?? "", r.brand,
        r.rrp ?? "", r.rsp ?? "", r.price_campaign_a ?? "", r.price_mega ?? "",
        r.price_flash_sale ?? "", r.min_price ?? "", r.cogs_inc_vat ?? "",
        marginPct(r.est_margin) != null ? marginPct(r.est_margin)!.toFixed(1) : "",
        mp.shopee?.platform_product_id ?? "", mp.shopee?.platform_option_id ?? "",
        mp.lazada?.platform_product_id ?? "", mp.lazada?.platform_option_id ?? "",
        mp.tiktok?.platform_product_id ?? "", mp.tiktok?.platform_option_id ?? "",
        mp.shopify?.platform_product_id ?? "", mp.shopify?.platform_option_id ?? mp.shopify?.platform_sku ?? "",
      ];
    });
    // Platform ID columns (index 12+) — prefix with tab to force Excel text format
    const platformStartIdx = 12;
    return [headers, ...rows].map((row) =>
      row.map((c, idx) => {
        const s = String(c).replace(/"/g, '""');
        // Force text format for platform IDs (long numbers) to prevent Excel scientific notation
        if (idx >= platformStartIdx && s && /^\d{6,}$/.test(s)) {
          return `"\t${s}"`;
        }
        return `"${s}"`;
      }).join(",")
    ).join("\n");
  }

  function downloadCsv(csv: string, filename: string) {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportSelected() {
    if (selectedVars.size === 0) {
      setToast({ message: "No rows selected", type: "error" });
      return;
    }
    const data = gridData.filter((r) => selectedVars.has(r.variation_sku));
    downloadCsv(buildCsv(data), `pricing-selected-${new Date().toISOString().slice(0, 10)}.csv`);
    setToast({ message: `Exported ${selectedVars.size} variations (${data.length} SKUs)`, type: "ok" });
  }

  async function exportAll() {
    setToast({ message: "Exporting all data...", type: "ok" });
    try {
      // Fetch all pages
      const allData: SkuPricing[] = [];
      let page = 1;
      while (true) {
        const params = new URLSearchParams();
        if (gridBrand !== "ALL") params.set("brand", gridBrand);
        if (gridSearch) params.set("q", gridSearch);
        params.set("page", String(page));
        params.set("pageSize", "1000");
        const res = await fetch(`/api/products/pricing?${params}`);
        const json = await res.json();
        const batch = json.data ?? [];
        allData.push(...batch);
        if (batch.length < 1000) break;
        page++;
      }
      downloadCsv(buildCsv(allData), `pricing-all-${new Date().toISOString().slice(0, 10)}.csv`);
      setToast({ message: `Exported ${allData.length} SKUs`, type: "ok" });
    } catch {
      setToast({ message: "Export failed", type: "error" });
    }
  }

  function exportCsv() {
    // Legacy: export current page
    if (!gridData.length) return;
    downloadCsv(buildCsv(gridData), `pricing-export-${new Date().toISOString().slice(0, 10)}.csv`);
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

  const varSkuCount = groupedGrid.length;
  const totalGridPages = Math.max(1, Math.ceil(gridTotal / gridPageSize));

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
      <div className="page" style={{ maxWidth: 1440 }}>
        {/* ── Sync Progress Bar ── */}
        {syncProgress.active && (
          <div className="card" style={{ marginBottom: 16, padding: "14px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: "0.88rem" }}>
              <span style={{ fontWeight: 600 }}>{syncProgress.label}</span>
              <span style={{ fontWeight: 700, color: "var(--app-accent)" }}>{syncProgress.pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, background: "linear-gradient(90deg, var(--app-accent), #3b82f6)", width: `${syncProgress.pct}%`, transition: "width 0.4s ease" }} />
            </div>
          </div>
        )}

        {/* ── Tab Switcher + Sync Button ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div className="tabs" style={{ margin: 0 }}>
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
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="ghost"
              onClick={async () => {
                setSyncing(true);
                setSyncProgress({ active: true, pct: 20, label: "Pushing prices to Google Sheet..." });
                let pct = 20;
                const timer = setInterval(() => { pct = Math.min(pct + 5, 90); setSyncProgress(p => p.active && p.pct < 100 ? { ...p, pct: Math.round(pct) } : p); }, 500);
                try {
                  const res = await fetch("/api/master-data/write-gsheet", { method: "POST" });
                  clearInterval(timer);
                  const json = await res.json();
                  setSyncProgress({ active: true, pct: 100, label: "Complete!" });
                  if (json.ok) setToast({ message: `Pushed prices to Sheet: ${JSON.stringify(json.written)}`, type: "ok" });
                  else setToast({ message: json.error ?? "Push failed", type: "error" });
                } catch { clearInterval(timer); setToast({ message: "Push failed", type: "error" }); }
                setTimeout(() => setSyncProgress({ active: false, pct: 0, label: "" }), 2000);
                setSyncing(false);
              }}
              disabled={syncing}
              style={{ fontSize: "0.85rem", padding: "8px 16px", display: "flex", alignItems: "center", gap: 6 }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M8 3v10" /><path d="M4 7l4-4 4 4" />
              </svg>
              Push to Sheet
            </button>
            {/* Pull from Sheet removed — sheet data may be incorrect and corrupt the database */}
          </div>
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
                <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
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
                  <details className="export-dropdown">
                    <summary className="ghost export-dropdown-trigger">
                      Export ▾
                    </summary>
                    <div className="export-dropdown-menu">
                      <button type="button" onClick={(e) => { exportAll(); (e.currentTarget.closest("details") as HTMLDetailsElement)!.open = false; }}>
                        Export All
                      </button>
                      <button type="button" disabled={selectedVars.size === 0} onClick={(e) => { exportSelected(); (e.currentTarget.closest("details") as HTMLDetailsElement)!.open = false; }}>
                        Export Selected{selectedVars.size > 0 ? ` (${selectedVars.size})` : ""}
                      </button>
                    </div>
                  </details>
                </div>
              </div>

              {/* Info bar: total count + rows per page */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: "0.85rem" }}>
                <span style={{ color: "var(--text-muted)" }}>
                  Showing <strong style={{ color: "var(--text)" }}>{gridData.length}</strong> of <strong style={{ color: "var(--text)" }}>{gridTotal.toLocaleString()}</strong> SKUs
                  {selectedVars.size > 0 && <> &middot; <span style={{ color: "var(--app-accent)", fontWeight: 600 }}>{selectedVars.size} selected</span></>}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text-muted)" }}>Rows:</span>
                  <select
                    value={gridPageSize}
                    onChange={(e) => setGridPageSize(Number(e.target.value))}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-2)", fontSize: "0.85rem", background: "var(--surface)" }}
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Grid table */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {gridLoading ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
                  Loading pricing data...
                </div>
              ) : gridData.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
                  No pricing data found. Try adjusting your filters or import from Excel.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 36, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={gridData.length > 0 && selectedVars.size === gridData.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedVars(new Set(gridData.map((r) => r.item_sku)));
                              } else {
                                setSelectedVars(new Set());
                              }
                            }}
                            style={{ cursor: "pointer" }}
                          />
                        </th>
                        <th style={{ minWidth: 150 }}>ITEM SKU</th>
                        <th style={{ minWidth: 120 }}>Variation SKU</th>
                        <th style={{ minWidth: 180 }}>Description</th>
                        <th style={{ minWidth: 50 }}>Brand</th>
                        <th style={{ minWidth: 90, textAlign: "right" }}>RRP</th>
                        <th style={{ minWidth: 90, textAlign: "right" }}>RSP</th>
                        <th style={{ minWidth: 95, textAlign: "right" }}>Campaign A</th>
                        <th style={{ minWidth: 85, textAlign: "right" }}>Mega</th>
                        <th style={{ minWidth: 95, textAlign: "right" }}>Flash Sale</th>
                        <th style={{ minWidth: 90, textAlign: "right" }}>Min Price</th>
                        <th style={{ minWidth: 85, textAlign: "right" }}>COGS</th>
                        <th style={{ minWidth: 80, textAlign: "right" }}>Margin%</th>
                        {/* Platform IDs — scroll right to see */}
                        <th style={{ minWidth: 130, borderLeft: "2px solid var(--border-2)" }}>Shopee Product ID</th>
                        <th style={{ minWidth: 130 }}>Shopee Option ID</th>
                        <th style={{ minWidth: 130, borderLeft: "2px solid var(--border-2)" }}>Lazada Product ID</th>
                        <th style={{ minWidth: 150 }}>Lazada Shop SKU</th>
                        <th style={{ minWidth: 130, borderLeft: "2px solid var(--border-2)" }}>TikTok Product ID</th>
                        <th style={{ minWidth: 130 }}>TikTok SKU ID</th>
                        <th style={{ minWidth: 130, borderLeft: "2px solid var(--border-2)" }}>Shopify Product ID</th>
                        <th style={{ minWidth: 130 }}>Shopify SKU ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gridData.map((row, gi) => {
                        // Find platform mappings for this item_sku
                        const mp = (mappingData ?? []).reduce((acc: Record<string, PlatformMapping>, m) => {
                          if (m.item_sku === row.item_sku) acc[m.platform] = m;
                          return acc;
                        }, {});
                        return (
                          <tr
                            key={row.item_sku}
                            data-row-idx={gi}
                            style={{ background: selectedVars.has(row.item_sku) ? "rgba(30,64,175,0.06)" : groupRowBg(gi) }}
                          >
                            <td style={{ textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={selectedVars.has(row.item_sku)}
                                onChange={(e) => {
                                  setSelectedVars((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(row.item_sku);
                                    else next.delete(row.item_sku);
                                    return next;
                                  });
                                }}
                                style={{ cursor: "pointer" }}
                              />
                            </td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", fontWeight: 600 }}>
                              {row.item_sku}
                            </td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.82rem", color: "var(--text-muted)" }}>
                              <a href={`/products/${encodeURIComponent(row.variation_sku)}`} style={{ color: "var(--app-accent)", textDecoration: "none" }}>
                                {row.variation_sku}
                              </a>
                            </td>
                            <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                              {row.description ?? "–"}
                            </td>
                            <td>
                              <BrandBadge brand={row.brand} />
                            </td>
                            {(["rrp", "rsp", "price_campaign_a", "price_mega", "price_flash_sale", "min_price"] as const).map((col) => (
                              <td key={col} style={{ textAlign: "right" }}>
                                <span style={{ fontSize: "0.85rem" }}>{fmt((row as any)[col])}</span>
                              </td>
                            ))}
                            <td style={{ textAlign: "right", color: "var(--text-muted)" }}>
                              {fmt(row.cogs_inc_vat)}
                            </td>
                            <td style={{ textAlign: "right", background: marginColor(row.est_margin), color: marginTextColor(row.est_margin), fontWeight: 700, fontSize: "0.85rem" }}>
                              {marginPct(row.est_margin) != null ? `${marginPct(row.est_margin)!.toFixed(1)}%` : "–"}
                            </td>
                            {/* Platform columns — scroll right */}
                            {/* Shopee: Product ID + Option ID (รหัสตัวเลือกสินค้า) */}
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.78rem", color: mp.shopee ? "var(--text)" : "var(--text-muted)", borderLeft: "2px solid var(--border-2)" }}>{mp.shopee?.platform_product_id ?? "–"}</td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.78rem", color: mp.shopee ? "var(--text)" : "var(--text-muted)" }}>{mp.shopee?.platform_option_id ?? "–"}</td>
                            {/* Lazada: Product ID + ร้าน sku (Shop SKU) */}
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.78rem", color: mp.lazada ? "var(--text)" : "var(--text-muted)", borderLeft: "2px solid var(--border-2)" }}>{mp.lazada?.platform_product_id ?? "–"}</td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.78rem", color: mp.lazada ? "var(--text)" : "var(--text-muted)" }}>{mp.lazada?.platform_option_id ?? "–"}</td>
                            {/* TikTok: รหัสสินค้า + SKU ID */}
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.78rem", color: mp.tiktok ? "var(--text)" : "var(--text-muted)", borderLeft: "2px solid var(--border-2)" }}>{mp.tiktok?.platform_product_id ?? "–"}</td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.78rem", color: mp.tiktok ? "var(--text)" : "var(--text-muted)" }}>{mp.tiktok?.platform_option_id ?? "–"}</td>
                            {/* Shopify: Product ID + SKU ID */}
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.78rem", color: mp.shopify ? "var(--text)" : "var(--text-muted)", borderLeft: "2px solid var(--border-2)" }}>{mp.shopify?.platform_product_id || "–"}</td>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.78rem", color: mp.shopify ? "var(--text)" : "var(--text-muted)" }}>{mp.shopify?.platform_option_id || mp.shopify?.platform_sku || "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalGridPages > 1 && (
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
                  <span style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginLeft: "auto" }}>
                    {gridTotal.toLocaleString("th-TH")} total variations
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
                      if (f) handleImport(f, "/api/products/pricing/import", fetchRules);
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

              {/* Info bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: "0.85rem" }}>
                <span style={{ color: "var(--text-muted)" }}>
                  Showing <strong style={{ color: "var(--text)" }}>{rulesData.length}</strong> of <strong style={{ color: "var(--text)" }}>{rulesTotal.toLocaleString()}</strong> rules
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text-muted)" }}>Rows:</span>
                  <select value={rulesPageSize} onChange={(e) => setRulesPageSize(Number(e.target.value))}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-2)", fontSize: "0.85rem", background: "var(--surface)" }}>
                    {PAGE_SIZE_OPTIONS.map((n) => (<option key={n} value={n}>{n}</option>))}
                  </select>
                </div>
              </div>
            </div>

            {/* Rules table */}
            <div className="card" style={{ padding: 0 }}>
              {rulesLoading ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
                  Loading rules...
                </div>
              ) : rulesData.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
                  No pricing rules found. Import a COL sheet to get started.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table" style={{ width: "100%", tableLayout: "fixed" }}>
                    <thead>
                      <tr>
                        <th style={{ width: "12%" }}>Variation SKU</th>
                        <th style={{ width: "18%" }}>Description</th>
                        <th style={{ width: "5%" }}>Brand</th>
                        <th style={{ width: "7%" }}>Group</th>
                        <th style={{ width: "9%" }}>Category</th>
                        <th style={{ width: "9%" }}>Sub-Cat</th>
                        <th style={{ width: "7%", textAlign: "right" }}>%RSP</th>
                        <th style={{ width: "7%", textAlign: "right" }}>%A</th>
                        <th style={{ width: "7%", textAlign: "right" }}>%Mega</th>
                        <th style={{ width: "7%", textAlign: "right" }}>%FS</th>
                        <th style={{ width: "8%", textAlign: "right" }}>%Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rulesData.map((rule, i) => (
                        <tr key={rule.id ?? i} data-row-idx={i}>
                          <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.84rem", fontWeight: 600 }}>
                            <a href={`/products/${encodeURIComponent((rule as any).variation_sku || rule.parents_sku || "")}`} style={{ color: "var(--app-accent)", textDecoration: "none" }}>
                              {(rule as any).variation_sku || rule.parents_sku || "–"}
                            </a>
                          </td>
                          <td>
                            <EditableCell value={rule.product_name} format="text" onSave={(v) => saveRuleCell(rule, "product_name", v)} />
                          </td>
                          <td>
                            <BrandBadge brand={rule.brand} />
                          </td>
                          <td style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                            {rule.collection_key ?? "–"}
                          </td>
                          <td data-col="category" style={{
                            position: "relative",
                            background: rulesIsHighlighted(i, "category") ? "rgba(30,64,175,0.10)" : undefined,
                          }} className="drag-fill-cell">
                            <EditableCell value={rule.category} format="text" onSave={(v) => saveRuleCell(rule, "category", v)} />
                            <DragHandle onMouseDown={() => rulesStartDrag(i, "category", rule.category ?? null)} />
                          </td>
                          <td data-col="sub_category" style={{
                            position: "relative",
                            background: rulesIsHighlighted(i, "sub_category") ? "rgba(30,64,175,0.10)" : undefined,
                          }} className="drag-fill-cell">
                            <EditableCell value={rule.sub_category} format="text" onSave={(v) => saveRuleCell(rule, "sub_category", v)} />
                            <DragHandle onMouseDown={() => rulesStartDrag(i, "sub_category", rule.sub_category ?? null)} />
                          </td>
                          {(["pct_rsp", "pct_campaign_a", "pct_mega", "pct_flash_sale"] as const).map((col) => (
                            <td key={col} data-col={col} style={{
                              textAlign: "right", position: "relative",
                              background: rulesIsHighlighted(i, col) ? "rgba(30,64,175,0.10)" : undefined,
                            }} className="drag-fill-cell">
                              <EditableCell
                                value={(rule as any)[col]}
                                format="percent"
                                onSave={(v) => saveRuleCell(rule, col, v)}
                              />
                              <DragHandle onMouseDown={() => rulesStartDrag(i, col, (rule as any)[col])} />
                            </td>
                          ))}
                          {(() => {
                            const m = calcRuleMargin(rule, maxPlatformFeeRate);
                            return (
                              <td style={{
                                textAlign: "right",
                                color: marginTextColor(m, true),
                                fontWeight: 600,
                                background: marginColor(m, true),
                              }}>
                                {m != null ? `${(m * 100).toFixed(1)}%` : "–"}
                              </td>
                            );
                          })()}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {rulesTotal > rulesPageSize && (
                <div className="pager" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                  <button className="ghost" disabled={rulesPage <= 1} onClick={() => setRulesPage((p) => Math.max(1, p - 1))} style={{ padding: "6px 14px", fontSize: "0.85rem" }}>Prev</button>
                  <span className="pager-info">Page {rulesPage} of {Math.max(1, Math.ceil(rulesTotal / rulesPageSize))}</span>
                  <button className="ghost" disabled={rulesPage >= Math.ceil(rulesTotal / rulesPageSize)} onClick={() => setRulesPage((p) => p + 1)} style={{ padding: "6px 14px", fontSize: "0.85rem" }}>Next</button>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginLeft: "auto" }}>{rulesTotal.toLocaleString()} total rules</span>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Apply rules confirmation — outside tab content to avoid overflow:hidden */}
        <ConfirmDialog
          open={confirmApply}
          title="Apply Pricing Rules"
          message={`This will recalculate RSP, Campaign A, Mega, and Flash Sale prices for ${
            rulesBrand !== "ALL" ? `all ${rulesBrand}` : "all"
          } SKUs based on the current rules. Continue?`}
          onConfirm={applyRules}
          onCancel={() => setConfirmApply(false)}
        />

        {/* ════════════════════════════════════════════════════════════════════
            TAB 3: PLATFORM MAPPING
        ════════════════════════════════════════════════════════════════════ */}
        {activeTab === "Platform Mapping" && (() => {
          // Group mapping data by variation_sku (derive from item_sku)
          const varMappingMap = new Map<string, { brand: string; platforms: Map<string, { listed: number; total: number }> }>();
          // 1. Build from platform mapping data
          for (const m of mappingData) {
            const varSku = m.brand === "DB"
              ? m.item_sku.replace(/(-\d{1,2}){1,2}$/, "").replace(/-(0[SML]|XL|2L|00)$/, "")
              : m.item_sku.slice(0, 9);

            if (!varMappingMap.has(varSku)) {
              varMappingMap.set(varSku, { brand: m.brand, platforms: new Map() });
            }
            const entry = varMappingMap.get(varSku)!;
            if (!entry.platforms.has(m.platform)) {
              entry.platforms.set(m.platform, { listed: 0, total: 0 });
            }
            const pEntry = entry.platforms.get(m.platform)!;
            pEntry.total++;
            if (m.listing_status === "listed") pEntry.listed++;
          }

          // 2. Add SKUs from sku_pricing that have NO platform mapping at all
          for (const v of allVariations) {
            if (!varMappingMap.has(v.variation_sku)) {
              varMappingMap.set(v.variation_sku, { brand: v.brand, platforms: new Map() });
            }
          }

          const PLATFORM_ORDER = ["shopee", "lazada", "tiktok", "shopify"];
          const sortPlatforms = (arr: string[]) => arr.sort((a, b) => {
            const ai = PLATFORM_ORDER.indexOf(a.toLowerCase().split(" ")[0]);
            const bi = PLATFORM_ORDER.indexOf(b.toLowerCase().split(" ")[0]);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });

          const varMappingList = [...varMappingMap.entries()].map(([varSku, data]) => {
            const listedPlatforms: string[] = [];
            const notListedPlatforms: string[] = [];
            const partialPlatforms: string[] = [];
            for (const [pName, counts] of data.platforms) {
              if (counts.listed === counts.total && counts.total > 0) listedPlatforms.push(pName);
              else if (counts.listed === 0) notListedPlatforms.push(pName);
              else partialPlatforms.push(`${pName} (${counts.listed}/${counts.total})`);
            }
            const missingPlatforms = PLATFORM_ORDER.filter((p) => !data.platforms.has(p));

            // Sort all arrays in fixed order: shopee → lazada → tiktok → shopify
            sortPlatforms(listedPlatforms);
            sortPlatforms(notListedPlatforms);
            sortPlatforms(partialPlatforms);
            sortPlatforms(missingPlatforms);

            return { varSku, brand: data.brand, listedPlatforms, notListedPlatforms, partialPlatforms, missingPlatforms };
          });

          // Counts
          const fullCount = varMappingList.filter((v) => v.listedPlatforms.length > 0 && v.notListedPlatforms.length === 0 && v.partialPlatforms.length === 0 && v.missingPlatforms.length === 0).length;
          const incompleteCount = varMappingList.filter((v) => v.listedPlatforms.length > 0 && (v.notListedPlatforms.length > 0 || v.partialPlatforms.length > 0 || v.missingPlatforms.length > 0)).length;
          const notListedCount = varMappingList.filter((v) => v.listedPlatforms.length === 0).length;

          // Filter by status
          const filteredMappingList = mappingStatus === "all" ? varMappingList
            : mappingStatus === "full" ? varMappingList.filter((v) => v.listedPlatforms.length > 0 && v.notListedPlatforms.length === 0 && v.partialPlatforms.length === 0 && v.missingPlatforms.length === 0)
            : mappingStatus === "incomplete" ? varMappingList.filter((v) => v.listedPlatforms.length > 0 && (v.notListedPlatforms.length > 0 || v.partialPlatforms.length > 0 || v.missingPlatforms.length > 0))
            : mappingStatus === "not_listed" ? varMappingList.filter((v) => v.listedPlatforms.length === 0)
            : varMappingList;

          // Stats (from unfiltered list)
          const platformStats: Record<string, number> = {};
          for (const v of varMappingList) {
            for (const p of v.listedPlatforms) {
              platformStats[p] = (platformStats[p] || 0) + 1;
            }
          }

          return (
          <div>
            {/* Summary stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
              {PLATFORMS.map((p) => (
                <div key={p} className="card" style={{ padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{p}</div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 700, color: PLATFORM_COLORS[PLATFORM_DB_KEY[p] ?? p.toLowerCase()]?.color ?? "var(--app-accent)" }}>
                    {(platformStats[PLATFORM_DB_KEY[p] ?? p.toLowerCase()] ?? 0).toLocaleString("th-TH")}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2 }}>variations listed</div>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div className="brand-tabs">
                  {BRANDS.map((b) => (
                    <button key={b} className={`brand-tab${mappingBrand === b ? " active" : ""}`} onClick={() => setMappingBrand(b)}>{b}</button>
                  ))}
                </div>
                {/* Status filter */}
                <div style={{ display: "flex", gap: 4 }}>
                  {([
                    { key: "all", label: "All", count: varMappingList.length },
                    { key: "full", label: "Full Listed", count: fullCount },
                    { key: "incomplete", label: "Partial", count: incompleteCount },
                    { key: "not_listed", label: "Not Listed", count: notListedCount },
                  ] as const).map(({ key, label, count }) => (
                    <button
                      key={key}
                      onClick={() => setMappingStatus(key)}
                      style={{
                        padding: "6px 12px", borderRadius: 8, border: "1px solid",
                        fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                        background: mappingStatus === key ? (key === "full" ? "rgba(5,150,105,0.1)" : key === "incomplete" ? "rgba(217,119,6,0.1)" : key === "not_listed" ? "rgba(220,38,38,0.1)" : "var(--accent-soft)") : "transparent",
                        color: mappingStatus === key ? (key === "full" ? "var(--ok)" : key === "incomplete" ? "var(--warn)" : key === "not_listed" ? "var(--error)" : "var(--app-accent)") : "var(--text-muted)",
                        borderColor: mappingStatus === key ? "currentColor" : "var(--border-2)",
                      }}
                    >
                      {label} ({count})
                    </button>
                  ))}
                </div>

                <div style={{ marginLeft: "auto" }}>
                  <button className="ghost" onClick={() => mappingFileRef.current?.click()}>Import SKU Sheet</button>
                  <input ref={mappingFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f, "/api/products/pricing/import", fetchMapping); e.target.value = ""; }} />
                </div>
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: 8 }}>
                Showing <strong style={{ color: "var(--text)" }}>{filteredMappingList.length}</strong> of {varMappingList.length} variations
              </div>
            </div>

            {/* Mapping table — grouped by variation_sku */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {mappingLoading ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>Loading mappings...</div>
              ) : filteredMappingList.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>No platform mappings found.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 150 }}>Variation SKU</th>
                        <th style={{ width: 60 }}>Brand</th>
                        <th style={{ minWidth: 200 }}>Listed Platforms</th>
                        <th style={{ minWidth: 200 }}>Not Listed / Incomplete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMappingList.map((v, i) => {
                        const allListed = v.notListedPlatforms.length === 0 && v.partialPlatforms.length === 0 && v.missingPlatforms.length === 0;
                        return (
                          <tr key={v.varSku} style={{ background: i % 2 === 0 ? "transparent" : "var(--surface-2)" }}>
                            <td style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.84rem", fontWeight: 600 }}>
                              <a href={`/products/${encodeURIComponent(v.varSku)}`} style={{ color: "var(--app-accent)", textDecoration: "none" }}>{v.varSku}</a>
                            </td>
                            <td><BrandBadge brand={v.brand} /></td>
                            <td>
                              {v.listedPlatforms.length > 0 ? (
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                  {v.listedPlatforms.map((p) => (
                                    <PlatformBadge key={p} platform={p} status="listed" />
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>–</span>
                              )}
                            </td>
                            <td>
                              {allListed ? (
                                <span style={{ color: "var(--ok)", fontSize: "0.82rem", fontWeight: 600 }}>All listed</span>
                              ) : (
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                  {v.notListedPlatforms.map((p) => (
                                    <PlatformBadge key={p} platform={p} status="not_listed" />
                                  ))}
                                  {v.partialPlatforms.map((p) => (
                                    <span key={p} style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, background: "rgba(217,119,6,0.08)", color: "var(--warn)", border: "1px solid rgba(217,119,6,0.2)" }}>{p}</span>
                                  ))}
                                  {v.missingPlatforms.map((p) => (
                                    <span key={p} style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, background: "rgba(156,163,175,0.08)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>{p} (missing)</span>
                                  ))}
                                </div>
                              )}
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
        );
        })()}
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
