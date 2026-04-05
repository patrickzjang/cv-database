"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const BRANDS   = ["PAN", "ARENA", "DAYBREAK", "HEELCARE"] as const;
type Brand     = (typeof BRANDS)[number];

const IMAGE_EXTS = new Set(["jpg","jpeg","png","webp","tif","tiff","cr3","cr2","arw","nef","dng","raf","rw2","orf"]);
const VIDEO_EXTS = new Set(["mp4","mov","avi","mkv","webm","mxf","r3d","braw","m4v"]);
const MAX_IMAGE_BYTES = 500 * 1024 * 1024; // 500 MB raw images
const MAX_VIDEO_BYTES = 10  * 1024 * 1024 * 1024; // 10 GB videos

type UploadState = "queued" | "uploading" | "processing" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  assetType: "image" | "video";
  sku: string;
  brand: Brand;
  notes: string;
  capturedAt: string;
  state: UploadState;
  progress: number; // 0-100
  error: string;
}

function ext(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function detectType(filename: string): "image" | "video" | null {
  const e = ext(filename);
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  return null;
}

function parseSku(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const idx  = base.lastIndexOf("_");
  return idx > 0 ? base.slice(0, idx).trim() : "";
}

function fmt(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 ** 2)   return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function DAMUploadPage() {
  const router   = useRouter();
  const dropRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [queue,    setQueue]    = useState<QueueItem[]>([]);
  const [dragover, setDragover] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Auth guard
  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!d?.authenticated) router.replace("/login"); });
  }, [router]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const items: QueueItem[] = [];
    for (const file of arr) {
      const assetType = detectType(file.name);
      if (!assetType) continue;
      if (assetType === "image" && file.size > MAX_IMAGE_BYTES) continue;
      if (assetType === "video" && file.size > MAX_VIDEO_BYTES) continue;
      items.push({
        id: uid(),
        file,
        assetType,
        sku:        parseSku(file.name),
        brand:      "PAN",
        notes:      "",
        capturedAt: "",
        state:      "queued",
        progress:   0,
        error:      "",
      });
    }
    setQueue(prev => [...prev, ...items]);
  }, []);

  // Drag & drop
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueue(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  }

  function removeItem(id: string) {
    setQueue(prev => prev.filter(it => it.id !== id));
  }

  async function uploadItem(item: QueueItem): Promise<void> {
    const { id, file, assetType, sku, brand, notes, capturedAt } = item;

    if (!sku.trim()) {
      updateItem(id, { state: "error", error: "SKU is required" });
      return;
    }

    updateItem(id, { state: "uploading", progress: 5 });

    try {
      if (assetType === "image") {
        // 1. Get presigned upload URL for R2 raw bucket
        const presignRes = await fetch("/api/dam/presign/upload", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ bucket: "raw", brand, sku, filename: file.name, contentType: file.type || "application/octet-stream" }),
        });
        if (!presignRes.ok) throw new Error(await presignRes.text());
        const { url, key, bucket } = await presignRes.json();

        updateItem(id, { progress: 20 });

        // 2. PUT file directly to R2
        const uploadRes = await fetch(url, {
          method:  "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body:    file,
        });
        if (!uploadRes.ok) throw new Error(`R2 upload failed: ${uploadRes.status}`);

        updateItem(id, { progress: 80 });

        // 3. Create asset record in DB
        await fetch("/api/dam/assets", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            sku,
            brand,
            asset_type:    "image",
            raw_bucket:    bucket,
            raw_path:      key,
            raw_filename:  file.name,
            raw_mime_type: file.type,
            raw_size_bytes: file.size,
            status:        "ready",
            notes:         notes || null,
            captured_at:   capturedAt || null,
            uploaded_by:   "user",
          }),
        });

        updateItem(id, { state: "done", progress: 100 });

      } else {
        // VIDEO: upload to Cloudflare Stream
        // 1. Get a direct upload URL from Stream
        const streamRes = await fetch("/api/dam/stream/upload-url", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ sku, brand, filename: file.name }),
        });
        if (!streamRes.ok) throw new Error(await streamRes.text());
        const { uid: streamUid, uploadURL } = await streamRes.json();

        updateItem(id, { progress: 10 });

        // 2. Upload directly to Stream using tus/fetch
        const xhr = new XMLHttpRequest();
        await new Promise<void>((resolve, reject) => {
          xhr.open("POST", uploadURL);
          xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              updateItem(id, { progress: Math.round((e.loaded / e.total) * 75) + 10 });
            }
          };
          xhr.onload  = () => (xhr.status < 300 ? resolve() : reject(new Error(`Stream upload: ${xhr.status}`)));
          xhr.onerror = () => reject(new Error("Stream upload network error"));
          xhr.send(file);
        });

        updateItem(id, { progress: 90, state: "processing" });

        // 3. Create asset record (status=processing, CF Stream will webhook when ready)
        await fetch("/api/dam/assets", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            sku,
            brand,
            asset_type:     "video",
            raw_filename:   file.name,
            raw_mime_type:  file.type,
            raw_size_bytes: file.size,
            stream_uid:     streamUid,
            stream_status:  "pendingupload",
            status:         "processing",
            notes:          notes || null,
            captured_at:    capturedAt || null,
            uploaded_by:    "user",
          }),
        });

        updateItem(id, { state: "processing", progress: 100 });
      }
    } catch (err) {
      updateItem(id, { state: "error", error: String(err) });
    }
  }

  async function uploadAll() {
    const toUpload = queue.filter(it => it.state === "queued" || it.state === "error");
    if (!toUpload.length) return;
    setUploading(true);
    for (const item of toUpload) {
      await uploadItem(item);
    }
    setUploading(false);
  }

  const ready   = queue.filter(it => it.state === "queued").length;
  const done    = queue.filter(it => it.state === "done" || it.state === "processing").length;
  const errored = queue.filter(it => it.state === "error").length;

  return (
    <main className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px" }}>Upload Assets</h1>
        <p className="subtitle">Drop images or videos below. Files upload directly to Cloudflare R2 / Stream.</p>
      </div>

      {/* Drop zone */}
      <div
        ref={dropRef}
        className={`dropzone${dragover ? " dragover" : ""}`}
        style={{ marginBottom: 20 }}
        onDragOver={e => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={[...IMAGE_EXTS, ...VIDEO_EXTS].map(e => `.${e}`).join(",")}
          style={{ display: "none" }}
          onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
        <div className="dz-title">Drop files here or click to browse</div>
        <div className="dz-sub">Images: JPG, PNG, CR3, ARW, NEF, DNG… · Videos: MP4, MOV, MXF…</div>
      </div>

      {/* Upload queue */}
      {queue.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <button className="primary" onClick={uploadAll} disabled={uploading || ready === 0}>
              {uploading ? "Uploading…" : `Upload ${ready} file${ready !== 1 ? "s" : ""}`}
            </button>
            <button className="ghost" onClick={() => setQueue([])} disabled={uploading}>
              Clear all
            </button>
            <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              {done > 0 && <span style={{ color: "var(--ok)", marginRight: 12 }}>✓ {done} done</span>}
              {errored > 0 && <span style={{ color: "var(--error)" }}>✗ {errored} failed</span>}
            </span>
          </div>

          <div className="dam-upload-queue">
            {queue.map(item => (
              <div key={item.id} className={`dam-upload-item${item.state === "error" ? " error" : item.state === "done" || item.state === "processing" ? " done" : ""}`}>
                {/* File info */}
                <div className="dam-upload-header">
                  <span className={`badge badge-${item.assetType}`}>
                    {item.assetType === "image" ? "🖼 Image" : "🎬 Video"}
                  </span>
                  <span className="dam-upload-filename">{item.file.name}</span>
                  <span className="dam-upload-size">{fmt(item.file.size)}</span>
                  <button
                    className="ghost"
                    style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                    onClick={() => removeItem(item.id)}
                    disabled={uploading}
                  >✕</button>
                </div>

                {/* Metadata form */}
                {item.state === "queued" || item.state === "error" ? (
                  <div className="dam-upload-meta">
                    <div className="dam-meta-field">
                      <label>SKU *</label>
                      <input
                        value={item.sku}
                        onChange={e => updateItem(item.id, { sku: e.target.value.toUpperCase() })}
                        placeholder="VARIATION_SKU"
                        style={{ fontFamily: "monospace", textTransform: "uppercase" }}
                      />
                    </div>
                    <div className="dam-meta-field">
                      <label>Brand</label>
                      <select
                        className="select"
                        value={item.brand}
                        onChange={e => updateItem(item.id, { brand: e.target.value as Brand })}
                      >
                        {BRANDS.map(b => <option key={b}>{b}</option>)}
                      </select>
                    </div>
                    <div className="dam-meta-field">
                      <label>Captured</label>
                      <input
                        type="date"
                        value={item.capturedAt}
                        onChange={e => updateItem(item.id, { capturedAt: e.target.value })}
                        className="select"
                      />
                    </div>
                    <div className="dam-meta-field" style={{ gridColumn: "1 / -1" }}>
                      <label>Notes</label>
                      <input
                        value={item.notes}
                        onChange={e => updateItem(item.id, { notes: e.target.value })}
                        placeholder="Optional notes…"
                      />
                    </div>
                    {item.error && (
                      <div style={{ gridColumn: "1 / -1", color: "var(--error)", fontSize: "0.88rem" }}>
                        ✗ {item.error}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Progress / status */
                  <div style={{ padding: "10px 0 4px" }}>
                    {item.state === "uploading" && (
                      <>
                        <div className="progress-track" style={{ marginBottom: 6 }}>
                          <div className="progress-fill" style={{ width: `${item.progress}%` }} />
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Uploading… {item.progress}%</div>
                      </>
                    )}
                    {item.state === "processing" && (
                      <div style={{ color: "var(--accent-2)", fontSize: "0.9rem" }}>
                        ⏳ Processing by Cloudflare Stream — you'll see it in the library once ready.
                      </div>
                    )}
                    {item.state === "done" && (
                      <div style={{ color: "var(--ok)", fontSize: "0.9rem" }}>✓ Uploaded successfully</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {queue.length === 0 && (
        <div className="status" style={{ textAlign: "center", padding: 32 }}>
          No files queued yet. Drop files above to get started.
        </div>
      )}
    </main>
  );
}
