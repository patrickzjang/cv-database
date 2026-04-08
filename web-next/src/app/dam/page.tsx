"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DamAsset, AssetStatus } from "@/lib/dam-db";
import { streamEmbedUrl, streamThumbnailUrl } from "@/lib/cloudflare-stream";

const BRANDS  = ["", "PAN", "ARENA", "DAYBREAK", "HEELCARE"] as const;
const TYPES   = ["", "image", "video"] as const;
const STATUSES: Array<{ value: AssetStatus | ""; label: string }> = [
  { value: "",         label: "All status" },
  { value: "pending",  label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "ready",    label: "Ready" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
];

const STATUS_COLOR: Record<string, string> = {
  pending:    "#9db0d0",
  processing: "#f0a500",
  ready:      "#5be49b",
  approved:   "#3d5afe",
  archived:   "#555e80",
};

function fmt(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function thumbnailUrl(asset: DamAsset): string | null {
  if (asset.asset_type === "video" && asset.stream_uid) {
    return asset.stream_thumbnail_url ?? streamThumbnailUrl(asset.stream_uid);
  }
  if (asset.thumbnail_path) return asset.thumbnail_path;
  return null;
}

export default function DAMBrowserPage() {
  const router = useRouter();

  // Filters
  const [brand,  setBrand]  = useState("");
  const [type,   setType]   = useState("");
  const [status, setStatus] = useState("");
  const [q,      setQ]      = useState("");
  const [page,   setPage]   = useState(1);

  // Data
  const [assets, setAssets] = useState<DamAsset[]>([]);
  const [total,  setTotal]  = useState(0);
  const [loading, setLoading] = useState(false);

  // Detail modal
  const [selected,  setSelected]  = useState<DamAsset | null>(null);
  const [events,    setEvents]    = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actioning, setActioning] = useState(false);

  // Product info for selected asset
  const [productInfo, setProductInfo] = useState<any | null>(null);
  const [productLoading, setProductLoading] = useState(false);

  // Product link cache for grid badges: sku -> boolean (has product)
  const [productLinks, setProductLinks] = useState<Record<string, boolean | undefined>>({});

  const PAGE_SIZE = 48;

  // Auth guard
  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!d?.authenticated) router.replace("/login"); });
  }, [router]);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (brand)  params.set("brand",  brand);
      if (type)   params.set("type",   type);
      if (status) params.set("status", status);
      if (q)      params.set("q",      q);
      params.set("page",     String(page));
      params.set("pageSize", String(PAGE_SIZE));

      const res = await fetch(`/api/dam/assets?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      setAssets(data.data ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [brand, type, status, q, page]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  // Reset to page 1 on filter change
  useEffect(() => { setPage(1); }, [brand, type, status, q]);

  // Fetch product info for a SKU
  async function fetchProductInfo(sku: string) {
    if (!sku) { setProductInfo(null); return; }
    setProductLoading(true);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(sku)}/info`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setProductInfo(data);
        setProductLinks(prev => ({ ...prev, [sku]: true }));
      } else {
        setProductInfo(null);
        setProductLinks(prev => ({ ...prev, [sku]: false }));
      }
    } catch {
      setProductInfo(null);
    } finally {
      setProductLoading(false);
    }
  }

  // Check product links for visible assets
  useEffect(() => {
    const skus = [...new Set(assets.map(a => a.sku).filter(Boolean))];
    const unchecked = skus.filter(s => productLinks[s] === undefined);
    if (unchecked.length === 0) return;
    // Batch check
    Promise.all(unchecked.map(async sku => {
      try {
        const res = await fetch(`/api/products/${encodeURIComponent(sku)}/info`, { cache: "no-store" });
        return { sku, exists: res.ok };
      } catch {
        return { sku, exists: false };
      }
    })).then(results => {
      setProductLinks(prev => {
        const next = { ...prev };
        for (const r of results) next[r.sku] = r.exists;
        return next;
      });
    });
  }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(asset: DamAsset) {
    setSelected(asset);
    setDetailLoading(true);
    setProductInfo(null);
    try {
      const res = await fetch(`/api/dam/assets/${asset.id}`, { cache: "no-store" });
      const data = await res.json();
      setSelected(data.asset);
      setEvents(data.events ?? []);
      // Also fetch product info
      fetchProductInfo(data.asset?.sku ?? asset.sku);
    } finally {
      setDetailLoading(false);
    }
  }

  async function downloadRaw() {
    if (!selected) return;
    const res = await fetch("/api/dam/presign/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: selected.id, type: "raw" }),
    });
    const data = await res.json();
    if (data.url) window.open(data.url, "_blank");
  }

  async function updateStatus(newStatus: AssetStatus) {
    if (!selected) return;
    setActioning(true);
    try {
      const res = await fetch(`/api/dam/assets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, _actor: "user" }),
      });
      const updated = await res.json();
      setSelected(updated);
      setAssets(prev => prev.map(a => a.id === updated.id ? updated : a));
    } finally {
      setActioning(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="page">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: "0 0 2px" }}>Asset Library</h1>
          <p className="subtitle" style={{ margin: 0 }}>{total.toLocaleString()} asset{total !== 1 ? "s" : ""}</p>
        </div>
        <a href="/dam/upload" style={{ textDecoration: "none" }}>
          <button className="primary">+ Upload</button>
        </a>
      </div>

      {/* Filters */}
      <div className="dam-filters">
        <input
          className="dam-search"
          placeholder="Search SKU…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <select className="select" value={brand} onChange={e => setBrand(e.target.value)}>
          <option value="">All brands</option>
          {BRANDS.filter(Boolean).map(b => <option key={b}>{b}</option>)}
        </select>
        <select className="select" value={type} onChange={e => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="image">🖼 Images</option>
          <option value="video">🎬 Videos</option>
        </select>
        <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="status" style={{ textAlign: "center", padding: 40 }}>Loading…</div>
      ) : assets.length === 0 ? (
        <div className="status" style={{ textAlign: "center", padding: 40 }}>
          No assets found. <a href="/dam/upload" style={{ color: "var(--accent-2)" }}>Upload your first asset →</a>
        </div>
      ) : (
        <div className="dam-grid">
          {assets.map(asset => {
            const thumb = thumbnailUrl(asset);
            const color = STATUS_COLOR[asset.status] ?? "var(--text-muted)";
            return (
              <div key={asset.id} className="asset-card" onClick={() => openDetail(asset)}>
                <div className="asset-thumb">
                  {thumb ? (
                    <img src={thumb} alt={asset.sku} loading="lazy" />
                  ) : (
                    <div className="asset-thumb-placeholder">
                      {asset.asset_type === "video" ? "🎬" : "🖼"}
                    </div>
                  )}
                  <span className={`badge badge-${asset.asset_type}`} style={{ position: "absolute", top: 8, left: 8 }}>
                    {asset.asset_type === "video" ? "Video" : "Image"}
                  </span>
                </div>
                <div className="asset-info">
                  <div className="asset-sku">{asset.sku}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                    <span className="badge badge-brand">{asset.brand}</span>
                    <span className="badge" style={{ background: "transparent", border: `1px solid ${color}`, color }}>{asset.status}</span>
                    {productLinks[asset.sku] === true && (
                      <span className="badge" style={{ background: "rgba(0,180,216,0.08)", color: "var(--cyan)", borderColor: "rgba(0,180,216,0.2)" }} title="Linked to product">Product</span>
                    )}
                    {productLinks[asset.sku] === false && (
                      <span className="badge" style={{ background: "rgba(0,0,0,0.03)", color: "var(--dim)", borderColor: "var(--border)" }} title="No product linked">No product</span>
                    )}
                  </div>
                  <div className="asset-date">{fmtDate(asset.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pager" style={{ marginTop: 24, justifyContent: "center" }}>
          <button className="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span className="pager-info" style={{ textAlign: "center" }}>Page {page} / {totalPages}</span>
          <button className="ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
        </div>
      )}

      {/* ── Detail modal ──────────────────────────────────────────────────── */}
      {selected && (
        <div className="modal modal-center" onClick={() => setSelected(null)}>
          <div className="modal-content" style={{ maxWidth: 860, maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title" style={{ fontFamily: "monospace", fontSize: "1.1rem" }}>{selected.sku}</div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: 2 }}>{selected.brand} · {selected.asset_type} · {fmtDate(selected.created_at)}</div>
              </div>
              <button className="ghost" style={{ padding: "6px 12px" }} onClick={() => setSelected(null)}>✕ Close</button>
            </div>

            {detailLoading ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20 }}>
                {/* Preview */}
                <div>
                  {selected.asset_type === "video" && selected.stream_uid ? (
                    <div style={{ position: "relative", paddingBottom: "56.25%", background: "#000", borderRadius: 10, overflow: "hidden" }}>
                      <iframe
                        src={streamEmbedUrl(selected.stream_uid)}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : thumbnailUrl(selected) ? (
                    <img
                      src={thumbnailUrl(selected)!}
                      alt={selected.sku}
                      style={{ width: "100%", borderRadius: 10, objectFit: "contain", background: "#080f25", maxHeight: 420 }}
                    />
                  ) : (
                    <div style={{ height: 240, display: "grid", placeItems: "center", background: "#0d1730", borderRadius: 10, fontSize: "3rem" }}>
                      {selected.asset_type === "video" ? "🎬" : "🖼"}
                    </div>
                  )}

                  {/* Audit log */}
                  {events.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: "0.88rem", color: "var(--text-muted)" }}>ACTIVITY</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {events.map((ev: any) => (
                          <div key={ev.id} style={{ fontSize: "0.85rem", display: "flex", gap: 8, color: "var(--text-muted)" }}>
                            <span style={{ minWidth: 110 }}>{fmtDate(ev.created_at)}</span>
                            <span style={{ color: "var(--text)" }}>{ev.event.replace(/_/g, " ")}</span>
                            {ev.actor && <span>by {ev.actor}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Metadata + Actions */}
                <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
                  {/* Status badge */}
                  <div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600, marginBottom: 4 }}>STATUS</div>
                    <span className="badge" style={{
                      background: "transparent",
                      border: `1px solid ${STATUS_COLOR[selected.status] ?? "var(--text-muted)"}`,
                      color: STATUS_COLOR[selected.status] ?? "var(--text-muted)",
                      fontSize: "0.9rem",
                      padding: "4px 12px",
                    }}>
                      {selected.status}
                    </span>
                  </div>

                  {/* Metadata */}
                  {[
                    ["Brand",    selected.brand],
                    ["SKU",      selected.sku],
                    ["Type",     selected.asset_type],
                    ["Size",     fmt(selected.raw_size_bytes)],
                    ["Duration", selected.duration_sec ? `${selected.duration_sec.toFixed(1)}s` : null],
                    ["Captured", selected.captured_at ? fmtDate(selected.captured_at) : null],
                    ["Uploaded", selected.uploaded_by],
                    ["Approved", selected.approved_by],
                    ["Notes",    selected.notes],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={String(label)}>
                      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600, marginBottom: 2 }}>{String(label).toUpperCase()}</div>
                      <div style={{ fontSize: "0.9rem", fontFamily: label === "SKU" ? "monospace" : undefined }}>{String(value)}</div>
                    </div>
                  ))}

                  <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />

                  {/* Actions */}
                  <div style={{ display: "grid", gap: 8 }}>
                    {selected.raw_path && (
                      <button className="ghost" onClick={downloadRaw} style={{ width: "100%" }}>
                        ⬇ Download Raw
                      </button>
                    )}
                    {selected.status === "ready" && (
                      <button className="primary" onClick={() => updateStatus("approved")} disabled={actioning} style={{ width: "100%" }}>
                        {actioning ? "…" : "✓ Approve"}
                      </button>
                    )}
                    {selected.status === "approved" && (
                      <button className="ghost" onClick={() => updateStatus("archived")} disabled={actioning} style={{ width: "100%" }}>
                        {actioning ? "…" : "Archive"}
                      </button>
                    )}
                    {(selected.status === "pending" || selected.status === "ready") && (
                      <button className="ghost" onClick={() => updateStatus("archived")} disabled={actioning} style={{ width: "100%", color: "var(--error)", borderColor: "var(--error)" }}>
                        {actioning ? "…" : "Archive"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
