"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type PlatformFee = {
  platform: string;
  commission_pct: number;
  service_fee_pct: number;
  payment_fee_pct: number;
  shipping_subsidy_pct: number;
  other_fee_pct: number;
  notes: string;
};

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PlatformFeesPage() {
  const router = useRouter();

  const [fees, setFees] = useState<PlatformFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);

  const fetchFees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/platform-fees");
      const json = await res.json();
      if (json.error) {
        if (res.status === 401) { router.push("/login"); return; }
        setError(json.error);
      } else {
        setFees(json.fees ?? json ?? []);
      }
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchFees(); }, [fetchFees]);

  const saveFees = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/settings/platform-fees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fees }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setSuccess("Platform fees saved successfully.");
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  };

  const updateFee = (index: number, col: string, value: string) => {
    setFees((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      if (col === "notes") {
        row.notes = value;
      } else {
        (row as any)[col] = parseFloat(value) || 0;
      }
      next[index] = row;
      return next;
    });
  };

  const pctCols: { key: string; label: string }[] = [
    { key: "commission_pct", label: "Commission %" },
    { key: "service_fee_pct", label: "Service Fee %" },
    { key: "payment_fee_pct", label: "Payment Fee %" },
    { key: "shipping_subsidy_pct", label: "Shipping Subsidy %" },
    { key: "other_fee_pct", label: "Other Fee %" },
  ];

  return (
    <div>
      {/* ── Topbar ── */}
      <div className="topbar">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="brand">
            <img src="/fav-logo-2026.png" alt="logo" className="logo" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <div>
              <div className="brand-title">Platform Fee Settings</div>
              <div className="brand-sub">Configure fee rates for P&L calculations</div>
            </div>
          </div>
          <button className="ghost" onClick={() => router.push("/dashboard")} style={{ fontSize: "0.88rem" }}>
            ← Dashboard
          </button>
        </div>
      </div>

      <div className="page">
        {/* ── Info Panel ── */}
        <div className="card" style={{ marginBottom: 16, background: "rgba(0,180,216,0.04)", borderColor: "rgba(0,180,216,0.15)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: "0.95rem" }}>
            About Platform Fees
          </div>
          <p className="subtitle" style={{ marginBottom: 8 }}>
            These rates are used to estimate platform fees in the P&L report. Shopee actual fees are synced automatically via API when available.
          </p>
          <p className="subtitle" style={{ marginBottom: 0, fontSize: "0.85rem" }}>
            Typical rates: Shopee commission 3-6%, Service fee 2%, Payment fee 2%. Lazada commission 3-5%. TikTok Shop commission 1-4%.
          </p>
        </div>

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

        {/* ── Loading ── */}
        {loading && (
          <div style={{ color: "var(--muted)", textAlign: "center", padding: "60px 0" }}>
            Loading fee configuration...
          </div>
        )}

        {/* ── Table ── */}
        {!loading && (
          <div className="card">
            <div style={{ overflowX: "auto" }}>
              <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th>Platform Name</th>
                    {pctCols.map(({ key, label }) => (
                      <th key={key} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{label}</th>
                    ))}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                        No platform fees configured.
                      </td>
                    </tr>
                  ) : (
                    fees.map((row, i) => (
                      <tr key={row.platform}>
                        <td style={{ fontWeight: 600 }}>{row.platform}</td>
                        {pctCols.map(({ key }) => {
                          const isEditing = editingCell?.row === i && editingCell?.col === key;
                          const val = (row as any)[key] as number;
                          return (
                            <td key={key} style={{ textAlign: "right", padding: isEditing ? "4px 6px" : undefined }}
                              onClick={() => setEditingCell({ row: i, col: key })}>
                              {isEditing ? (
                                <input
                                  type="number"
                                  step="0.1"
                                  autoFocus
                                  defaultValue={val}
                                  onBlur={(e) => {
                                    updateFee(i, key, e.target.value);
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      updateFee(i, key, (e.target as HTMLInputElement).value);
                                      setEditingCell(null);
                                    }
                                    if (e.key === "Escape") setEditingCell(null);
                                  }}
                                  style={{
                                    width: 70, textAlign: "right", padding: "4px 8px",
                                    borderRadius: 6, border: "1px solid var(--cyan)",
                                    background: "rgba(0,180,216,0.06)", fontSize: "0.88rem",
                                  }}
                                />
                              ) : (
                                <span style={{ cursor: "pointer", padding: "2px 6px", borderRadius: 4,
                                  transition: "background 0.15s" }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                                  {val.toFixed(1)}%
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td>
                          {editingCell?.row === i && editingCell?.col === "notes" ? (
                            <input
                              type="text"
                              autoFocus
                              defaultValue={row.notes}
                              onBlur={(e) => {
                                updateFee(i, "notes", e.target.value);
                                setEditingCell(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  updateFee(i, "notes", (e.target as HTMLInputElement).value);
                                  setEditingCell(null);
                                }
                                if (e.key === "Escape") setEditingCell(null);
                              }}
                              style={{
                                width: "100%", padding: "4px 8px", borderRadius: 6,
                                border: "1px solid var(--cyan)", background: "rgba(0,180,216,0.06)",
                                fontSize: "0.88rem",
                              }}
                            />
                          ) : (
                            <span style={{ cursor: "pointer", color: row.notes ? "var(--text)" : "var(--muted)", fontSize: "0.88rem" }}
                              onClick={() => setEditingCell({ row: i, col: "notes" })}>
                              {row.notes || "Click to add note"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Save Button ── */}
            {fees.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <button className="primary" onClick={saveFees} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
