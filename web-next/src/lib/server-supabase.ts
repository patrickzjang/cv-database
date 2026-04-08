export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function requireServerConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
}

export function parseCount(header: string | null): number {
  if (!header) return 0;
  const parts = header.split("/");
  if (parts.length !== 2) return 0;
  const total = Number(parts[1]);
  return Number.isNaN(total) ? 0 : total;
}

export function encodeIlike(value: string) {
  return `${value}%`;
}

export function buildInFilter(values: string[]): string {
  const escaped = values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`);
  return `in.(${escaped.join(",")})`;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function supabaseRestGet(
  path: string,
  searchParams?: URLSearchParams,
  options?: { count?: "exact" | "planned" | "none" }
) {
  const countMode = options?.count ?? "none";
  const url = `${SUPABASE_URL}/rest/v1/${path}${searchParams ? `?${searchParams.toString()}` : ""}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (countMode !== "none") {
    headers.Prefer = `count=${countMode}`;
  }
  const res = await fetch(url, {
    headers,
    cache: "no-store",
  });

  const raw = await res.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (!res.ok) throw new Error(raw);
      throw new Error("Unexpected non-JSON response from API");
    }
  }

  if (!res.ok) {
    const message = typeof data === "object" && data && "message" in data
      ? String((data as { message?: unknown }).message || res.statusText)
      : raw || res.statusText;
    throw new Error(message);
  }

  return { data, count: countMode === "none" ? 0 : parseCount(res.headers.get("content-range")) };
}
