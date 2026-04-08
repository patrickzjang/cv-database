"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ──────────────────────────────────────────────────────────────── */
type Supplier = {
  supplier_code: string;
  supplier_name: string;
  contact_name?: string;
  contact_phone?: string;
  address?: string;
};

type ComboSet = {
  ItemId: string;
  CombineId: string;
  Name: string;
  CostPrice?: number;
  SalePrice?: number;
  Barcode?: string;
  CombineDetails: { SrcSkuId: string; SrcSkuQtyExpend: number }[];
};

/* ── Component ──────────────────────────────────────────────────────────── */
export default function SuppliersPage() {
  const [tab, setTab] = useState<"suppliers" | "combos">("suppliers");

  // ── Suppliers state ──
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSup, setLoadingSup] = useState(true);
  const [showAddSup, setShowAddSup] = useState(false);
  const [newSup, setNewSup] = useState<Partial<Supplier>>({});

  // ── Combos state ──
  const [combos, setCombos] = useState<ComboSet[]>([]);
  const [loadingCombo, setLoadingCombo] = useState(true);
  const [showAddCombo, setShowAddCombo] = useState(false);
  const [newCombo, setNewCombo] = useState<Partial<ComboSet>>({ CombineDetails: [{ SrcSkuId: "", SrcSkuQtyExpend: 1 }] });

  const [toast, setToast] = useState("");

  /* ── Fetch ─────────────────────────────────────────────────────────── */
  const fetchSuppliers = useCallback(async () => {
    setLoadingSup(true);
    try {
      const r = await fetch("/api/suppliers");
      const d = await r.json();
      setSuppliers(d.suppliers ?? d.data ?? []);
    } catch { /* ignore */ }
    setLoadingSup(false);
  }, []);

  const fetchCombos = useCallback(async () => {
    setLoadingCombo(true);
    try {
      const r = await fetch("/api/products/combo");
      const d = await r.json();
      setCombos(d.combos ?? d.data ?? []);
    } catch { /* ignore */ }
    setLoadingCombo(false);
  }, []);

  useEffect(() => { fetchSuppliers(); fetchCombos(); }, [fetchSuppliers, fetchCombos]);

  /* ── Handlers ──────────────────────────────────────────────────────── */
  async function addSupplier() {
    if (!newSup.supplier_code && !newSup.supplier_name) {
      setToast("Supplier code or name required"); return;
    }
    const body = {
      SupplierCode: newSup.supplier_code || "",
      SupplierName: newSup.supplier_name || "",
      ContactName: newSup.contact_name || "",
      ContactPhone: newSup.contact_phone || "",
      Address: newSup.address || "",
    };
    const r = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { setToast("Supplier created"); setShowAddSup(false); setNewSup({}); fetchSuppliers(); }
    else { const d = await r.json(); setToast(d.error || "Error"); }
  }

  async function addCombo() {
    const c = newCombo as ComboSet;
    if (!c.ItemId || !c.CombineId || !c.Name) { setToast("ItemId, CombineId, and Name required"); return; }
    const r = await fetch("/api/products/combo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ combos: [c] }) });
    if (r.ok) { setToast("Combo created"); setShowAddCombo(false); setNewCombo({ CombineDetails: [{ SrcSkuId: "", SrcSkuQtyExpend: 1 }] }); fetchCombos(); }
    else { const d = await r.json(); setToast(d.error || "Error"); }
  }

  function updateComboDetail(idx: number, field: string, val: string | number) {
    const details = [...(newCombo.CombineDetails ?? [])];
    (details[idx] as any)[field] = val;
    setNewCombo({ ...newCombo, CombineDetails: details });
  }
  function addComboRow() {
    setNewCombo({ ...newCombo, CombineDetails: [...(newCombo.CombineDetails ?? []), { SrcSkuId: "", SrcSkuQtyExpend: 1 }] });
  }
  function removeComboRow(idx: number) {
    const details = [...(newCombo.CombineDetails ?? [])];
    details.splice(idx, 1);
    setNewCombo({ ...newCombo, CombineDetails: details });
  }

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="page">
      <h1>Suppliers & Combo Sets</h1>
      <p className="subtitle">Manage suppliers and product combo/bundle sets</p>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, background: "var(--app-accent)", color: "#fff", padding: "10px 20px", borderRadius: 8, zIndex: 9999, animation: "fadeIn 0.2s" }}
          onClick={() => setToast("")}>{toast}</div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--border-2)" }}>
        {(["suppliers", "combos"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "10px 24px", border: "none", background: "transparent", cursor: "pointer",
            fontWeight: tab === t ? 700 : 400, color: tab === t ? "var(--app-accent)" : "var(--text-muted)",
            borderBottom: tab === t ? "2px solid var(--app-accent)" : "2px solid transparent",
            marginBottom: -2, fontSize: "0.95rem",
          }}>
            {t === "suppliers" ? "Suppliers" : "Combo Sets"}
          </button>
        ))}
      </div>

      {/* ═══ SUPPLIERS TAB ═══ */}
      {tab === "suppliers" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Suppliers ({suppliers.length})</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ghost" onClick={fetchSuppliers} style={{ fontSize: "0.85rem" }}>Sync from JST</button>
              <button className="primary" onClick={() => setShowAddSup(true)} style={{ fontSize: "0.85rem" }}>+ Add Supplier</button>
            </div>
          </div>

          {loadingSup ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>Loading...</p>
          ) : suppliers.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>No suppliers found. Click &quot;Sync from JST&quot; to load.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="results-table" style={{ width: "100%", fontSize: "0.88rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 12px" }}>Code</th>
                    <th style={{ textAlign: "left", padding: "8px 12px" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "8px 12px" }}>Contact</th>
                    <th style={{ textAlign: "left", padding: "8px 12px" }}>Phone</th>
                    <th style={{ textAlign: "left", padding: "8px 12px" }}>Address</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-2)" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{s.supplier_code}</td>
                      <td style={{ padding: "8px 12px" }}>{s.supplier_name}</td>
                      <td style={{ padding: "8px 12px" }}>{s.contact_name || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>{s.contact_phone || "—"}</td>
                      <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{s.address || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add Supplier Modal */}
          {showAddSup && (
            <div className="modal" onClick={() => setShowAddSup(false)}>
              <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, margin: "80px auto", padding: 28 }}>
                <h3>Add Supplier</h3>
                {[
                  { key: "supplier_code", label: "Supplier Code *" },
                  { key: "supplier_name", label: "Supplier Name *" },
                  { key: "contact_name", label: "Contact Name" },
                  { key: "contact_phone", label: "Phone" },
                  { key: "address", label: "Address" },
                ].map(({ key, label }) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: "0.82rem", color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{label}</label>
                    <input
                      value={(newSup as any)[key] || ""}
                      onChange={(e) => setNewSup({ ...newSup, [key]: e.target.value })}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border-2)", borderRadius: 8, fontSize: "0.9rem" }}
                    />
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                  <button className="ghost" onClick={() => setShowAddSup(false)}>Cancel</button>
                  <button className="primary" onClick={addSupplier}>Create</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ COMBOS TAB ═══ */}
      {tab === "combos" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Combo Sets ({combos.length})</h3>
            <button className="primary" onClick={() => setShowAddCombo(true)} style={{ fontSize: "0.85rem" }}>+ Create Combo</button>
          </div>

          {loadingCombo ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>Loading...</p>
          ) : combos.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>No combo sets found.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="results-table" style={{ width: "100%", fontSize: "0.88rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 12px" }}>Combo ID</th>
                    <th style={{ textAlign: "left", padding: "8px 12px" }}>Name</th>
                    <th style={{ textAlign: "right", padding: "8px 12px" }}>Cost</th>
                    <th style={{ textAlign: "right", padding: "8px 12px" }}>Price</th>
                    <th style={{ textAlign: "left", padding: "8px 12px" }}>Components</th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-2)" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{c.CombineId}</td>
                      <td style={{ padding: "8px 12px" }}>{c.Name}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>{c.CostPrice?.toLocaleString("th-TH") ?? "—"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>{c.SalePrice?.toLocaleString("th-TH") ?? "—"}</td>
                      <td style={{ padding: "8px 12px", fontSize: "0.82rem" }}>
                        {(c.CombineDetails ?? []).map((d) => `${d.SrcSkuId} x${d.SrcSkuQtyExpend}`).join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add Combo Modal */}
          {showAddCombo && (
            <div className="modal" onClick={() => setShowAddCombo(false)}>
              <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, margin: "60px auto", padding: 28, maxHeight: "80vh", overflowY: "auto" }}>
                <h3>Create Combo Set</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Item ID *</label>
                    <input value={newCombo.ItemId ?? ""} onChange={(e) => setNewCombo({ ...newCombo, ItemId: e.target.value })}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border-2)", borderRadius: 8 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Combo ID *</label>
                    <input value={newCombo.CombineId ?? ""} onChange={(e) => setNewCombo({ ...newCombo, CombineId: e.target.value })}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border-2)", borderRadius: 8 }} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Name *</label>
                    <input value={newCombo.Name ?? ""} onChange={(e) => setNewCombo({ ...newCombo, Name: e.target.value })}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border-2)", borderRadius: 8 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Cost Price</label>
                    <input type="number" value={newCombo.CostPrice ?? ""} onChange={(e) => setNewCombo({ ...newCombo, CostPrice: Number(e.target.value) })}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border-2)", borderRadius: 8 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Sale Price</label>
                    <input type="number" value={newCombo.SalePrice ?? ""} onChange={(e) => setNewCombo({ ...newCombo, SalePrice: Number(e.target.value) })}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border-2)", borderRadius: 8 }} />
                  </div>
                </div>

                <h4 style={{ marginBottom: 8 }}>Components</h4>
                {(newCombo.CombineDetails ?? []).map((d, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <input placeholder="SKU ID" value={d.SrcSkuId} onChange={(e) => updateComboDetail(idx, "SrcSkuId", e.target.value)}
                      style={{ flex: 1, padding: "8px 12px", border: "1px solid var(--border-2)", borderRadius: 8, fontSize: "0.88rem" }} />
                    <input type="number" value={d.SrcSkuQtyExpend} onChange={(e) => updateComboDetail(idx, "SrcSkuQtyExpend", Number(e.target.value))}
                      style={{ width: 70, padding: "8px 12px", border: "1px solid var(--border-2)", borderRadius: 8, textAlign: "center" }} min={1} />
                    <button className="ghost" onClick={() => removeComboRow(idx)} style={{ padding: "6px 10px", color: "var(--error)" }}>x</button>
                  </div>
                ))}
                <button className="ghost" onClick={addComboRow} style={{ fontSize: "0.82rem", marginBottom: 16 }}>+ Add Component</button>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="ghost" onClick={() => setShowAddCombo(false)}>Cancel</button>
                  <button className="primary" onClick={addCombo}>Create Combo</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
