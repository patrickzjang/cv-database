"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type AlertConfig = {
  id?: number;
  sku_code: string;
  brand: string;
  min_stock: number;
  reorder_qty: number;
  lead_days: number;
  current_stock?: number;
  status?: "in_stock" | "low" | "out";
};

type AlertSummary = {
  total: number;
  low_stock: number;
  out_of_stock: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status?: string) {
  if (status === "out") return { label: "Out of Stock", bg: "rgba(220,38,38,0.08)", color: "var(--error)", border: "rgba(220,38,38,0.25)" };
  if (status === "low") return { label: "Low Stock", bg: "rgba(217,119,6,0.08)", color: "var(--warn)", border: "rgba(217,119,6,0.25)" };
  return { label: "In Stock", bg: "rgba(5,150,105,0.08)", color: "var(--ok)", border: "rgba(5,150,105,0.25)" };
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return "–";
  return n.toLocaleString("th-TH");
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AlertsSettingsPage() {
  const router = useRouter();

  const [configs, setConfigs] = useState<AlertConfig[]>([]);
  const [summary, setSummary] = useState<AlertSummary>({ total: 0, low_stock: 0, out_of_stock: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAlert, setNewAlert] = useState<AlertConfig>({ sku_code: "", brand: "", min_stock: 10, reorder_qty: 50, lead_days: 7 });
  const [skuSuggestions, setSkuSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef<HTMLDivElement>(null);

  const [brandFilter, setBrandFilter] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch alerts ──
  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = brandFilter
        ? `/api/inventory/alerts?brand=${encodeURIComponent(brandFilter)}`
        : "/api/inventory/alerts";
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) {
        if (res.status === 401) { router.push("/login"); return; }
        setError(json.error);
      } else {
        setConfigs(json.configs ?? json.alerts ?? []);
        if (json.summary) setSummary(json.summary);
        else {
          const list = json.configs ?? json.alerts ?? [];
          setSummary({
            total: list.length,
            low_stock: list.filter((c: AlertConfig) => c.status === "low").length,
            out_of_stock: list.filter((c: AlertConfig) => c.status === "out").length,
          });
        }
      }
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [router, brandFilter]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  // ── Close suggestion dropdown on outside click ──
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── SKU autocomplete ──
  const searchSku = async (q: string) => {
    if (q.length < 2) { setSkuSuggestions([]); return; }
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      setSkuSuggestions(json.skus ?? json.results?.map((r: any) => r.sku_code) ?? []);
      setShowSuggestions(true);
    } catch {
      setSkuSuggestions([]);
    }
  };

  // ── Save alerts ──
  const saveAlerts = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/inventory/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setSuccess("Alert configurations saved.");
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  };

  // ── Add new alert ──
  const addAlert = () => {
    if (!newAlert.sku_code.trim()) return;
    setConfigs((prev) => [...prev, { ...newAlert }]);
    setNewAlert({ sku_code: "", brand: "", min_stock: 10, reorder_qty: 50, lead_days: 7 });
    setShowAddForm(false);
  };

  // ── Delete alert ──
  const deleteAlert = (index: number) => {
    setConfigs((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Inline edit ──
  const updateConfig = (index: number, col: string, value: string) => {
    setConfigs((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      (row as any)[col] = ["min_stock", "reorder_qty", "lead_days"].includes(col) ? (parseInt(value) || 0) : value;
      next[index] = row;
      return next;
    });
  };

  // ── Bulk CSV import ──
  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const header = lines[0].toLowerCase();
      const hasHeader = header.includes("sku_code") || header.includes("brand");
      const start = hasHeader ? 1 : 0;

      const imported: AlertConfig[] = [];
      for (let i = start; i < lines.length; i++) {
        const parts = lines[i].split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
        if (parts.length >= 5) {
          imported.push({
            sku_code: parts[0],
            brand: parts[1],
            min_stock: parseInt(parts[2]) || 10,
            reorder_qty: parseInt(parts[3]) || 50,
            lead_days: parseInt(parts[4]) || 7,
          });
        }
      }

      if (imported.length > 0) {
        setConfigs((prev) => [...prev, ...imported]);
        setSuccess(`Imported ${imported.length} alert configurations.`);
        setTimeout(() => setSuccess(null), 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const editableCols = [
    { key: "min_stock", label: "Min Stock" },
    { key: "reorder_qty", label: "Reorder Qty" },
    { key: "lead_days", label: "Lead Days" },
  ];

  const brands = Array.from(new Set(configs.map((c) => c.brand).filter(Boolean)));

  return (
    <div>
      <div className="page">
        {/* ── Error / Success ── */}
        {error && (
          <div style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 12,
            padding: "12px 16px", color: "var(--error)", marginBottom: 16 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.25)", borderRadius: 12,
            padding: "12px 16px", color: "var(--ok)", marginBottom: 16 }}>
            {success}
          </div>
        )}

        {/* ── Summary Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
          <div className="card" style={{ padding: "18px 22px" }}>
            <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Total Configured
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text)" }}>
              {fmtInt(summary.total)}
            </div>
          </div>
          <div className="card" style={{ padding: "18px 22px", background: "rgba(217,119,6,0.04)" }}>
            <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Low Stock Alerts
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--warn)" }}>
              {fmtInt(summary.low_stock)}
            </div>
          </div>
          <div className="card" style={{ padding: "18px 22px", background: "rgba(220,38,38,0.04)" }}>
            <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Out of Stock
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--error)" }}>
              {fmtInt(summary.out_of_stock)}
            </div>
          </div>
        </div>

        {/* ── Actions Bar ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {/* Brand filter */}
            <div>
              <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 8, fontSize: "0.88rem" }}>
                <option value="">All Brands</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="ghost" onClick={() => setShowAddForm((v) => !v)}>
                {showAddForm ? "Cancel" : "+ Add Alert"}
              </button>
              <button className="ghost" onClick={() => fileInputRef.current?.click()}>
                Import CSV
              </button>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSVImport} />
              <button className="primary" onClick={saveAlerts} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          {/* ── Add Form ── */}
          {showAddForm && (
            <div style={{ marginTop: 16, padding: 16, background: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: "0.95rem" }}>Add New Alert</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                <div ref={suggestRef} style={{ position: "relative" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>SKU Code</label>
                  <input
                    type="text"
                    value={newAlert.sku_code}
                    onChange={(e) => {
                      setNewAlert((p) => ({ ...p, sku_code: e.target.value }));
                      searchSku(e.target.value);
                    }}
                    onFocus={() => skuSuggestions.length > 0 && setShowSuggestions(true)}
                    placeholder="e.g. AN-SHP-001"
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.88rem" }}
                  />
                  {showSuggestions && skuSuggestions.length > 0 && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                      background: "#fff", border: "1px solid var(--border-2)", borderRadius: 8,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 160, overflowY: "auto",
                    }}>
                      {skuSuggestions.map((sku) => (
                        <div key={sku}
                          onClick={() => { setNewAlert((p) => ({ ...p, sku_code: sku })); setShowSuggestions(false); }}
                          style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.88rem", fontFamily: "monospace" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                          {sku}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Brand</label>
                  <input type="text" value={newAlert.brand}
                    onChange={(e) => setNewAlert((p) => ({ ...p, brand: e.target.value }))}
                    placeholder="e.g. ARENA"
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.88rem" }} />
                </div>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Min Stock</label>
                  <input type="number" value={newAlert.min_stock}
                    onChange={(e) => setNewAlert((p) => ({ ...p, min_stock: parseInt(e.target.value) || 0 }))}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.88rem" }} />
                </div>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Reorder Qty</label>
                  <input type="number" value={newAlert.reorder_qty}
                    onChange={(e) => setNewAlert((p) => ({ ...p, reorder_qty: parseInt(e.target.value) || 0 }))}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.88rem" }} />
                </div>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Lead Days</label>
                  <input type="number" value={newAlert.lead_days}
                    onChange={(e) => setNewAlert((p) => ({ ...p, lead_days: parseInt(e.target.value) || 0 }))}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: "0.88rem" }} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button className="primary" onClick={addAlert} disabled={!newAlert.sku_code.trim()}
                    style={{ width: "100%" }}>
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "60px 0" }}>
            Loading alert configurations...
          </div>
        )}

        {/* ── Alerts Table ── */}
        {!loading && (
          <div className="card">
            <div style={{ overflowX: "auto" }}>
              <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th>SKU Code</th>
                    <th>Brand</th>
                    <th style={{ textAlign: "right" }}>Min Stock</th>
                    <th style={{ textAlign: "right" }}>Reorder Qty</th>
                    <th style={{ textAlign: "right" }}>Lead Days</th>
                    <th style={{ textAlign: "right" }}>Current Stock</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                    <th style={{ textAlign: "center", width: 80 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>
                        No alert configurations. Click &quot;Add Alert&quot; to create one.
                      </td>
                    </tr>
                  ) : (
                    configs.map((row, i) => {
                      const badge = statusBadge(row.status);
                      return (
                        <tr key={`${row.sku_code}-${i}`}>
                          <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--purple)" }}>{row.sku_code}</td>
                          <td>{row.brand}</td>
                          {editableCols.map(({ key }) => {
                            const isEditing = editingCell?.row === i && editingCell?.col === key;
                            const val = (row as any)[key] as number;
                            return (
                              <td key={key} style={{ textAlign: "right", padding: isEditing ? "4px 6px" : undefined }}
                                onClick={() => setEditingCell({ row: i, col: key })}>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    autoFocus
                                    defaultValue={val}
                                    onBlur={(e) => { updateConfig(i, key, e.target.value); setEditingCell(null); }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") { updateConfig(i, key, (e.target as HTMLInputElement).value); setEditingCell(null); }
                                      if (e.key === "Escape") setEditingCell(null);
                                    }}
                                    style={{ width: 70, textAlign: "right", padding: "4px 8px", borderRadius: 6,
                                      border: "1px solid var(--cyan)", background: "rgba(0,180,216,0.06)", fontSize: "0.88rem" }}
                                  />
                                ) : (
                                  <span style={{ cursor: "pointer", padding: "2px 6px", borderRadius: 4, transition: "background 0.15s" }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                                    {fmtInt(val)}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td style={{ textAlign: "right" }}>{row.current_stock != null ? fmtInt(row.current_stock) : "–"}</td>
                          <td style={{ textAlign: "center" }}>
                            <span style={{
                              display: "inline-block", padding: "2px 10px", borderRadius: 999,
                              fontSize: "0.75rem", fontWeight: 700,
                              background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                            }}>
                              {badge.label}
                            </span>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button className="danger" onClick={() => deleteAlert(i)}
                              style={{ padding: "4px 10px", fontSize: "0.8rem" }}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
