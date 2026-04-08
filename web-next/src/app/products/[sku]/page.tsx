"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { streamEmbedUrl } from "@/lib/cloudflare-stream";

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
  raw_filename?: string; thumbnail_path?: string; stream_thumbnail_url?: string;
  stream_uid?: string; stream_hls_url?: string; duration_sec?: number;
  notes?: string; created_at: string;
};
type MainImage = { key: string; filename: string; url: string };
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

const TABS = ["Info", "Images", "Pricing", "Assets", "Inventory", "Sales", "Platforms"] as const;
type Tab = (typeof TABS)[number];

const PLATFORM_COLORS: Record<string, string> = {
  shopee: "#ee4d2d", lazada: "#0f136d", tiktok: "#000", shopify: "#96bf48",
};

type ImageRef = { name: string; url: string };

/* ── Helpers ─────────────────────────────────────────────────────────── */
function parseImages(row: MasterRow): ImageRef[] {
  const imgs = (row as any).product_images;
  if (!Array.isArray(imgs)) return [];
  return imgs.map((url: string) => {
    const clean = String(url).split("?")[0];
    return { name: clean.split("/").pop() || clean, url: String(url) };
  });
}

function findImage1(images: ImageRef[]): ImageRef | undefined {
  return images.find((i) => /_1\./i.test(i.name)) || images[0];
}

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
  const [editDesc, setEditDesc] = useState("");
  const [savedDesc, setSavedDesc] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);

  // Images tab
  const [mainImages, setMainImages] = useState<MainImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<MainImage | null>(null);

  // Asset popup
  const [assetPopup, setAssetPopup] = useState<DamAsset | null>(null);
  const [assetDownloading, setAssetDownloading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/products/${encodeURIComponent(sku)}`);
      const d = await r.json();
      if (d.error) setError(d.error);
      else {
        setData(d);
        const desc = (d.masterRows?.[0]?.DESCRIPTION as string) || "";
        setEditDesc(desc);
        setSavedDesc(desc);
      }
    } catch { setError("Failed to load product"); }
    setLoading(false);
  }, [sku]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 3000); return () => clearTimeout(t); } }, [toast]);

  /* ── Load main images when Images tab is selected ────────────────── */
  const dataBrand = data?.brand || (data?.masterRows?.[0]?.BRAND as string) || "";
  useEffect(() => {
    if (tab !== "Images" || !data || mainImages.length > 0 || imagesLoading) return;
    setImagesLoading(true);
    fetch(`/api/main-images?sku=${encodeURIComponent(sku)}&brand=${encodeURIComponent(dataBrand)}`)
      .then((r) => r.json())
      .then((d) => setMainImages(d.images ?? []))
      .catch(() => {})
      .finally(() => setImagesLoading(false));
  }, [tab, sku, dataBrand, data, mainImages.length, imagesLoading]);

  if (loading) return <div className="page" style={{ textAlign: "center", padding: 80, color: "var(--text-muted)" }}>Loading...</div>;
  if (error || !data) return (
    <div className="page">
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <h2>Product Not Found</h2>
        <p style={{ color: "var(--text-muted)" }}>{error || `No data for ${sku}`}</p>
        <a href="/" style={{ color: "var(--app-accent)", fontWeight: 600 }}>Back to Products</a>
      </div>
    </div>
  );

  const firstRow = data.masterRows[0] ?? {};
  const brand = data.brand || (firstRow.BRAND as string) || "";
  const parentsSku = (firstRow.PARENTS_SKU as string) || "";
  const description = (firstRow.DESCRIPTION as string) || "";
  const listedCount = data.platformMappings.filter((m) => m.listing_status === "listed").length;
  const totalStock = data.inventory.reduce((s, i) => s + i.available_qty, 0);

  async function downloadImage(imageKey: string, filename: string) {
    try {
      // Get a presigned URL with Content-Disposition: attachment
      const res = await fetch("/api/main-images/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: imageKey, filename }),
      });
      const d = await res.json();
      if (d.url) {
        const a = document.createElement("a");
        a.href = d.url;
        a.download = filename;
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {
      // Fallback: open in new tab
      const img = mainImages.find((i) => i.key === imageKey);
      if (img) window.open(img.url, "_blank");
    }
  }

  async function downloadAllImages() {
    for (const img of mainImages) {
      await downloadImage(img.key, img.filename);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function downloadAsset(asset: DamAsset) {
    setAssetDownloading(true);
    try {
      const res = await fetch("/api/dam/presign/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, type: "raw" }),
      });
      const d = await res.json();
      if (d.url) {
        window.open(d.url, "_blank");
      } else {
        setToast(d.error || "No download available");
      }
    } catch {
      setToast("Download failed");
    }
    setAssetDownloading(false);
  }

  async function deleteAsset(asset: DamAsset) {
    if (!confirm(`Delete asset "${asset.raw_filename || asset.title || asset.id}"?`)) return;
    try {
      const res = await fetch(`/api/dam/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived", _actor: "user" }),
      });
      if (res.ok) {
        setAssetPopup(null);
        setToast("Asset archived");
        fetchData();
      } else {
        setToast("Failed to delete asset");
      }
    } catch { setToast("Failed to delete asset"); }
  }

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

  async function saveDescription() {
    if (!data) return;
    setSavingDesc(true);
    try {
      const resp = await fetch(`/api/products/${encodeURIComponent(sku)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: data.brand, description: editDesc }),
      });
      if (resp.ok) {
        setSavedDesc(editDesc);
        setToast("Description saved");
      } else {
        setToast("Failed to save description");
      }
    } catch { setToast("Failed to save description"); }
    setSavingDesc(false);
  }

  const mainImage = findImage1(parseImages(firstRow));

  return (
    <div className="page">
      {/* Toast */}
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "var(--app-accent)", color: "#fff", padding: "10px 20px", borderRadius: 8, zIndex: 9999 }}>{toast}</div>}

      {/* Breadcrumb */}
      <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>
        <a href="/" style={{ color: "var(--app-accent)" }}>Products</a>
        {" > "}{brand}{" > "}{parentsSku}{" > "}<strong>{sku}</strong>
      </div>

      {/* Header */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Main Image */}
          <div style={{ flexShrink: 0, width: 180, height: 180, borderRadius: 12, overflow: "hidden", background: "var(--surface-2)", border: "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {mainImage ? (
              <img src={mainImage.url} alt={mainImage.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>No image</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
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
          }}>{t}{t === "Images" && mainImages.length > 0 ? ` (${mainImages.length})` : t === "Assets" ? ` (${data.damAssets.length})` : t === "Platforms" ? ` (${listedCount})` : ""}</button>
        ))}
      </div>

      {/* ═══ TAB: Info ═══ */}
      {tab === "Info" && (
        <div className="card">
          {/* Editable Description */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 8 }}>Product Description</h3>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              placeholder="Enter product description..."
              style={{ width: "100%", resize: "vertical", minHeight: 60, fontFamily: "inherit", fontSize: "0.93rem", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border-2)", background: "#fff" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button
                className="primary"
                disabled={savingDesc || editDesc === savedDesc}
                onClick={saveDescription}
                style={{ fontSize: "0.82rem", padding: "8px 16px" }}
              >
                {savingDesc ? "Saving..." : "Save Description"}
              </button>
              {editDesc !== savedDesc && (
                <button className="ghost" onClick={() => setEditDesc(savedDesc)} style={{ fontSize: "0.82rem", padding: "8px 16px" }}>
                  Cancel
                </button>
              )}
            </div>
          </div>

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

      {/* ═══ TAB: Images ═══ */}
      {tab === "Images" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Product Images ({mainImages.length})</h3>
            {mainImages.length > 0 && (
              <button className="ghost" onClick={downloadAllImages} style={{ fontSize: "0.82rem", padding: "6px 14px" }}>Download All</button>
            )}
          </div>
          {imagesLoading ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>Loading images...</p>
          ) : mainImages.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>No product images found. Upload images from the search page.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
              {mainImages.map((img) => (
                <div key={img.key} style={{ border: "1px solid var(--border-2)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
                  <div
                    style={{ height: 160, background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden" }}
                    onClick={() => setLightboxImage(img)}
                  >
                    <img src={img.url} alt={img.filename} style={{ width: "100%", height: "100%", objectFit: "contain" }} loading="lazy" />
                  </div>
                  <div style={{ padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{img.filename}</span>
                    <button className="ghost" onClick={() => downloadImage(img.key, img.filename)} style={{ fontSize: "0.75rem", padding: "4px 10px", flexShrink: 0, marginLeft: 6 }}>Download</button>
                  </div>
                </div>
              ))}
            </div>
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
                <div key={a.id} onClick={() => setAssetPopup(a)} style={{ border: "1px solid var(--border-2)", borderRadius: 10, overflow: "hidden", background: "var(--surface)", cursor: "pointer", transition: "box-shadow 0.15s" }}>
                  <div style={{ height: 120, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {a.asset_type === "video" ? (
                      a.stream_thumbnail_url ? <img src={a.stream_thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 32, color: "var(--text-muted)" }}>video</span>
                    ) : (
                      a.thumbnail_path ? <img src={a.thumbnail_path} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 32, color: "var(--text-muted)" }}>img</span>
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
      {tab === "Inventory" && (() => {
        // Aggregate by SKU across warehouses
        const skuMap = new Map<string, { sku: string; total_available: number; total_actual: number; total_locked: number; total_defective: number; warehouses: any[] }>();
        for (const inv of data.inventory) {
          const sku = inv.sku_code || inv.sku_id || "unknown";
          if (!skuMap.has(sku)) {
            skuMap.set(sku, { sku, total_available: 0, total_actual: 0, total_locked: 0, total_defective: 0, warehouses: [] });
          }
          const agg = skuMap.get(sku)!;
          agg.total_available += inv.available_qty || 0;
          agg.total_actual += inv.actual_qty || 0;
          agg.total_locked += inv.locked_qty || 0;
          agg.total_defective += inv.defective_qty || 0;
          agg.warehouses.push(inv);
        }
        const aggregated = Array.from(skuMap.values());
        const grandTotal = aggregated.reduce((s, a) => s + a.total_available, 0);

        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Inventory Summary</h3>
              <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>Total Stock: <span style={{ color: grandTotal > 0 ? "var(--ok)" : "var(--error)" }}>{grandTotal.toLocaleString("th-TH")}</span></span>
            </div>
            {aggregated.length === 0 ? (
              <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>No inventory data. Run inventory sync first.</p>
            ) : (
              <table className="results-table" style={{ width: "100%", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    {["SKU", "Available", "Actual", "Locked", "Defective", "Status", "Warehouses"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: h === "SKU" || h === "Warehouses" ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aggregated.map((agg) => {
                    const status = agg.total_available <= 0 ? "Out" : agg.total_available < 10 ? "Low" : "OK";
                    return (
                      <tr key={agg.sku} style={{ borderBottom: "1px solid var(--border-2)" }}>
                        <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: "0.82rem" }}>{agg.sku}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: status === "Out" ? "var(--error)" : status === "Low" ? "var(--warn)" : "var(--ok)" }}>{agg.total_available.toLocaleString("th-TH")}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{agg.total_actual.toLocaleString("th-TH")}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{agg.total_locked.toLocaleString("th-TH")}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{agg.total_defective.toLocaleString("th-TH")}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>
                          <Badge label={status} color={status === "Out" ? "#fff" : status === "Low" ? "#92400e" : "#065f46"} bg={status === "Out" ? "var(--error)" : status === "Low" ? "#fef3c7" : "#d1fae5"} />
                        </td>
                        <td style={{ padding: "8px 10px", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                          {agg.warehouses.map((w: any) => `${w.warehouse_name || "WH#" + w.warehouse_id}: ${w.available_qty}`).join(" | ")}
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
        );
      })()}

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
      {/* ═══ Image Lightbox Modal ═══ */}
      {lightboxImage && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setLightboxImage(null)}>
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <img src={lightboxImage.url} alt={lightboxImage.filename} style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 8 }} />
            <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 12 }}>
              <button className="ghost" onClick={() => downloadImage(lightboxImage.key, lightboxImage.filename)} style={{ background: "rgba(255,255,255,0.15)", color: "#fff", padding: "8px 20px", fontSize: "0.85rem" }}>Download</button>
              <button className="ghost" onClick={() => setLightboxImage(null)} style={{ background: "rgba(255,255,255,0.15)", color: "#fff", padding: "8px 20px", fontSize: "0.85rem" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Asset Popup Modal ═══ */}
      {assetPopup && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setAssetPopup(null)}>
          <div style={{ background: "#fff", borderRadius: 14, maxWidth: 720, width: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border-2)" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>{assetPopup.title || assetPopup.raw_filename || "Untitled"}</h3>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <Badge label={assetPopup.asset_type} color="var(--text)" bg="var(--surface-2)" />
                  <Badge label={assetPopup.status} color={assetPopup.status === "ready" || assetPopup.status === "approved" ? "var(--ok)" : "var(--text-muted)"} bg={assetPopup.status === "ready" || assetPopup.status === "approved" ? "#e6f7ef" : "var(--surface-2)"} />
                </div>
              </div>
              <button className="ghost" onClick={() => setAssetPopup(null)} style={{ fontSize: "1.2rem", padding: "4px 10px" }}>{"\u2715"}</button>
            </div>

            {/* Preview */}
            <div style={{ background: "#080f25", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
              {assetPopup.asset_type === "video" && assetPopup.stream_uid ? (
                <div style={{ width: "100%", position: "relative", paddingBottom: "56.25%" }}>
                  <iframe
                    src={streamEmbedUrl(assetPopup.stream_uid)}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : assetPopup.thumbnail_path ? (
                <img src={assetPopup.thumbnail_path} alt="" style={{ maxWidth: "100%", maxHeight: 420, objectFit: "contain" }} />
              ) : assetPopup.stream_thumbnail_url ? (
                <img src={assetPopup.stream_thumbnail_url} alt="" style={{ maxWidth: "100%", maxHeight: 420, objectFit: "contain" }} />
              ) : (
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "1.2rem" }}>No preview</span>
              )}
            </div>

            {/* Info + Actions */}
            <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                {assetPopup.raw_filename && <span>{assetPopup.raw_filename}</span>}
                {assetPopup.duration_sec != null && <span> &middot; {assetPopup.duration_sec}s</span>}
                {assetPopup.created_at && <span> &middot; {new Date(assetPopup.created_at).toLocaleDateString()}</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="primary" onClick={() => downloadAsset(assetPopup)} disabled={assetDownloading} style={{ fontSize: "0.85rem", padding: "8px 20px" }}>
                  {assetDownloading ? "Downloading..." : "Download"}
                </button>
                <a href={`/dam?q=${encodeURIComponent(sku)}`} className="ghost" style={{ fontSize: "0.85rem", padding: "8px 16px", textDecoration: "none" }}>Open in Library</a>
                <button className="ghost" onClick={() => deleteAsset(assetPopup)} style={{ fontSize: "0.85rem", padding: "8px 16px", color: "var(--error)", borderColor: "rgba(220,38,38,0.3)" }}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
