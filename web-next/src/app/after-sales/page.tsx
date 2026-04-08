"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type AfterSaleRequest = {
  id: number;
  platform_order_id: string;
  customer_name: string;
  phone: string;
  email: string;
  brand: string;
  after_sale_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  remark: string;
  internal_notes: string;
  items: AfterSaleItem[];
  photo_urls: string[];
  status_history: StatusChange[];
};

type AfterSaleItem = {
  sku: string;
  qty: number;
  reason: string;
};

type StatusChange = {
  status: string;
  changed_at: string;
  changed_by: string;
  note: string;
};

type SummaryData = {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_STATUSES = [
  "all", "submitted", "reviewing", "approved", "rejected",
  "processing", "shipped", "completed", "cancelled",
];

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

const AFTER_SALE_TYPES = ["GeneralReturn", "Exchange", "Refund"];

const TIMELINE_STEPS = ["submitted", "reviewing", "approved", "processing", "shipped", "completed"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#7080a0";
  const bg = STATUS_BG[status] ?? "rgba(112,128,160,0.08)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "2px 10px",
      borderRadius: 999, fontSize: "0.76rem", fontWeight: 700,
      color, background: bg, border: `1px solid ${color}22`,
      textTransform: "capitalize",
    }}>
      {status}
    </span>
  );
}

// ─── Detail Modal ────────────────────────────────────────────────────────────

function DetailModal({
  request,
  onClose,
  onAction,
}: {
  request: AfterSaleRequest;
  onClose: () => void;
  onAction: (id: number, action: string, notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(request.internal_notes ?? "");
  const [saving, setSaving] = useState(false);

  const handleAction = async (action: string) => {
    setSaving(true);
    await onAction(request.id, action, notes);
    setSaving(false);
  };

  const canApproveReject = ["submitted", "reviewing"].includes(request.status);
  const canProcess = request.status === "approved";
  const canShip = request.status === "processing";
  const canComplete = request.status === "shipped";

  // Build timeline from status history
  const historyMap: Record<string, StatusChange> = {};
  (request.status_history ?? []).forEach((h) => {
    historyMap[h.status] = h;
  });

  const currentIdx = TIMELINE_STEPS.indexOf(request.status);

  return (
    <div className="modal modal-center" onClick={onClose}>
      <div className="modal-backdrop" />
      <div className="modal-content" style={{ maxWidth: 780, maxHeight: "90vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="modal-title">Request #{request.id}</span>
            <StatusBadge status={request.status} />
          </div>
          <button className="ghost" onClick={onClose} style={{ padding: "6px 12px" }}>Close</button>
        </div>

        <div className="modal-body" style={{ maxHeight: "none" }}>
          {/* Order Info */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              Order Information
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
              <div><span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Order ID:</span> <strong>{request.platform_order_id}</strong></div>
              <div><span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Customer:</span> <strong>{request.customer_name}</strong></div>
              <div><span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Phone:</span> {request.phone || "–"}</div>
              <div><span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Email:</span> {request.email || "–"}</div>
              <div><span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Type:</span> {request.after_sale_type}</div>
              <div><span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Brand:</span> {request.brand}</div>
            </div>
          </div>

          {/* Items */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              Items
            </div>
            {(request.items ?? []).length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No items</div>
            ) : (
              <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th style={{ textAlign: "center" }}>Qty</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {request.items.map((item, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{item.sku}</td>
                      <td style={{ textAlign: "center" }}>{item.qty}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Photo Evidence */}
          {(request.photo_urls ?? []).length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Photo Evidence
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {request.photo_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt={`Evidence ${i + 1}`} style={{
                      width: 100, height: 100, objectFit: "cover", borderRadius: 10,
                      border: "1px solid var(--border-2)", cursor: "pointer",
                    }} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Status Timeline */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
              Status Timeline
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 0, overflowX: "auto", paddingBottom: 8 }}>
              {TIMELINE_STEPS.map((step, i) => {
                const entry = historyMap[step];
                const stepIdx = TIMELINE_STEPS.indexOf(step);
                const isCompleted = stepIdx <= currentIdx && currentIdx >= 0;
                const isCurrent = step === request.status;
                const color = isCompleted ? (STATUS_COLORS[step] ?? "var(--ok)") : "var(--border-2)";

                return (
                  <div key={step} style={{ display: "flex", alignItems: "flex-start", flex: 1, minWidth: 90 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: isCompleted ? color : "var(--surface-2)",
                        border: `2px solid ${color}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.7rem", color: isCompleted ? "#fff" : "var(--text-muted)",
                        fontWeight: 700, flexShrink: 0,
                        boxShadow: isCurrent ? `0 0 0 4px ${color}33` : "none",
                      }}>
                        {isCompleted ? "\u2713" : i + 1}
                      </div>
                      <div style={{
                        marginTop: 6, fontSize: "0.75rem", fontWeight: 600,
                        textTransform: "capitalize", textAlign: "center",
                        color: isCompleted ? "var(--text)" : "var(--text-muted)",
                      }}>
                        {step}
                      </div>
                      {entry && (
                        <div style={{ marginTop: 2, fontSize: "0.68rem", color: "var(--text-muted)", textAlign: "center" }}>
                          {fmtDateTime(entry.changed_at)}
                        </div>
                      )}
                    </div>
                    {i < TIMELINE_STEPS.length - 1 && (
                      <div style={{
                        flex: "0 0 auto", width: 24, height: 2, marginTop: 13,
                        background: stepIdx < currentIdx ? color : "var(--border-2)",
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              Actions & Notes
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes..."
              rows={3}
              style={{ width: "100%", marginBottom: 12, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canApproveReject && (
                <>
                  <button className="primary" disabled={saving} onClick={() => handleAction("approve")}>
                    Approve
                  </button>
                  <button className="danger" disabled={saving} onClick={() => handleAction("reject")}>
                    Reject
                  </button>
                </>
              )}
              {canProcess && (
                <button className="primary" disabled={saving} onClick={() => handleAction("processing")}>
                  Mark Processing
                </button>
              )}
              {canShip && (
                <button className="primary" disabled={saving} onClick={() => handleAction("shipped")}>
                  Mark Shipped
                </button>
              )}
              {canComplete && (
                <button className="primary" disabled={saving} onClick={() => handleAction("completed")}>
                  Mark Completed
                </button>
              )}
              <button className="ghost" disabled={saving} onClick={() => handleAction("save_notes")}>
                Save Notes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create New Modal ────────────────────────────────────────────────────────

function CreateModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState("");
  const [shopId, setShopId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [saleType, setSaleType] = useState("GeneralReturn");
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState<AfterSaleItem[]>([{ sku: "", qty: 1, reason: "" }]);
  const [saving, setSaving] = useState(false);

  const updateItem = (idx: number, field: keyof AfterSaleItem, value: any) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const addItem = () => setItems((prev) => [...prev, { sku: "", qty: 1, reason: "" }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    setSaving(true);
    await onSubmit({
      warehouse_id: warehouseId,
      shop_id: shopId,
      platform_order_id: orderId,
      after_sale_type: saleType,
      items: items.filter((i) => i.sku.trim()),
      remark,
    });
    setSaving(false);
  };

  return (
    <div className="modal modal-center" onClick={onClose}>
      <div className="modal-backdrop" />
      <div className="modal-content" style={{ maxWidth: 640, maxHeight: "90vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Create After-Sale Request</span>
          <button className="ghost" onClick={onClose} style={{ padding: "6px 12px" }}>Close</button>
        </div>

        <div className="modal-body" style={{ maxHeight: "none" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Warehouse ID</label>
              <input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="e.g. WH001" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Shop ID</label>
              <input value={shopId} onChange={(e) => setShopId(e.target.value)} placeholder="e.g. SHOP01" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Platform Order ID</label>
              <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Order ID" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Type</label>
              <select value={saleType} onChange={(e) => setSaleType(e.target.value)} style={{ width: "100%" }}>
                {AFTER_SALE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Items */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)" }}>Items</label>
              <button className="ghost" onClick={addItem} style={{ padding: "4px 12px", fontSize: "0.82rem" }}>+ Add Item</button>
            </div>
            {items.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <input value={item.sku} onChange={(e) => updateItem(i, "sku", e.target.value)} placeholder="SKU" style={{ flex: 2 }} />
                <input type="number" value={item.qty} onChange={(e) => updateItem(i, "qty", parseInt(e.target.value) || 1)} min={1} style={{ width: 70 }} />
                <input value={item.reason} onChange={(e) => updateItem(i, "reason", e.target.value)} placeholder="Reason" style={{ flex: 2 }} />
                {items.length > 1 && (
                  <button className="danger" onClick={() => removeItem(i)} style={{ padding: "6px 10px", fontSize: "0.82rem" }}>X</button>
                )}
              </div>
            ))}
          </div>

          {/* Remark */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Remark</label>
            <textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Additional notes..." rows={3} style={{ width: "100%", resize: "vertical" }} />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="ghost" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={saving || !orderId.trim()} onClick={handleSubmit}>
              {saving ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AfterSalesPage() {
  const [requests, setRequests] = useState<AfterSaleRequest[]>([]);
  const [summary, setSummary] = useState<SummaryData>({ total: 0, pending: 0, in_progress: 0, completed: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const perPage = 20;

  // Modals
  const [selectedRequest, setSelectedRequest] = useState<AfterSaleRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/after-sales?${params}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setRequests(json.data ?? []);
        setTotalPages(json.total_pages ?? 1);
        setSummary(json.summary ?? { total: 0, pending: 0, in_progress: 0, completed: 0 });
      }
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAction = async (id: number, action: string, notes: string) => {
    try {
      const res = await fetch(`/api/after-sales/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, internal_notes: notes }),
      });
      const json = await res.json();
      if (json.error) {
        alert(json.error);
      } else {
        setSelectedRequest(null);
        fetchData();
      }
    } catch (e: any) {
      alert(e.message ?? "Failed to perform action");
    }
  };

  const handleCreate = async (data: any) => {
    try {
      const res = await fetch("/api/after-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.error) {
        alert(json.error);
      } else {
        setShowCreate(false);
        fetchData();
      }
    } catch (e: any) {
      alert(e.message ?? "Failed to create request");
    }
  };

  const summaryCards = [
    { label: "Total Requests", value: summary.total, color: "var(--cyan)", icon: "📋" },
    { label: "Pending Review", value: summary.pending, color: "#d97706", icon: "⏳" },
    { label: "In Progress", value: summary.in_progress, color: "#3b82f6", icon: "🔄" },
    { label: "Completed", value: summary.completed, color: "var(--ok)", icon: "✅" },
  ];

  return (
    <div className="page">
      {/* Title */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: "1.4rem" }}>After-Sales Management</h2>
          <p className="subtitle">Manage returns, exchanges, and refund requests</p>
        </div>
        <button className="primary" onClick={() => setShowCreate(true)}>+ Create New</button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
        {summaryCards.map(({ label, value, color, icon }) => (
          <div key={label} className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: "1.3rem", marginBottom: 4 }}>{icon}</div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              {label}
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color, letterSpacing: "-0.02em" }}>
              {value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</div>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ minWidth: 140 }}>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{s === "all" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>From</div>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>To</div>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Search</div>
            <input
              type="text"
              placeholder="Order ID or customer name..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)",
          borderRadius: 12, padding: "12px 16px", color: "var(--error)", marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
          Loading requests...
        </div>
      )}

      {/* Table */}
      {!loading && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="results-table" style={{ width: "100%", tableLayout: "auto" }}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>ID</th>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Brand</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th style={{ width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                      No after-sale requests found
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => (
                    <tr key={req.id} style={{ cursor: "pointer" }} onClick={() => setSelectedRequest(req)}>
                      <td style={{ fontWeight: 600 }}>#{req.id}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{req.platform_order_id}</td>
                      <td>{req.customer_name}</td>
                      <td>{req.brand}</td>
                      <td style={{ fontSize: "0.85rem" }}>{req.after_sale_type}</td>
                      <td><StatusBadge status={req.status} /></td>
                      <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{fmtDate(req.created_at)}</td>
                      <td>
                        <button className="ghost" style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                          onClick={(e) => { e.stopPropagation(); setSelectedRequest(req); }}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: "flex", justifyContent: "center", alignItems: "center",
              gap: 10, padding: "14px 16px", borderTop: "1px solid var(--border)",
            }}>
              <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                style={{ padding: "6px 14px", fontSize: "0.85rem" }}>
                Previous
              </button>
              <span style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
                Page {page} of {totalPages}
              </span>
              <button className="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                style={{ padding: "6px 14px", fontSize: "0.85rem" }}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedRequest && (
        <DetailModal
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onAction={handleAction}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}
