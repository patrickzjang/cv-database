"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

/* ── Types ──────────────────────────────────────────────────────────────── */
type MasterRow = Record<string, string | number | null>;
type PricingRow = {
  item_sku: string; rrp?: number; rsp?: number; price_campaign_a?: number;
  price_mega?: number; price_flash_sale?: number; min_price?: number;
  cogs_inc_vat?: number; est_margin?: number;
};
type PlatformMap = {
  item_sku: string; platform: string; platform_sku?: string;
  platform_product_id?: string; platform_option_id?: string; listing_status?: string;
};
type DamAsset = {
  id: string; asset_type: string; title?: string; status: string;
  raw_filename?: string; thumbnail_path?: string; stream_thumbnail_url?: string; created_at: string;
};
type InventoryRow = {
  sku_id: string; sku_code?: string; warehouse_name?: string;
  available_qty: number; actual_qty: number; locked_qty: number; defective_qty: number;
};
type SalesSummary = { total_qty: number; total_revenue: number; order_count: number; avg_daily: number };

type ProductData = {
  variation_sku: string;
  brand: string;
  masterRows: MasterRow[];
  pricing: PricingRow[];
  platformMappings: PlatformMap[];
  damAssets: DamAsset[];
  inventory: InventoryRow[];
  salesSummary: SalesSummary;
  jstProducts: any[];
};

const TABS = ["Info", "Pricing", "Assets", "Inventory", "Sales", "Platforms"] as const;
type Tab = (typeof TABS)[number];

const PLATFORM_COLORS: Record<string, string> = {
  shopee: "#ee4d2d", lazada: "#0f136d", tiktok: "#000", shopify: "#96bf48",
};

/* ── Helpers ─────────────────────────────────────────────────────────── */
function fmt(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function marginColor(m?: number | null) {
  if (m == null) return undefined;
  if (m < 10) return "var(--error)";
  if (m < 20) return "var(--warn)";
  return "var(--ok)";
}

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 12, fontSize: "0.78rem", fontWeight: 600, color, background: bg }}>
      {label}
    </span>
  );
}

/* ── Main Component ──────────────────────────────────────────────────── */
export default function ProductDetailPage() {
  const params = useParams();
  const sku = params.sku as string;
  const [data, setData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Info");
  const [toast, setToast] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/products/${encodeURIComponent(sku)}`);
      const d = await r.json();
      if (d.error) setError(d.error);
      else setData(d);
    } catch { setError("Failed to load product"); }
    setLoading(false);
  }, [sku]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 3000); return () => clearTimeout(t); } }, [toast]);

  if (loading) return <div className="page" style={{ textAlign: "center", padding: 80, color: "var(--text-muted)" }}>Loading...</div>;
  if (error || !data) return (
    <div className="page">
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <h2>Product Not Found</h2>
        <p style={{ color: "var(--text-muted)" }}>{error || `No data for ${sku}`}</p>
        <a href="/products/pricing" style={{ color: "var(--app-accent)", fontWeight: 600 }}>Back to Products</a>
      </div>
    </div>
  );

  const firstRow = data.masterRows[0] ?? {};
  const brand = data.brand || (firstRow.BRAND as string) || "";
  const parentsSku = (firstRow.PARENTS_SKU as string) || "";
  const description = (firstRow.DESCRIPTION as string) || "";
  const listedCount = data.platformMappings.filter((m) => m.listing_status === "listed").length;
  const totalStock = data.inventory.reduce((s, i) => s + i.available_qty, 0);

  /* ── Actions ────────────────────────────────────────────────────────── */
  async function syncToJst() {
    const items = data!.masterRows.map((r) => ({
      itemId: r.PARENTS_SKU || parentsSku,
      skuId: r.ITEM_SKU,
      skuName: r.DESCRIPTION || description,
      barcode: r.BARCODE || r.UPC,
    }));
    const resp = await fetch("/api/products/sync-to-jst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    setToast(resp.ok ? "Synced to JST" : "Sync failed");
  }

  async function uploadToPlatform() {
    const items = [{
      goodsItem: { itemId: parentsSku, name: description, brandName: brand },
      goodsSkus: data!.masterRows.map((r) => ({
        skuId: r.ITEM_SKU,
        skuName: r.DESCRIPTION || description,
        barcode: r.BARCODE || r.UPC,
      })),
    }];
    const resp = await fetch("/api/products/upload-to-platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    setToast(resp.ok ? "Uploaded to platform" : "Upload failed");
  }

  return (
    <div className="page">
      {/* Toast */}
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "var(--app-accent)", color: "#fff", padding: "10px 20px", borderRadius: 8, zIndex: 9999 }}>{toast}</div>}

      {/* Breadcrumb */}
      <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>
        <a href="/products/pricing" style={{ color: "var(--app-accent)" }}>Products</a>
        {" > "}{brand}{" > "}{parentsSku}{" > "}<strong>{sku}</strong>
      </div>

      {/* Header */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <h1 style={{ margin: 0, fontSize: "1.6rem" }}>{sku}</h1>
              <Badge label={brand} color="#fff" bg="var(--app-accent)" />
            </div>
            <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "0.95rem" }}>{description}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={syncToJst} style={{ fontSize: "0.82rem" }}>Sync to JST</button>
            <button className="primary" onClick={uploadToPlatform} style={{ fontSize: "0.82rem" }}>Upload to Platform</button>
          </div>
        </div>

        {/* Quick Stats */}
        <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.85rem" }}><span style={{ color: "var(--text-muted)" }}>Sizes: </span><strong>{data.masterRows.length}</strong></div>
          <div style={{ fontSize: "0.85rem" }}><span style={{ color: "var(--text-muted)" }}>Platforms: </span><strong>{listedCount}</strong></div>
          <div style={{ fontSize: "0.85rem" }}><span style={{ color: "var(--text-muted)" }}>Assets: </span><strong>{data.damAssets.length}</strong></div>
          <div style={{ fontSize: "0.85rem" }}><span style={{ color: "var(--text-muted)" }}>Stock: </span><strong style={{ color: totalStock <= 0 ? "var(--error)" : totalStock < 20 ? "var(--warn)" : "var(--ok)" }}>{totalStock}</strong></div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--border-2)", overflowX: "auto" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "10px 20px", border: "none", background: "transparent", cursor: "pointer",
            fontWeight: tab === t ? 700 : 400, color: tab === t ? "var(--app-accent)" : "var(--text-muted)",
            borderBottom: tab === t ? "2px solid var(--app-accent)" : "2px solid transparent",
            marginBottom: -2, fontSize: "0.92rem", whiteSpace: "nowrap",
          }}>{t}{t === "Assets" ? ` (${data.damAssets.length})` : t === "Platforms" ? ` (${listedCount})` : ""}</button>
        ))}
      </div>

      {/* ═══ TAB: Info ═══ */}
      {tab === "Info" && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>SKU Variants ({data.masterRows.length} sizes)</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="results-table" style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  {["ITEM_SKU", "DESCRIPTION", "UPC", "Price Tag", "COGS (Inc.Vat)", "Category", "Collection"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 10px", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.masterRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border-2)" }}>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: "0.82rem" }}>{r.ITEM_SKU}</td>
                    <td style={{ padding: "8px 10px" }}>{r.DESCRIPTION}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{r.UPC || r.BARCODE || "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(r["Price Tag"] as number)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(r.COST as number || r["COGs (Inc.Vat)"] as number)}</td>
                    <td style={{ padding: "8px 10px" }}>{r.Category || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{r.Collection || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.jstProducts.length > 0 && (
            <p style={{ fontSize: "0.82rem", color: "var(--ok)", marginTop: 12 }}>
              Synced in JST ({data.jstProducts.length} SKUs)
            </p>
          )}
        </div>
      )}

      {/* ═══ TAB: Pricing ═══ */}
      {tab === "Pricing" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Pricing per SKU</h3>
            <a href="/products/pricing" style={{ fontSize: "0.82rem", color: "var(--app-accent)" }}>Edit in Pricing Grid</a>
          </div>
          {data.pricing.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>No pricing data. Import from the Pricing page.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="results-table" style={{ width: "100%", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    {["ITEM_SKU", "RRP", "RSP", "Campaign A", "Mega", "Flash Sale", "Min Price", "COGS", "Margin%"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: h === "ITEM_SKU" ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.pricing.map((p, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-2)" }}>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: "0.82rem" }}>{p.item_sku}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(p.rrp)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{fmt(p.rsp)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(p.price_campaign_a)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(p.price_mega)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(p.price_flash_sale)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(p.min_price)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(p.cogs_inc_vat)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: marginColor(p.est_margin) }}>
                        {p.est_margin != null ? `${p.est_margin.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: Assets ═══ */}
      {tab === "Assets" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Digital Assets ({data.damAssets.length})</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <a href={`/dam?q=${encodeURIComponent(sku)}`} className="ghost" style={{ padding: "6px 14px", fontSize: "0.82rem", textDecoration: "none" }}>View in Library</a>
              <a href={`/dam/upload?sku=${encodeURIComponent(sku)}&brand=${encodeURIComponent(brand)}`} className="primary" style={{ padding: "6px 14px", fontSize: "0.82rem", textDecoration: "none" }}>Upload New</a>
            </div>
          </div>
          {data.damAssets.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>No assets linked to this product.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
              {data.damAssets.map((a) => (
                <div key={a.id} style={{ border: "1px solid var(--border-2)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
                  <div style={{ height: 120, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {a.asset_type === "video" ? (
                      a.stream_thumbnail_url ? <img src={a.stream_thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 32 }}>video</span>
                    ) : (
                      a.thumbnail_path ? <img src={a.thumbnail_path} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 32 }}>img</span>
                    )}
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <p style={{ fontSize: "0.78rem", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title || a.raw_filename || "Untitled"}</p>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <Badge label={a.asset_type} color="var(--text)" bg="var(--surface-2)" />
                      <Badge label={a.status} color={a.status === "approved" ? "var(--ok)" : "var(--text-muted)"} bg={a.status === "approved" ? "#e6f7ef" : "var(--surface-2)"} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: Inventory ═══ */}
      {tab === "Inventory" && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Inventory by Warehouse</h3>
          {data.inventory.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>No inventory data. Run inventory sync first.</p>
          ) : (
            <table className="results-table" style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  {["SKU", "Warehouse", "Available", "Actual", "Locked", "Defective", "Status"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: h === "SKU" || h === "Warehouse" ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.inventory.map((inv, i) => {
                  const status = inv.available_qty <= 0 ? "Out" : inv.available_qty < 10 ? "Low" : "OK";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-2)" }}>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: "0.82rem" }}>{inv.sku_code || inv.sku_id}</td>
                      <td style={{ padding: "8px 10px" }}>{inv.warehouse_name || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: status === "Out" ? "var(--error)" : status === "Low" ? "var(--warn)" : "var(--ok)" }}>{inv.available_qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{inv.actual_qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{inv.locked_qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{inv.defective_qty}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        <Badge label={status} color={status === "Out" ? "#fff" : status === "Low" ? "#92400e" : "#065f46"} bg={status === "Out" ? "var(--error)" : status === "Low" ? "#fef3c7" : "#d1fae5"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 12, textAlign: "right" }}>
            <a href="/inventory" style={{ fontSize: "0.82rem", color: "var(--app-accent)" }}>View Full Inventory</a>
          </div>
        </div>
      )}

      {/* ═══ TAB: Sales ═══ */}
      {tab === "Sales" && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Sales Performance (Last 30 Days)</h3>
          {data.salesSummary.order_count === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>No sales data in the last 30 days.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              {[
                { label: "Total Qty Sold", value: data.salesSummary.total_qty.toLocaleString("th-TH") },
                { label: "Revenue", value: `${data.salesSummary.total_revenue.toLocaleString("th-TH", { maximumFractionDigits: 0 })}` },
                { label: "Orders", value: data.salesSummary.order_count.toLocaleString("th-TH") },
                { label: "Avg Daily Sales", value: data.salesSummary.avg_daily.toFixed(1) },
              ].map((card) => (
                <div key={card.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: 16, textAlign: "center" }}>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 4px" }}>{card.label}</p>
                  <p style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>{card.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: Platforms ═══ */}
      {tab === "Platforms" && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Platform Listing Status</h3>
          {data.platformMappings.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>No platform mappings. Import from the Pricing page.</p>
          ) : (
            <table className="results-table" style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  {["ITEM_SKU", "Platform", "Platform SKU", "Product ID", "Option ID", "Status"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.platformMappings.map((m, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border-2)" }}>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: "0.82rem" }}>{m.item_sku}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ fontWeight: 600, color: PLATFORM_COLORS[m.platform] || "var(--text)" }}>{m.platform}</span>
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{m.platform_sku || "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{m.platform_product_id || "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{m.platform_option_id || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <Badge
                        label={m.listing_status === "listed" ? "Listed" : "Not Listed"}
                        color={m.listing_status === "listed" ? "#065f46" : "#991b1b"}
                        bg={m.listing_status === "listed" ? "#d1fae5" : "#fee2e2"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 12, textAlign: "right" }}>
            <a href="/products/pricing" style={{ fontSize: "0.82rem", color: "var(--app-accent)" }}>Manage in Pricing</a>
          </div>
        </div>
      )}
    </div>
  );
}
