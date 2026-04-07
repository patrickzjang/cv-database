"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_BYTES,
  VARIATION_COLUMN,
} from "@/lib/config";

const BRAND_LIST = ["PAN", "ARENA", "DAYBREAK", "HEELCARE"] as const;

type Brand = (typeof BRAND_LIST)[number];

type FileItem = {
  file: File;
  sku: string | null;
  message: string;
  state: "" | "ok" | "error";
  uploaded: boolean;
};

type ImageRef = { name: string; url: string; key?: string };

type Row = Record<string, any>;
const HIDDEN_SEARCH_COLUMNS = new Set(["MONTH"]);
type MasterUploadResult = {
  file: string;
  brand?: string;
  status: "imported" | "skipped" | "error";
  total?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  reason?: string;
  error?: string;
  archive_bucket?: string;
  archive_path?: string;
  state_warning?: string;
};

function getVisibleTableHeaders(row: Row): string[] {
  const headers = Object.keys(row).filter(
    (h) => h !== "product_images" && !HIDDEN_SEARCH_COLUMNS.has(h)
  );
  const brandIdx = headers.indexOf("BRAND");
  if (brandIdx > 0) {
    headers.splice(brandIdx, 1);
    headers.unshift("BRAND");
  }
  return headers;
}

function getHeaderWidth(header: string): string {
  const chars = Math.max(8, header.length + 2);
  return `${chars}ch`;
}

function parseSku(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, "");
  const idx = base.lastIndexOf("_");
  if (idx === -1) return null;
  const sku = base.slice(0, idx).trim();
  if (!sku) return null;
  return sku;
}

function withCacheBuster(url: string, version: number): string {
  return url.includes("?") ? `${url}&v=${version}` : `${url}?v=${version}`;
}

async function fetchJsonWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const payload = await res.json().catch(() => null);
    return { res, payload };
  } finally {
    window.clearTimeout(timer);
  }
}

export default function Home() {
  const router = useRouter();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [status, setStatus] = useState("Waiting for files.");
  const [searchStatus, setSearchStatus] = useState("No search yet.");
  const [searchInput, setSearchInput] = useState("");
  const [currentBrand, setCurrentBrand] = useState<Brand>("PAN");
  const [activeTab, setActiveTab] = useState<"upload" | "master" | "search">("search");
  const [pageSize, setPageSize] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [imageMap, setImageMap] = useState<Map<string, ImageRef[]>>(new Map());
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImages, setModalImages] = useState<ImageRef[]>([]);
  const [modalTitle, setModalTitle] = useState("Images");
  const [isMobile, setIsMobile] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [masterFiles, setMasterFiles] = useState<File[]>([]);
  const [masterStatus, setMasterStatus] = useState("Waiting for master file upload.");
  const [masterUploading, setMasterUploading] = useState(false);
  const [masterProgressOpen, setMasterProgressOpen] = useState(false);
  const [masterProgressPercent, setMasterProgressPercent] = useState(0);
  const [masterProgressLabel, setMasterProgressLabel] = useState("");
  const [masterSummaryOpen, setMasterSummaryOpen] = useState(false);
  const [masterResults, setMasterResults] = useState<MasterUploadResult[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 600px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        const ok = Boolean(data?.authenticated);
        setIsAuthenticated(ok);
        if (!ok) {
          router.replace("/login");
        }
      } catch {
        setIsAuthenticated(false);
        router.replace("/login");
      } finally {
        setAuthChecking(false);
      }
    };
    checkSession();
  }, [router]);

  const grouped = useMemo(() => groupByVariationSku(rows), [rows]);
  const sortedRows = useMemo(() => sortRows(grouped.list, sortKey, sortDir), [grouped.list, sortKey, sortDir]);

  const handleFiles = (incoming: FileList | File[]) => {
    const selected = Array.from(incoming);
    setFiles((prev) => {
      const next = [...prev];
      for (const file of selected) {
        const sku = parseSku(file.name);
        let message = "Ready";
        let state: FileItem["state"] = "";
        if (!(file.type === "image/jpeg" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg"))) {
          message = "Only JPG allowed";
          state = "error";
        } else if (file.size > MAX_BYTES) {
          message = "Over 2MB";
          state = "error";
        } else if (!sku) {
          message = "Name must be SKU_*.jpg";
          state = "error";
        }
        next.push({ file, sku, message, state, uploaded: false });
      }
      return next;
    });
    setStatus(`${selected.length} file(s) added.`);
  };

  const clearAll = () => {
    setFiles([]);
    setStatus("Waiting for files.");
  };

  const uploadFile = useCallback(async (item: FileItem) => {
    if (item.state === "error" || !item.sku) return;

    item.message = "Uploading...";
    setFiles((prev) => [...prev]);

    const form = new FormData();
    form.append("file", item.file);
    form.append("sku", item.sku);
    form.append("brand", currentBrand);

    const uploadRes = await fetch("/api/upload", {
      method: "POST",
      body: form,
    });

    const uploadJson = await uploadRes.json().catch(() => null);
    if (uploadRes.status === 401) {
      setIsAuthenticated(false);
      router.replace("/login");
      item.message = "Please login first";
      item.state = "error";
      setFiles((prev) => [...prev]);
      return;
    }
    if (!uploadRes.ok) {
      item.message = `Upload failed: ${uploadJson?.error || uploadRes.statusText}`;
      item.state = "error";
      setFiles((prev) => [...prev]);
      return;
    }

    item.message = "Uploaded";
    item.state = "ok";
    item.uploaded = true;
    setFiles((prev) => [...prev]);
  }, [currentBrand, router]);

  const uploadAll = async () => {
    setStatus("Uploading...");
    for (const item of files) {
      try {
        await uploadFile(item);
      } catch (err: any) {
        item.message = err?.message ?? "Unexpected error";
        item.state = "error";
        setFiles((prev) => [...prev]);
      }
    }
    setStatus("Done.");
  };

  const uploadMasterFiles = async () => {
    if (masterFiles.length === 0 || masterUploading) return;
    setMasterUploading(true);
    setMasterProgressOpen(true);
    setMasterProgressPercent(0);
    setMasterProgressLabel("Preparing upload...");
    setMasterStatus("Uploading master files...");
    const results: MasterUploadResult[] = [];

    for (let idx = 0; idx < masterFiles.length; idx += 1) {
      const file = masterFiles[idx];
      const totalFiles = masterFiles.length;
      const basePercent = (idx / totalFiles) * 100;
      const endPercent = ((idx + 1) / totalFiles) * 100;
      let visualPercent = basePercent;
      const capPercent = Math.max(basePercent, endPercent - 1);
      setMasterProgressLabel(`Processing ${idx + 1}/${totalFiles}: ${file.name}`);
      setMasterStatus(`Processing ${idx + 1}/${totalFiles}: ${file.name}`);
      setMasterProgressPercent(Math.round(basePercent));
      const ticker = window.setInterval(() => {
        const remaining = capPercent - visualPercent;
        const step = remaining > 20 ? 2 : remaining > 8 ? 1.1 : 0.4;
        visualPercent = Math.min(capPercent, visualPercent + step);
        setMasterProgressPercent(Math.round(visualPercent));
      }, 220);

      try {
        const form = new FormData();
        form.append("file", file);
        const { res, payload } = await fetchJsonWithTimeout(
          "/api/master-upload",
          { method: "POST", body: form },
          240000
        );
        if (res.status === 401) {
          setIsAuthenticated(false);
          router.replace("/login");
          results.push({ file: file.name, status: "error", error: "Please login first" });
          setMasterProgressPercent(Math.round(endPercent));
          break;
        }
        if (!res.ok) {
          results.push({ file: file.name, status: "error", error: payload?.error || res.statusText });
          setMasterProgressPercent(Math.round(endPercent));
          continue;
        }
        results.push({
          file: file.name,
          brand: payload?.brand,
          status: payload?.status || "imported",
          total: payload?.total,
          inserted: payload?.inserted,
          updated: payload?.updated,
          unchanged: payload?.unchanged,
          reason: payload?.reason,
          archive_bucket: payload?.archive_bucket,
          archive_path: payload?.archive_path,
          state_warning: payload?.state_warning,
        });
        setMasterProgressPercent(Math.round(endPercent));
      } catch (err: any) {
        const message = err?.name === "AbortError"
          ? "Request timed out after 4 minutes. Please check summary and refresh."
          : err?.message || "Unexpected error";
        results.push({ file: file.name, status: "error", error: message });
        setMasterProgressPercent(Math.round(endPercent));
      } finally {
        window.clearInterval(ticker);
      }
    }

    setMasterProgressPercent(100);
    setMasterProgressLabel("Finalizing...");
    setMasterResults(results);
    setMasterSummaryOpen(true);
    setTimeout(() => setMasterProgressOpen(false), 220);
    const okCount = results.filter((r) => r.status !== "error").length;
    setMasterStatus(`Finished: ${okCount}/${results.length} file(s) processed.`);
    setMasterUploading(false);
  };

  // Load images in one batch request after search
  const loadImagesForSkus = async (data: Row[]): Promise<Map<string, ImageRef[]>> => {
    const map = new Map<string, ImageRef[]>();
    const skuBrands: { sku: string; brand: string }[] = [];
    const seen = new Set<string>();
    for (const row of data) {
      const sku = String(row[VARIATION_COLUMN] || "");
      if (sku && !seen.has(sku)) {
        seen.add(sku);
        skuBrands.push({ sku, brand: String(row.BRAND || "") });
      }
    }
    if (skuBrands.length === 0) return map;

    try {
      const res = await fetch("/api/main-images/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: skuBrands }),
      });
      const json = await res.json();
      const images = json.images ?? {};
      for (const [sku, imgs] of Object.entries(images)) {
        map.set(sku, (imgs as any[]).map((img: any) => ({ name: img.filename, url: img.url, key: img.key })));
      }
    } catch { /* ignore */ }
    return map;
  };

  // Load single SKU images (for modal click)
  const loadImagesForSku = async (sku: string, brand: string): Promise<ImageRef[]> => {
    try {
      const res = await fetch(`/api/main-images?sku=${encodeURIComponent(sku)}&brand=${encodeURIComponent(brand)}`);
      const json = await res.json();
      if (json.images?.length > 0) {
        return json.images.map((img: any) => ({ name: img.filename, url: img.url, key: img.key }));
      }
    } catch { /* ignore */ }
    return [];
  };

  const runSearch = useCallback(async () => {
    const q = searchInput.trim();

    setSearchStatus("Searching...");

    try {
      const searchRes = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: currentBrand,
          query: q,
          pageSize,
          currentPage,
        }),
      });

      const payload = await searchRes.json().catch(() => null);
      if (searchRes.status === 401) {
        setIsAuthenticated(false);
        router.replace("/login");
        throw new Error("Please login first");
      }
      if (!searchRes.ok) {
        throw new Error(payload?.error || searchRes.statusText);
      }

      const dataRows = Array.isArray(payload?.rows) ? payload.rows : [];
      const total = Number(payload?.total) || 0;
      const nextPageCount = Number(payload?.pageCount) || 1;
      const shown = Number(payload?.shown) || 0;

      if (dataRows.length === 0) {
        setRows([]);
        setImageMap(new Map());
        setPageCount(nextPageCount);
        setSearchStatus(`${total || 0} total, 0 shown.`);
        return;
      }

      setRows(dataRows);
      setImageMap(new Map()); // Show results immediately

      // Load images in background (single batch request)
      loadImagesForSkus(dataRows).then((map) => setImageMap(map));
      setSearchStatus(`${total || 0} total, ${shown} shown.`);
      setPageCount(nextPageCount);
    } catch (err: any) {
      setSearchStatus(`Search failed: ${err?.message ?? "Unknown error"}`);
    }
  }, [searchInput, currentPage, pageSize, currentBrand, router]);

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    setIsAuthenticated(false);
    router.replace("/login");
  };

  useEffect(() => {
    if (activeTab === "search") {
      runSearch();
    }
  }, [activeTab, currentPage, pageSize, currentBrand, runSearch]);

  const openModal = async (variation: string, brand: string) => {
    setModalTitle(`Images for ${variation}`);
    setModalImages([]); // show loading
    setModalOpen(true);

    // Check cache first
    const cached = imageMap.get(variation);
    if (cached && cached.length > 0) {
      setModalImages(cached);
      return;
    }

    // Load from R2
    const images = await loadImagesForSku(variation, brand);
    setModalImages(images);
    // Cache for next time
    setImageMap((prev) => new Map(prev).set(variation, images));
  };

  const downloadUrl = async (url: string, _filename: string) => {
    // R2 presigned URLs work directly in browser
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const deleteImage = async (key: string, variation: string) => {
    if (!confirm(`Delete this image?\n${key.split("/").pop()}`)) return;
    try {
      const res = await fetch(`/api/main-images?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      if (res.ok) {
        // Remove from modal and cache
        setModalImages((prev) => prev.filter((img) => !(img as any).key || (img as any).key !== key));
        setImageMap((prev) => {
          const next = new Map(prev);
          const existing = next.get(variation) ?? [];
          next.set(variation, existing.filter((img) => !(img as any).key || (img as any).key !== key));
          return next;
        });
        // Reload images for this SKU
        const brand = rows.find((r) => String(r[VARIATION_COLUMN]) === variation)?.BRAND || currentBrand;
        const fresh = await loadImagesForSku(variation, String(brand));
        setModalImages(fresh);
        setImageMap((prev) => new Map(prev).set(variation, fresh));
      }
    } catch { /* ignore */ }
  };

  const downloadAll = async (images: ImageRef[]) => {
    for (const img of images) {
      await downloadUrl(img.url, img.name);
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const closeDownloadMenu = (el: HTMLElement) => {
    const details = el.closest("details");
    if (details instanceof HTMLDetailsElement) {
      details.open = false;
    }
  };

  if (authChecking) {
    return (
      <main className="page">
        <section className="panel">
          <div className="card">
            <h2>Loading</h2>
            <div className="status">Checking session...</div>
          </div>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const toCsv = (dataRows: Row[], imgMap: Map<string, ImageRef[]>) => {
    if (!dataRows || dataRows.length === 0) return "";
    const headers = [...Object.keys(dataRows[0]).filter((h) => h !== "product_images"), "PROD_JPG"];
    const esc = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [
      headers.map(esc).join(","),
      ...dataRows.map((r) => {
        const variation = r[VARIATION_COLUMN];
        const images = imgMap.get(String(variation)) || [];
        const firstUrl = images[0]?.url ?? "";
        return headers
          .map((h) => {
            if (h === "PROD_JPG") return esc(firstUrl);
            return esc(r[h]);
          })
          .join(",");
      }),
    ];
    return lines.join("\n");
  };

  const downloadCsv = () => {
    const csv = toCsv(rows, imageMap);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const renderTable = () => {
    if (sortedRows.length === 0) return null;
    const headers = getVisibleTableHeaders(sortedRows[0]);
    const headerWidths = Object.fromEntries(headers.map((h) => [h, getHeaderWidth(h)]));

    if (isMobile) {
      return (
        <div className="mobile-cards">
          {sortedRows.map((row) => {
            const variation = row[VARIATION_COLUMN];
            const groupRows = grouped.map.get(variation) || [row];
            const images = imageMap.get(String(variation)) || [];
            const img = images.find((i) => /_out\./i.test(i.name)) || images[0];

            return (
              <div className="mobile-card" key={variation}>
                <div className="mobile-card-header">
                  <div className="mobile-card-title">VARIATION_SKU:<br />{variation}</div>
                </div>
                <div className="mobile-card-image">
                  <div className="mobile-image-col">
                    {img ? (
                      <>
                        <img
                          src={img.url}
                          alt={img.name}
                          className="thumb"
                          onClick={() => openModal(String(variation), String(row.BRAND || currentBrand))}
                        />
                        <details className="download-menu" onClick={(e) => e.stopPropagation()}>
                          <summary className="ghost download-trigger">Download ▾</summary>
                          <div className="download-pop">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadUrl(img.url, img.name);
                                closeDownloadMenu(e.currentTarget);
                              }}
                            >
                              First image
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadAll(images);
                                closeDownloadMenu(e.currentTarget);
                              }}
                            >
                              All images
                            </button>
                          </div>
                        </details>
                      </>
                    ) : (
                      <div>No image</div>
                    )}
                  </div>
                </div>
                <button
                  className="ghost"
                  onClick={() => {
                    const next = new Set(expandedRows);
                    if (next.has(variation)) next.delete(variation);
                    else next.add(variation);
                    setExpandedRows(next);
                  }}
                >
                  {expandedRows.has(variation) ? "Hide Details" : "Show Details"}
                </button>
                {expandedRows.has(variation) && (
                  <div className="mobile-card-details">
                    {groupRows.map((item, idx) => (
                      <div className="mobile-card-row" key={`${variation}-${idx}`}>
                        {headers.map((h) => (
                          <div className="mobile-card-field" key={h}>
                            <div className="label">{h}</div>
                            <div className="value">{item[h] ?? ""}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <table className="results-table">
        <thead>
          <tr>
            <th></th>
            {headers.map((h) => (
              <th
                key={h}
                className="sortable"
                style={{ width: headerWidths[h], minWidth: headerWidths[h] }}
                data-sort={sortKey === h ? sortDir : undefined}
                onClick={() => {
                  if (sortKey === h) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else {
                    setSortKey(h);
                    setSortDir("asc");
                  }
                }}
              >
                {h}
              </th>
            ))}
            <th className="thumb-col">PROD_JPG</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, idx) => {
            const variation = row[VARIATION_COLUMN];
            const groupRows = grouped.map.get(variation) || [row];
            const images = imageMap.get(String(variation)) || [];
            const img = images.find((i) => /_out\./i.test(i.name)) || images[0];

            return (
              <Fragment key={variation}>
                <tr>
                  <td className="arrow-cell">
                    {((currentPage - 1) * pageSize) + idx + 1}. {" "}
                    <span
                      className="row-toggle"
                      onClick={() => {
                        const next = new Set(expandedRows);
                        if (next.has(variation)) next.delete(variation);
                        else next.add(variation);
                        setExpandedRows(next);
                      }}
                    >
                      {expandedRows.has(variation) ? "▾" : "▸"}
                    </span>
                  </td>
                  {headers.map((h) => (
                    <td key={h} style={{ width: headerWidths[h], minWidth: headerWidths[h] }}>{row[h] ?? ""}</td>
                  ))}
                  <td className="thumb-wrap thumb-col">
                    {img ? (
                      <>
                        <img
                          src={img.url}
                          alt={img.name}
                          className="thumb"
                          onClick={() => openModal(String(variation), String(row.BRAND || currentBrand))}
                        />
                        <details className="download-menu" onClick={(e) => e.stopPropagation()}>
                          <summary className="ghost download-trigger">Download ▾</summary>
                          <div className="download-pop">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadUrl(img.url, img.name);
                                closeDownloadMenu(e.currentTarget);
                              }}
                            >
                              First image
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadAll(images);
                                closeDownloadMenu(e.currentTarget);
                              }}
                            >
                              All images
                            </button>
                          </div>
                        </details>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {expandedRows.has(variation) &&
                  groupRows.map((item, i) => (
                    <tr key={`${variation}-${i}`} className="sub-row">
                      <td className="thumb-col"></td>
                      {headers.map((h) => (
                        <td key={`${h}-${i}`} style={{ width: headerWidths[h], minWidth: headerWidths[h] }}>{item[h] ?? ""}</td>
                      ))}
                      <td></td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <>
      <main className="page">
        <section className="panel">
          <div className="brand-tabs">
            {BRAND_LIST.map((b) => (
              <button
                key={b}
                className={`brand-tab ${currentBrand === b ? "active" : ""}`}
                onClick={() => {
                  setCurrentBrand(b);
                  setCurrentPage(1);
                  setSearchStatus("No search yet.");
                  setRows([]);
                }}
              >
                {b}
              </button>
            ))}
          </div>

          <div className="tabs">
            <button className={`tab ${activeTab === "search" ? "active" : ""}`} onClick={() => setActiveTab("search")}>Search Products</button>
            <button className={`tab ${activeTab === "master" ? "active" : ""}`} onClick={() => setActiveTab("master")}>Master Data</button>
            <button className={`tab ${activeTab === "upload" ? "active" : ""}`} onClick={() => setActiveTab("upload")}>Image Uploader</button>
          </div>

          {activeTab === "upload" && (
            <div className="card">
              <h2>Product Image Uploader</h2>
              <p className="subtitle">Drop JPG files named like <code>VARIATION_SKU_1.jpg</code>, <code>VARIATION_SKU_2.jpg</code>. The VARIATION_SKU must exist in the product master.</p>

              <div
                id="dropzone"
                className="dropzone"
                aria-label="File dropzone"
                tabIndex={0}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFiles(e.dataTransfer.files);
                }}
              >
                <div className="dz-title">Drop files here</div>
                <div className="dz-sub">or click to choose files</div>
                <input id="fileInput" type="file" accept="image/jpeg" multiple onChange={(e) => handleFiles(e.target.files || [])} />
              </div>

              <div className="actions">
                <button className="primary" disabled={files.length === 0} onClick={uploadAll}>Upload</button>
                <button className="ghost" disabled={files.length === 0} onClick={clearAll}>Clear</button>
              </div>

              <div className="meta">
                <div>Max size: 2MB per image</div>
                <div>Format: JPG only</div>
              </div>

              <div className="status-inline">
                <div className="status-title">Status</div>
                <div className="status">{status}</div>
              </div>

              <ul className="file-list">
                {files.map((f, idx) => (
                  <li key={`${f.file.name}-${idx}`} className={`file-item ${f.state}`}>
                    <div className="name">{f.file.name}</div>
                    <div className="status">{f.message}</div>
                  </li>
                ))}
              </ul>

            </div>
          )}

          {activeTab === "master" && (
            <div className="card">
              <h2>Master Data</h2>
              <p className="subtitle">Product master data is synced from Google Sheet. Edit data in the sheet, then sync to update the system.</p>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16, marginBottom: 20 }}>
                <a
                  href="https://docs.google.com/spreadsheets/d/10WIc5xJHaPbZoCTHPY0jAe2BA_2VkvH_jALTgZJ1-54"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", textDecoration: "none", borderRadius: 8, fontWeight: 600, fontSize: "0.92rem" }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <rect x="2" y="2" width="14" height="14" rx="2" />
                    <path d="M2 7h14M2 12h14M7 2v14M12 2v14" />
                  </svg>
                  Open Google Sheet
                </a>
                <button
                  className="ghost"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", fontWeight: 600, fontSize: "0.92rem" }}
                  disabled={masterUploading}
                  onClick={async () => {
                    setMasterStatus("Syncing from Google Sheet...");
                    setMasterUploading(true);
                    try {
                      const res = await fetch("/api/master-data/sync-gsheet", { method: "POST" });
                      const json = await res.json();
                      if (res.ok && json.ok) {
                        setMasterStatus(`Synced! ${json.pricing_rows} SKUs + ${json.rules_rows} pricing rules updated.`);
                      } else {
                        setMasterStatus(`Error: ${json.error ?? "Sync failed"}`);
                      }
                    } catch {
                      setMasterStatus("Sync failed — network error");
                    }
                    setMasterUploading(false);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M2 8a6 6 0 0 1 10.3-4.1" /><path d="M14 8a6 6 0 0 1-10.3 4.1" />
                    <path d="M12 1v3.5h-3.5" /><path d="M4 15v-3.5h3.5" />
                  </svg>
                  {masterUploading ? "Syncing..." : "Sync Now"}
                </button>
              </div>

              <div className="status">{masterStatus}</div>

              <div style={{ marginTop: 16, padding: "14px 18px", background: "var(--surface-2)", borderRadius: 10, fontSize: "0.88rem", color: "var(--text-muted)" }}>
                <strong style={{ color: "var(--text)" }}>How it works:</strong> Edit product data (columns A–J) in the Google Sheet for any brand tab (DAYBREAK, PAN, HEELCARE, ARENA). Then click "Sync Now" or wait for the hourly auto-sync to update the system.
              </div>
            </div>
          )}

          {activeTab === "search" && (
            <div className="card">
              <h2>Search Products</h2>
              <p className="subtitle">Search by VARIATION_SKU (supports 1–9 characters, prefix match).</p>
              <div className="search-row">
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Enter VARIATION_SKU (leave blank for all)..." />
                <select className="select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                </select>
                <button className="primary" onClick={() => { setCurrentPage(1); runSearch(); }}>Search</button>
                <button className="ghost" disabled={rows.length === 0} onClick={downloadCsv}>Export CSV</button>
              </div>
              <div className="pager">
                <button className="ghost" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Prev</button>
                <div className="pager-info">Page {currentPage} / {pageCount}</div>
                <button className="ghost" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}>Next</button>
                <select className="select" value={currentPage} onChange={(e) => setCurrentPage(Number(e.target.value))}>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>Page {p}</option>
                  ))}
                </select>
              </div>
              <div className="status">{searchStatus}</div>
              <div id="results">{renderTable()}</div>
            </div>
          )}
        </section>
      </main>

      {modalOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <div className="modal-backdrop" onClick={() => setModalOpen(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <div id="modalTitle" className="modal-title">{modalTitle}</div>
              <button className="ghost" onClick={() => setModalOpen(false)}>Close</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 10 }}>
                <button className="ghost" onClick={() => downloadAll(modalImages)}>Download all images</button>
              </div>
              <div className="thumb-grid">
                {modalImages.length === 0 && (
                  <div style={{ color: "var(--text-muted)", padding: 20, textAlign: "center" }}>Loading images...</div>
                )}
                {modalImages.map((img) => (
                  <div className="thumb-card" key={img.url} style={{ position: "relative" }}>
                    <img src={img.url} alt={img.name} className="thumb" />
                    <div>{img.name}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                      <button className="ghost" onClick={() => downloadUrl(img.url, img.name)} style={{ fontSize: "0.82rem" }}>Download</button>
                      {img.key && (
                        <button
                          className="ghost"
                          onClick={() => deleteImage(img.key!, modalTitle.replace("Images for ", ""))}
                          style={{ fontSize: "0.82rem", color: "var(--error)" }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {masterSummaryOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="masterSummaryTitle">
          <div className="modal-backdrop" onClick={() => setMasterSummaryOpen(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <div id="masterSummaryTitle" className="modal-title">Master Upload Summary</div>
              <button className="ghost" onClick={() => setMasterSummaryOpen(false)}>Close</button>
            </div>
            <div className="modal-body">
              <ul className="file-list">
                {masterResults.map((r, i) => (
                  <li key={`${r.file}-${i}`} className={`file-item ${r.status === "error" ? "error" : r.status === "imported" ? "ok" : ""}`}>
                    <div className="name">{r.file}</div>
                    <div className="status">
                      {r.status === "imported" && `Imported (${r.brand || "-"}): total=${r.total || 0}, inserted=${r.inserted || 0}, updated=${r.updated || 0}, unchanged=${r.unchanged || 0}`}
                      {r.status === "skipped" && `Skipped: ${r.reason || "Not newer version"}`}
                      {r.status === "error" && `Error: ${r.error || "Unknown error"}`}
                      {r.status !== "error" && r.archive_bucket && r.archive_path && ` | Archived: ${r.archive_bucket}/${r.archive_path}`}
                      {r.status !== "error" && r.state_warning && ` | Warning: ${r.state_warning}`}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {masterProgressOpen && (
        <div className="modal modal-center" role="dialog" aria-modal="true" aria-labelledby="masterProgressTitle">
          <div className="modal-backdrop"></div>
          <div className="modal-content progress-modal">
            <div className="modal-header">
              <div id="masterProgressTitle" className="modal-title">Uploading Master Data</div>
            </div>
            <div className="modal-body">
              <div className="progress-label">{masterProgressLabel}</div>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${masterProgressPercent}%` }}></div>
              </div>
              <div className="progress-percent">{masterProgressPercent}%</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function sortRows(rows: Row[], key: string | null, dir: "asc" | "desc") {
  if (!key) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const an = Number(av);
    const bn = Number(bv);
    const bothNum = !Number.isNaN(an) && !Number.isNaN(bn);
    if (bothNum) return dir === "asc" ? an - bn : bn - an;
    const as = String(av).toLowerCase();
    const bs = String(bv).toLowerCase();
    if (as === bs) return 0;
    return dir === "asc" ? (as < bs ? -1 : 1) : (as > bs ? -1 : 1);
  });
  return sorted;
}

function groupByVariationSku(rows: Row[]) {
  const map = new Map<string, Row[]>();
  const list: Row[] = [];
  for (const row of rows) {
    const key = row[VARIATION_COLUMN];
    if (key === undefined || key === null) continue;
    if (!map.has(key)) {
      map.set(key, [row]);
      list.push(row);
    } else {
      map.get(key)!.push(row);
    }
  }
  for (const [key, group] of map.entries()) {
    group.sort((a, b) => {
      const as = String(a.ITEM_SKU ?? "").toLowerCase();
      const bs = String(b.ITEM_SKU ?? "").toLowerCase();
      if (as === bs) return 0;
      return as < bs ? -1 : 1;
    });
    const idx = list.findIndex((r) => r[VARIATION_COLUMN] === key);
    if (idx >= 0) list[idx] = group[0];
  }
  return { map, list };
}
