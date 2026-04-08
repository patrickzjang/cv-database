import { createHash } from "crypto";

// ---------- ENV ----------
const JST_BASE_URL = process.env.JST_BASE_URL!;
const JST_APP_KEY = process.env.JST_APP_KEY!;
const JST_APP_SECRET = process.env.JST_APP_SECRET!;
const JST_ACCESS_TOKEN = process.env.JST_ACCESS_TOKEN!;
const JST_COMPANY_ID = process.env.JST_COMPANY_ID!;

// ---------- UTIL ----------
function md5(input: string): string {
  return createHash("md5").update(input).digest("hex").toLowerCase();
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
