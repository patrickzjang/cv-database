import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";

const SCHEMA = "public";

function damHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    "Accept-Profile": SCHEMA,
    "Content-Profile": SCHEMA,
    ...extra,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssetType = "image" | "video";
export type AssetStatus = "pending" | "processing" | "ready" | "approved" | "archived";
export type StreamStatus = "pendingupload" | "waiting" | "processing" | "ready" | "error";

export interface DamAsset {
  id: string;
  sku: string;
  brand: string;
  asset_type: AssetType;
  raw_bucket: string | null;
  raw_path: string | null;
  raw_filename: string | null;
  raw_mime_type: string | null;
  raw_size_bytes: number | null;
  web_bucket: string | null;
  web_path: string | null;
  thumbnail_path: string | null;
  stream_uid: string | null;
  stream_status: StreamStatus | null;
  stream_hls_url: string | null;
  stream_thumbnail_url: string | null;
  duration_sec: number | null;
  width_px: number | null;
  height_px: number | null;
  status: AssetStatus;
  title: string | null;
  notes: string | null;
  captured_at: string | null;
  tags: string[];
  uploaded_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateAssetInput = Omit<DamAsset, "id" | "created_at" | "updated_at">;
export type UpdateAssetInput = Partial<Omit<DamAsset, "id" | "created_at">>;

// ─── Assets CRUD ─────────────────────────────────────────────────────────────

export async function listAssets(filters: {
  brand?: string;
  asset_type?: AssetType;
  status?: AssetStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: DamAsset[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const size = Math.min(100, filters.pageSize ?? 48);
  const from = (page - 1) * size;
  const to   = from + size - 1;

  const params = new URLSearchParams();
  params.set("order", "created_at.desc");

  if (filters.brand)      params.set("brand",      `eq.${filters.brand.toUpperCase()}`);
  if (filters.asset_type) params.set("asset_type",  `eq.${filters.asset_type}`);
  if (filters.status)     params.set("status",      `eq.${filters.status}`);
  if (filters.q)          params.set("sku",          `ilike.${filters.q.trim()}%`);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dam_assets?${params.toString()}`,
    {
      headers: {
        ...damHeaders({ Prefer: "count=exact" }),
        Range: `${from}-${to}`,
        "Range-Unit": "items",
      },
      cache: "no-store",
    }
  );

  if (!res.ok) throw new Error(await res.text());

  const raw = res.headers.get("content-range") ?? "";
  const total = raw.includes("/") ? Number(raw.split("/")[1]) || 0 : 0;
  const data  = (await res.json()) as DamAsset[];
  return { data, total };
}

export async function getAsset(id: string): Promise<DamAsset | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dam_assets?id=eq.${id}&limit=1`,
    { headers: damHeaders(), cache: "no-store" }
  );
  if (!res.ok) throw new Error(await res.text());
  const rows = (await res.json()) as DamAsset[];
  return rows[0] ?? null;
}

export async function createAsset(input: CreateAssetInput): Promise<DamAsset> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dam_assets`, {
    method: "POST",
    headers: damHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  const rows = (await res.json()) as DamAsset[];
  return rows[0];
}

export async function updateAsset(id: string, patch: UpdateAssetInput): Promise<DamAsset> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dam_assets?id=eq.${id}`, {
    method: "PATCH",
    headers: damHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  const rows = (await res.json()) as DamAsset[];
  return rows[0];
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function logEvent(
  assetId: string,
  event: string,
  actor: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/dam_asset_events`, {
    method: "POST",
    headers: damHeaders(),
    body: JSON.stringify({ asset_id: assetId, event, actor, metadata }),
  });
}

export async function getAssetEvents(assetId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dam_asset_events?asset_id=eq.${assetId}&order=created_at.asc`,
    { headers: damHeaders(), cache: "no-store" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
