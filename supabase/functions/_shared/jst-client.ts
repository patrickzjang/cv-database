import md5Lib from "https://esm.sh/blueimp-md5@2.19.0";

// ---------- ENV ----------
const JST_BASE_URL = Deno.env.get("JST_BASE_URL")!;
const JST_APP_KEY = Deno.env.get("JST_APP_KEY")!;
const JST_APP_SECRET = Deno.env.get("JST_APP_SECRET")!;
const JST_ACCESS_TOKEN = Deno.env.get("JST_ACCESS_TOKEN")!;
const JST_COMPANY_ID = Deno.env.get("JST_COMPANY_ID")!;

// ---------- UTIL ----------
function md5(input: string): string {
  return md5Lib(input).toLowerCase();
}

function buildSign(bodyString: string, ts: string): string {
  const signSource =
    "appkey=" + JST_APP_KEY +
    "&appsecret=" + JST_APP_SECRET +
    "&data=" + bodyString +
    "&accesstoken=" + JST_ACCESS_TOKEN +
    "&companyid=" + JST_COMPANY_ID +
    "&ts=" + ts;

  return md5(signSource);
}

export async function callJst(path: string, body: unknown) {
  const ts = Date.now().toString();
  const bodyString = JSON.stringify(body);
  const sign = buildSign(bodyString, ts);

  const res = await fetch(`${JST_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "companyid": JST_COMPANY_ID,
      "accesstoken": JST_ACCESS_TOKEN,
      "ts": ts,
      "sign": sign,
      "appkey": JST_APP_KEY,
      "appsecret": JST_APP_SECRET,
    },
    body: bodyString,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`JST ${path} HTTP error: ${res.status} ${txt}`);
  }

  const json = await res.json();
  if (json && typeof json === "object" && "errorCode" in json && (json as any).errorCode) {
    console.log(`JST ${path} error payload:`, JSON.stringify(json));
    throw new Error(
      `JST ${path} errorCode=${(json as any).errorCode}, message=${(json as any).message ?? ""}`,
    );
  }

  return json;
}

export function toUnixSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

export function extractListFromData(json: any): any[] {
  if (!json) return [];
  const data = (json as any).data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as any).list)) return (data as any).list;
  return [];
}

export function readPositiveInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`${name} is invalid: "${raw}", fallback to ${fallback}`);
    return fallback;
  }
  return parsed;
}

// ---------- PAGINATE ----------
export async function paginateJst(
  path: string,
  requestModel: Record<string, unknown>,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<any[]> {
  const pageSize = opts?.pageSize ?? 100;
  const maxPages = opts?.maxPages ?? 1000;
  const allItems: any[] = [];
  let pageIndex = 1;

  while (pageIndex <= maxPages) {
    const body = { requestModel, dataPage: { pageSize, pageIndex } };
    const json = await callJst(path, body);
    const list = extractListFromData(json);
    if (!Array.isArray(list) || list.length === 0) break;
    allItems.push(...list);
    if (list.length < pageSize) break;
    pageIndex++;
  }
  return allItems;
}
