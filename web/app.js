import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SKU_TABLE,
  SKU_COLUMN,
  BUCKET,
  MAX_BYTES,
  PRODUCT_VIEW,
  VARIATION_COLUMN,
  BRAND_VIEWS,
} from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const clearBtn = document.getElementById("clearBtn");
const fileList = document.getElementById("fileList");
const statusBox = document.getElementById("status");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const exportBtn = document.getElementById("exportBtn");
const searchStatus = document.getElementById("searchStatus");
const resultsBox = document.getElementById("results");
const pageSizeSelect = document.getElementById("pageSize");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const pageInfo = document.getElementById("pageInfo");
const modal = document.getElementById("modal");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalClose = document.getElementById("modalClose");
const modalBody = document.getElementById("modalBody");
const tabUpload = document.getElementById("tabUpload");
const tabSearch = document.getElementById("tabSearch");
const panelUpload = document.getElementById("panelUpload");
const panelSearch = document.getElementById("panelSearch");
const brandTabs = document.querySelectorAll(".brand-tab");

let files = [];
let lastResults = [];
let lastImageMap = new Map();
let lastCount = 0;
let currentPage = 1;
let currentBrand = "PAN";

function setStatus(msg) {
  statusBox.textContent = msg;
}

function isJpg(file) {
  return file.type === "image/jpeg" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg");
}

function parseSku(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const idx = base.lastIndexOf("_");
  if (idx === -1) return null;
  const sku = base.slice(0, idx).trim();
  if (!sku) return null;
  return sku;
}

function renderList() {
  fileList.innerHTML = "";
  for (const item of files) {
    const li = document.createElement("li");
    li.className = `file-item ${item.state}`;
    li.innerHTML = `<div class="name">${item.file.name}</div><div class="status">${item.message}</div>`;
    fileList.appendChild(li);
  }
  const hasFiles = files.length > 0;
  uploadBtn.disabled = !hasFiles;
  clearBtn.disabled = !hasFiles;
}

function addFiles(selected) {
  for (const file of selected) {
    const sku = parseSku(file.name);
    let message = "Ready";
    let state = "";

    if (!isJpg(file)) {
      message = "Only JPG allowed";
      state = "error";
    } else if (file.size > MAX_BYTES) {
      message = "Over 2MB";
      state = "error";
    } else if (!sku) {
      message = "Name must be SKU_*.jpg";
      state = "error";
    }

    files.push({ file, sku, message, state, uploaded: false });
  }

  renderList();
}

function clearAll() {
  files = [];
  renderList();
  setStatus("Waiting for files.");
}

async function skuExists(sku) {
  const viewName = BRAND_VIEWS[currentBrand] || PRODUCT_VIEW;
  const [schemaName, tableName] = viewName.includes(".")
    ? viewName.split(".")
    : [null, viewName];

  const query = schemaName
    ? supabase.schema(schemaName).from(tableName)
    : supabase.from(tableName);

  const { data, error } = await query
    .select(SKU_COLUMN)
    .eq(SKU_COLUMN, sku)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`SKU check failed: ${error.message}`);
  return Boolean(data);
}

async function uploadFile(item) {
  if (item.state === "error") return;

  item.message = "Checking SKU...";
  item.state = "";
  renderList();

  const exists = await skuExists(item.sku);
  if (!exists) {
    item.message = `SKU not found (${item.sku})`;
    item.state = "error";
    renderList();
    return;
  }

  item.message = "Uploading...";
  renderList();

  const path = `${currentBrand}/${item.sku}/${item.file.name}`;
  const { error } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, item.file, { upsert: true, contentType: "image/jpeg" });

  if (error) {
    item.message = `Upload failed: ${error.message}`;
    item.state = "error";
    renderList();
    return;
  }

  // Update product_images in DB via edge function
  try {
    const { error: fnError } = await supabase.functions.invoke("update_product_images", {
      body: { variation_sku: item.sku, paths: [path], bucket: BUCKET, brand: currentBrand },
    });
    if (fnError) {
      item.message = `Uploaded (DB update failed: ${fnError.message})`;
      item.state = "error";
      renderList();
      return;
    }
  } catch (e) {
    item.message = "Uploaded (DB update failed)";
    item.state = "error";
    renderList();
    return;
  }

  item.message = "Uploaded";
  item.state = "ok";
  item.uploaded = true;
  renderList();
}

async function uploadAll() {
  setStatus("Uploading...");
  for (const item of files) {
    try {
      await uploadFile(item);
    } catch (err) {
      item.message = err.message ?? "Unexpected error";
      item.state = "error";
      renderList();
    }
  }
  setStatus("Done.");
}

function setSearchStatus(msg) {
  searchStatus.textContent = msg;
}

function renderResults(rows, imageMap) {
  resultsBox.innerHTML = "";
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]).filter((h) => h !== "product_images");
  const table = document.createElement("table");
  table.className = "results-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  }
  const thPic = document.createElement("th");
  thPic.textContent = "PROD_JPG";
  headRow.appendChild(thPic);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const h of headers) {
      const td = document.createElement("td");
      const value = row[h];
      td.textContent = value === null || value === undefined ? "" : String(value);
      tr.appendChild(td);
    }

    const tdPic = document.createElement("td");
    tdPic.className = "thumb-wrap";
    const variation = row[VARIATION_COLUMN] ?? "";
    const images = imageMap.get(String(variation)) || [];

    if (images.length > 0) {
      const img = images.find((i) => /_out\./i.test(i.name)) || images[0];
      const imageEl = document.createElement("img");
      imageEl.src = img.url;
      imageEl.alt = img.name;
      imageEl.className = "thumb";
      imageEl.style.cursor = "pointer";
      imageEl.addEventListener("click", () => openModal(variation, images));

      const dropdown = document.createElement("div");
      dropdown.className = "dropdown";

      const dropBtn = document.createElement("button");
      dropBtn.className = "ghost dropdown-btn";
      dropBtn.textContent = "Download ▾";
      dropBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("open");
      });

      const menu = document.createElement("div");
      menu.className = "dropdown-menu";

      const dlFirst = document.createElement("button");
      dlFirst.textContent = "Download first image";
      dlFirst.addEventListener("click", () => {
        dropdown.classList.remove("open");
        downloadUrl(img.url, img.name);
      });

      const dlAll = document.createElement("button");
      dlAll.textContent = "Download all images";
      dlAll.addEventListener("click", () => {
        dropdown.classList.remove("open");
        downloadAll(images);
      });

      menu.appendChild(dlFirst);
      menu.appendChild(dlAll);
      dropdown.appendChild(dropBtn);
      dropdown.appendChild(menu);

      tdPic.appendChild(imageEl);
      tdPic.appendChild(dropdown);
    } else {
      tdPic.textContent = "—";
    }

    tr.appendChild(tdPic);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  resultsBox.appendChild(table);
}

function openModal(variation, images) {
  modal.classList.remove("hidden");
  modalBody.innerHTML = "";
  const title = document.getElementById("modalTitle");
  title.textContent = `Images for ${variation}`;

  const actions = document.createElement("div");
  actions.style.marginBottom = "10px";
  const dlAllTop = document.createElement("button");
  dlAllTop.className = "ghost";
  dlAllTop.textContent = "Download all images";
  dlAllTop.addEventListener("click", () => downloadAll(images));
  actions.appendChild(dlAllTop);
  modalBody.appendChild(actions);

  const grid = document.createElement("div");
  grid.className = "thumb-grid";

  for (const img of images) {
    const card = document.createElement("div");
    card.className = "thumb-card";

    const imageEl = document.createElement("img");
    imageEl.src = img.url;
    imageEl.alt = img.name;
    imageEl.className = "thumb";

    const name = document.createElement("div");
    name.textContent = img.name;

    const dl = document.createElement("button");
    dl.className = "ghost";
    dl.textContent = "Download";
    dl.addEventListener("click", () => downloadUrl(img.url, img.name));

    card.appendChild(imageEl);
    card.appendChild(name);
    card.appendChild(dl);
    grid.appendChild(card);
  }

  modalBody.appendChild(grid);
}

function closeModal() {
  modal.classList.add("hidden");
}

async function downloadUrl(url, filename) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "image.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (e) {
    alert("Download failed. Please try again.");
  }
}

async function downloadAll(images) {
  if (!images || images.length === 0) return;
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    await downloadUrl(img.url, img.name);
    // small delay to reduce browser block on multiple downloads
    await new Promise((r) => setTimeout(r, 300));
  }
}

function toCsv(rows, imageMap) {
  if (!rows || rows.length === 0) return "";
  const headers = [
    ...Object.keys(rows[0]).filter((h) => h !== "product_images"),
    "PROD_JPG",
  ];
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [
    headers.map(esc).join(","),
    ...rows.map((r) => {
      const variation = r[VARIATION_COLUMN];
      const images = imageMap.get(String(variation)) || [];
      const firstUrl = images[0]?.url ?? "";
      return headers.map((h) => {
        if (h === "PROD_JPG") return esc(firstUrl);
        return esc(r[h]);
      }).join(",");
    }),
  ];
  return lines.join("\n");
}

function downloadCsv(rows, imageMap) {
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
}

async function runSearch() {
  const q = (searchInput.value || "").trim();
  const pageSize = Number(pageSizeSelect.value || 100);
  const from = (currentPage - 1) * pageSize;
  const to = from + pageSize - 1;

  setSearchStatus("Searching...");
  resultsBox.innerHTML = "";
  exportBtn.disabled = true;
  lastResults = [];
  lastCount = 0;

  const viewName = BRAND_VIEWS[currentBrand] || PRODUCT_VIEW;
  const [schemaName, tableName] = viewName.includes(".")
    ? viewName.split(".")
    : [null, viewName];

  const productQuery = schemaName
    ? supabase.schema(schemaName).from(tableName)
    : supabase.from(tableName);

  let query = productQuery.select("*", { count: "exact" });
  if (q) {
    query = query.ilike(VARIATION_COLUMN, `${q}%`);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    setSearchStatus(`Search failed: ${error.message}`);
    return;
  }

  lastResults = data || [];
  lastCount = count || 0;
  exportBtn.disabled = lastResults.length === 0;

  const imageMap = new Map();
  for (const row of lastResults) {
    const sku = row[VARIATION_COLUMN];
    if (!sku) continue;
    const imgs = row.product_images;
    if (Array.isArray(imgs)) {
      imageMap.set(String(sku), imgs.map((url) => ({ name: url.split("/").pop() || url, url })));
    } else {
      imageMap.set(String(sku), []);
    }
  }

  lastImageMap = imageMap;
  renderResults(lastResults, imageMap);
  setSearchStatus(`${lastCount} result(s).`);

  const totalPages = Math.max(1, Math.ceil(lastCount / pageSize));
  pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

// Drag/drop
["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove("dragover");
  });
});

 dropzone.addEventListener("drop", (e) => {
  const dropped = Array.from(e.dataTransfer.files || []);
  addFiles(dropped);
  setStatus(`${dropped.length} file(s) added.`);
 });

fileInput.addEventListener("change", (e) => {
  const selected = Array.from(e.target.files || []);
  addFiles(selected);
  setStatus(`${selected.length} file(s) added.`);
});

uploadBtn.addEventListener("click", () => {
  uploadAll();
});

clearBtn.addEventListener("click", () => {
  clearAll();
});

searchBtn.addEventListener("click", () => {
  currentPage = 1;
  runSearch();
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    currentPage = 1;
    runSearch();
  }
});

exportBtn.addEventListener("click", () => {
  downloadCsv(lastResults, lastImageMap);
});

pageSizeSelect.addEventListener("change", () => {
  currentPage = 1;
  runSearch();
});

prevPageBtn.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage -= 1;
    runSearch();
  }
});

nextPageBtn.addEventListener("click", () => {
  const pageSize = Number(pageSizeSelect.value || 100);
  const totalPages = Math.max(1, Math.ceil(lastCount / pageSize));
  if (currentPage < totalPages) {
    currentPage += 1;
    runSearch();
  }
});

modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

document.addEventListener("click", () => {
  document.querySelectorAll(".dropdown.open").forEach((el) => {
    el.classList.remove("open");
  });
});

function setActiveTab(tab) {
  const isUpload = tab === "upload";
  tabUpload.classList.toggle("active", isUpload);
  tabSearch.classList.toggle("active", !isUpload);
  panelUpload.classList.toggle("active", isUpload);
  panelSearch.classList.toggle("active", !isUpload);
}

tabUpload.addEventListener("click", () => setActiveTab("upload"));
tabSearch.addEventListener("click", () => setActiveTab("search"));

brandTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    brandTabs.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentBrand = btn.getAttribute("data-brand") || "PAN";
    currentPage = 1;
    setSearchStatus("No search yet.");
    resultsBox.innerHTML = "";
  });
});
