import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callJst, extractListFromData, readPositiveInt, toUnixSeconds } from "../_shared/jst-client.ts";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const WINDOW_HOURS = readPositiveInt("SYNC_WINDOW_HOURS", 24);
const PAGE_SIZE = readPositiveInt("SYNC_PAGE_SIZE", 100);
const MAX_PAGES = readPositiveInt("SYNC_MAX_PAGES", 1000);

// ---------- MAIN ----------
serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const dbErrors: string[] = [];

  try {
    // 1) Read sync state
    const stateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_inventory")
      .select("id, last_synced_at")
      .eq("id", 1)
      .maybeSingle();

    if (stateResp.error) {
      dbErrors.push(`sync_state_inventory select: ${stateResp.error.message}`);
    }
    if (!stateResp.data) {
      throw new Error("sync_state_inventory row id=1 not found");
    }

    const fromTime = new Date(stateResp.data.last_synced_at);
    const now = new Date();

    const windowMs = WINDOW_HOURS * 60 * 60 * 1000;
    const toTimeMs = Math.min(fromTime.getTime() + windowMs, now.getTime());
    const toTime = new Date(toTimeMs);

    if (toTime <= fromTime) {
      return new Response(JSON.stringify({ message: "no new window" }), {
        status: 200,
      });
    }

    // 2) Paginate GetSkuinventorys
    let pageIndex = 1;
    let pagesFetched = 0;
    let totalInserted = 0;
    const fromUnix = toUnixSeconds(fromTime);
    const toUnix = toUnixSeconds(toTime);

    while (true) {
      if (pagesFetched >= MAX_PAGES) {
        throw new Error(`GetSkuinventorys exceeded MAX_PAGES=${MAX_PAGES}`);
      }

      const body = {
        requestModel: {
          modifiedBegin: fromUnix,
          modifiedEnd: toUnix,
        },
        dataPage: {
          pageSize: PAGE_SIZE,
          pageIndex,
        },
      };

      const json = await callJst("/api/Inventory/GetSkuinventorys", body);
      const list = extractListFromData(json);
      pagesFetched += 1;

      console.log(
        `GetSkuinventorys ${fromTime.toISOString()} - ${toTime.toISOString()}, page ${pageIndex}, got ${list.length}`,
      );

      if (!Array.isArray(list) || list.length === 0) break;

      // 3) Map to inventory_raw rows
      // JST actual fields: skuId, itemId, qty, orderLock, defectiveQty, returnQty, purchaseQty, virtualQty
      const rows = list.map((inv: any) => ({
        sku_id:         inv.skuId ?? inv.sku_id ?? "",
        sku_code:       inv.skuCode ?? inv.skuId ?? "",
        item_id:        inv.itemId ?? inv.item_id ?? "",
        item_name:      inv.itemName ?? inv.item_name ?? null,
        warehouse_id:   inv.warehouseId ?? inv.warehouse_id ?? 0,
        warehouse_name: inv.warehouseName ?? inv.warehouse_name ?? null,
        available_qty:  inv.qty ?? inv.availableQty ?? 0,
        actual_qty:     (inv.qty ?? 0) + (inv.orderLock ?? 0),
        defective_qty:  inv.defectiveQty ?? inv.defective_qty ?? 0,
        locked_qty:     inv.orderLock ?? inv.lockedQty ?? 0,
        cost_price:     inv.costPrice ?? inv.cost_price ?? null,
        raw_json:       inv,
        synced_at:      now.toISOString(),
      }));

      // 4) Upsert on (sku_id, warehouse_id)
      const upsertResp = await supabase
        .schema("jst_raw")
        .from("inventory_raw")
        .upsert(rows, { onConflict: "sku_id,warehouse_id" });

      if (upsertResp.error) {
        throw new Error(`upsert inventory_raw: ${upsertResp.error.message}`);
      }

      totalInserted += rows.length;

      if (list.length < PAGE_SIZE) break;
      pageIndex += 1;
    }

    // 5) Daily snapshot: insert into inventory_history if today's snapshot doesn't exist
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

    const snapshotCheck = await supabase
      .schema("jst_raw")
      .from("inventory_history")
      .select("id")
      .eq("snapshot_date", today)
      .limit(1)
      .maybeSingle();

    if (!snapshotCheck.data) {
      console.log(`No snapshot for ${today} yet, creating inventory_history snapshot...`);

      // Read all current inventory_raw rows for the snapshot
      const { data: currentInventory, error: invError } = await supabase
        .schema("jst_raw")
        .from("inventory_raw")
        .select("sku_id, sku_code, item_id, item_name, warehouse_id, warehouse_name, available_qty, actual_qty, defective_qty, locked_qty, cost_price");

      if (invError) {
        dbErrors.push(`inventory_raw select for snapshot: ${invError.message}`);
      } else if (currentInventory && currentInventory.length > 0) {
        const historyRows = currentInventory.map((r: any) => ({
          snapshot_date:  today,
          sku_id:         r.sku_id,
          sku_code:       r.sku_code,
          item_id:        r.item_id,
          item_name:      r.item_name,
          warehouse_id:   r.warehouse_id,
          warehouse_name: r.warehouse_name,
          available_qty:  r.available_qty,
          actual_qty:     r.actual_qty,
          defective_qty:  r.defective_qty,
          locked_qty:     r.locked_qty,
          cost_price:     r.cost_price,
        }));

        // Insert in batches to avoid payload limits
        const BATCH_SIZE = 500;
        for (let i = 0; i < historyRows.length; i += BATCH_SIZE) {
          const batch = historyRows.slice(i, i + BATCH_SIZE);
          const histResp = await supabase
            .schema("jst_raw")
            .from("inventory_history")
            .insert(batch);

          if (histResp.error) {
            dbErrors.push(`insert inventory_history batch: ${histResp.error.message}`);
          }
        }

        console.log(`Inserted ${historyRows.length} inventory_history rows for ${today}`);
      }
    } else {
      console.log(`Snapshot for ${today} already exists, skipping.`);
    }

    // 6) Update sync state -- only on success
    const updateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_inventory")
      .update({ last_synced_at: toTime.toISOString() })
      .eq("id", 1);

    if (updateResp.error) {
      dbErrors.push(`update sync_state_inventory: ${updateResp.error.message}`);
    }

    return new Response(
      JSON.stringify({
        message: "inventory sync done",
        fromTime,
        toTime,
        pagesFetched,
        totalInserted,
        snapshotDate: today,
        dbErrors,
      }),
      { status: 200 },
    );
  } catch (e) {
    console.error("EDGE_FN_FATAL_INVENTORY", e);
    let msg = "unknown error";
    if (e && typeof e === "object" && "message" in e) {
      msg = String((e as any).message);
    } else {
      msg = String(e);
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
