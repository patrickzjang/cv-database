"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

type ReturnItem = {
  sku: string;
  qty: number;
  reason: string;
};

type StatusEntry = {
  status: string;
  changed_at: string;
};

type ReturnData = {
  tracking_code: string;
  status: string;
  created_at: string;
  items: ReturnItem[];
  status_history: StatusEntry[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

const TIMELINE_STEPS = ["submitted", "reviewing", "approved", "processing", "shipped", "completed"];

const STATUS_COLORS: Record<string, string> = {
  submitted: "#7080a0",
  reviewing: "#3b82f6",
  approved: "#059669",
  rejected: "#dc2626",
  processing: "#d97706",
  shipped: "#7c3aed",
  completed: "#059669",
  cancelled: "#9ca3af",
};

const STATUS_BG: Record<string, string> = {
  submitted: "rgba(112,128,160,0.08)",
  reviewing: "rgba(59,130,246,0.08)",
  approved: "rgba(5,150,105,0.08)",
  rejected: "rgba(220,38,38,0.08)",
  processing: "rgba(217,119,6,0.08)",
  shipped: "rgba(124,58,237,0.08)",
  completed: "rgba(5,150,105,0.08)",
  cancelled: "rgba(156,163,175,0.08)",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(iso: string): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ReturnTrackingPage() {
  const params = useParams();
  const code = params.code as string;

  const [data, setData] = useState<ReturnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/returns/${code}`);
        const json = await res.json();
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
        }
      } catch (e: any) {
        setError(e.message ?? "Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  if (loading) {
    return (
      <div style={{ maxWidth: 640, margin: "48px auto", padding: "0 20px", textAlign: "center" }}>
        <div style={{ color: "var(--muted)", padding: "60px 0" }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 640, margin: "48px auto", padding: "0 20px" }}>
        <div className="card" style={{ textAlign: "center", padding: "40px 28px" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>&#9888;</div>
          <h2 style={{ color: "var(--error)", marginBottom: 8, fontSize: "1.2rem" }}>Request Not Found</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: 20 }}>{error}</p>
          <Link href="/returns" style={{ color: "var(--cyan)", fontWeight: 600, textDecoration: "none" }}>
            &larr; Back to Returns
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const statusColor = STATUS_COLORS[data.status] ?? "#7080a0";
  const statusBg = STATUS_BG[data.status] ?? "rgba(112,128,160,0.08)";

  // Build history map
  const historyMap: Record<string, StatusEntry> = {};
  (data.status_history ?? []).forEach((h) => {
    historyMap[h.status] = h;
  });

  const currentIdx = TIMELINE_STEPS.indexOf(data.status);
  const isRejected = data.status === "rejected";
  const isCancelled = data.status === "cancelled";

  return (
    <div style={{ maxWidth: 640, margin: "32px auto", padding: "0 20px 40px" }}>
      {/* Back link */}
      <Link href="/returns" style={{
        color: "var(--muted)", textDecoration: "none", fontSize: "0.88rem",
        fontWeight: 600, display: "inline-block", marginBottom: 20,
      }}>
        &larr; Back to Returns
      </Link>

      {/* Tracking Code Header */}
      <div className="card" style={{ textAlign: "center", padding: "28px 24px", marginBottom: 16 }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          Tracking Code
        </div>
        <div style={{ fontSize: "1.8rem", fontWeight: 700, letterSpacing: "0.04em", color: "var(--cyan)", marginBottom: 14 }}>
          {data.tracking_code}
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", padding: "4px 16px",
          borderRadius: 999, fontSize: "0.88rem", fontWeight: 700,
          color: statusColor, background: statusBg,
          border: `1px solid ${statusColor}22`, textTransform: "capitalize",
        }}>
          {data.status}
        </span>
      </div>

      {/* Status Timeline */}
      {!isRejected && !isCancelled && (
        <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 18 }}>
            Progress
          </div>
          <div style={{ position: "relative" }}>
            {/* Connecting line */}
            <div style={{
              position: "absolute", left: 15, top: 14, bottom: 14,
              width: 2, background: "var(--border-2)",
            }} />

            {TIMELINE_STEPS.map((step, i) => {
              const entry = historyMap[step];
              const stepIdx = TIMELINE_STEPS.indexOf(step);
              const isDone = stepIdx <= currentIdx;
              const isCurrent = step === data.status;
              const color = isDone ? (STATUS_COLORS[step] ?? "var(--ok)") : "var(--border-2)";

              return (
                <div key={step} style={{
                  display: "flex", alignItems: "flex-start", gap: 16,
                  marginBottom: i < TIMELINE_STEPS.length - 1 ? 20 : 0,
                  position: "relative",
                }}>
                  {/* Dot */}
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                    background: isDone ? color : "var(--surface)",
                    border: `2px solid ${color}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.72rem", fontWeight: 700,
                    color: isDone ? "#fff" : "var(--muted)",
                    boxShadow: isCurrent ? `0 0 0 4px ${color}33` : "none",
                    zIndex: 1,
                  }}>
                    {isDone ? "\u2713" : i + 1}
                  </div>

                  {/* Label + date */}
                  <div style={{ paddingTop: 4 }}>
                    <div style={{
                      fontWeight: 600, fontSize: "0.92rem", textTransform: "capitalize",
                      color: isDone ? "var(--text)" : "var(--muted)",
                    }}>
                      {step}
                    </div>
                    {entry && (
                      <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>
                        {fmtDateTime(entry.changed_at)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rejected / Cancelled notice */}
      {(isRejected || isCancelled) && (
        <div className="card" style={{
          padding: "20px 24px", marginBottom: 16,
          border: `1px solid ${statusColor}33`,
          background: statusBg,
        }}>
          <div style={{ fontWeight: 700, color: statusColor, marginBottom: 4, textTransform: "capitalize" }}>
            {data.status}
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
            This return request has been {data.status}. Please contact support if you have questions.
          </div>
        </div>
      )}

      {/* Items */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
          Items Being Returned
        </div>
        {(data.items ?? []).length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No items</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {data.items.map((item, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", borderRadius: 10,
                background: "var(--surface-2)", border: "1px solid var(--border)",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontFamily: "monospace", fontSize: "0.9rem" }}>{item.sku}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>{item.reason}</div>
                </div>
                <div style={{
                  background: "var(--surface)", borderRadius: 8, padding: "4px 12px",
                  border: "1px solid var(--border)", fontWeight: 700, fontSize: "0.88rem",
                }}>
                  x{item.qty}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Created date */}
      <div style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
        Submitted on {fmtDate(data.created_at)}
      </div>
    </div>
  );
}
