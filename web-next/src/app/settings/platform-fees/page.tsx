"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type PlatformFee = {
  platform_name: string;
  commission_rate: number;
  service_fee_rate: number;
  payment_fee_rate: number;
  shipping_subsidy_rate: number;
  other_fee_rate: number;
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
  const [applyProgress, setApplyProgress] = useState<{ active: boolean; pct: number; label: string }>({ active: false, pct: 0, label: "" });

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
        setFees(json.data ?? json.fees ?? []);
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
        setSuccess("Platform fees saved! Margin recalculation started in background.");

        // Show progress bar
        setApplyProgress({ active: true, pct: 10, label: "Recalculating margins..." });

        // Fire-and-forget: recalculate margins in background
        // This continues even if user navigates away
        fetch("/api/products/pricing/apply-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          keepalive: true, // keeps request alive even if page unloads
        }).then(async (r) => {
          try {
            const d = await r.json();
            setApplyProgress({ active: true, pct: 100, label: `Done! ${d.updated?.toLocaleString() ?? ""} SKUs updated` });
            setSuccess(`Margins updated for ${d.updated?.toLocaleString() ?? "all"} SKUs.`);
            setTimeout(() => {
              setApplyProgress({ active: false, pct: 0, label: "" });
              setSuccess(null);
            }, 4000);
          } catch {
            setApplyProgress({ active: false, pct: 0, label: "" });
          }
        }).catch(() => {
          setApplyProgress({ active: false, pct: 0, label: "" });
        });

        // Animate progress bar while waiting
        let pct = 10;
        const timer = setInterval(() => {
          pct = Math.min(pct + Math.random() * 8 + 2, 90);
          setApplyProgress(prev => prev.active && prev.pct < 100
            ? { active: true, pct: Math.round(pct), label: "Recalculating margins..." }
            : prev
          );
        }, 800);
        // Cleanup timer after 5 minutes max
        setTimeout(() => clearInterval(timer), 300000);

        setTimeout(() => setSuccess(null), 8000);
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
        // Input is in % (e.g. "6.5"), convert back to decimal (0.065)
        (row as any)[col] = (parseFloat(value) || 0) / 100;
      }
      next[index] = row;
      return next;
    });
  };

  const pctCols: { key: string; label: string }[] = [
    { key: "commission_rate", label: "Commission %" },
    { key: "service_fee_rate", label: "Service Fee %" },
    { key: "payment_fee_rate", label: "Payment Fee %" },
    { key: "shipping_subsidy_rate", label: "Shipping Subsidy %" },
    { key: "other_fee_rate", label: "Other Fee %" },
  ];

  return (
    <div>
      <div className="page">
        {/* ── Progress Bar ── */}
        {applyProgress.active && (
          <div className="card" style={{ marginBottom: 16, padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: "0.88rem" }}>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>{applyProgress.label}</span>
              <span style={{ fontWeight: 700, color: "var(--app-accent)" }}>{applyProgress.pct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 999,
                background: "linear-gradient(90deg, var(--app-accent), #3b82f6)",
                width: `${applyProgress.pct}%`,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        )}

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
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "60px 0" }}>
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
                    <th style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 800 }}>Total Fee %</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>
                        No platform fees configured.
                      </td>
                    </tr>
                  ) : (
                    fees.map((row, i) => (
                      <tr key={row.platform_name}>
                        <td style={{ fontWeight: 600 }}>{row.platform_name}</td>
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
                                  defaultValue={val != null ? (val * 100).toFixed(1) : 0}
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
                                  {val != null ? `${(val * 100).toFixed(1)}%` : "–"}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ textAlign: "right", fontWeight: 700, fontSize: "0.9rem", color: "var(--app-accent)" }}>
                          {(() => {
                            const total = (Number(row.commission_rate) || 0) + (Number(row.service_fee_rate) || 0) +
                              (Number(row.payment_fee_rate) || 0) + (Number(row.shipping_subsidy_rate) || 0) + (Number(row.other_fee_rate) || 0);
                            return `${(total * 100).toFixed(1)}%`;
                          })()}
                        </td>
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
                            <span style={{ cursor: "pointer", color: row.notes ? "var(--text)" : "var(--text-muted)", fontSize: "0.88rem" }}
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
