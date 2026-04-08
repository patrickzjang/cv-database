import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callJst, extractListFromData, readPositiveInt, toUnixSeconds } from "../_shared/jst-client.ts";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const WINDOW_HOURS = readPositiveInt("SYNC_WINDOW_HOURS", 24);
const PAGE_SIZE = readPositiveInt("SYNC_PAGE_SIZE", 500);
const MAX_PAGES = readPositiveInt("SYNC_MAX_PAGES", 1000);

// ---------- WAREHOUSE MAP ----------
const WAREHOUSES = [
  { id: 14132, name: "WICE_BA_A" },
  { id: 14421, name: "WICE_PAF_A" },
  { id: 14419, name: "WICE_WBLP_A" },
  { id: 14422, name: "WICE_WBLP_B" },
];

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

    let totalInserted = 0;
    let totalPagesFetched = 0;
    const warehouseResults: Record<string, number> = {};

    // If total gap > 3 days, iterate month-by-month for full catch-up
    const gapDays = (now.getTime() - fromTime.getTime()) / (1000 * 60 * 60 * 24);
    const isFullSync = gapDays > 3;

    // Build time windows
    const windows: { from: Date; to: Date }[] = [];
    if (isFullSync) {
      console.log(`Full sync mode (gap=${gapDays.toFixed(1)} days) — iterating month-by-month from 2024`);
      let cursor = new Date("2024-01-01T00:00:00Z");
      while (cursor < now) {
        const nextMonth = new Date(cursor);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const windowEnd = nextMonth > now ? now : nextMonth;
        windows.push({ from: cursor, to: windowEnd });
        cursor = nextMonth;
      }
    } else {
      windows.push({ from: fromTime, to: toTime });
    }

    // 2) GetWarehouseSkuInventorys per warehouse × per time window
    for (const wh of WAREHOUSES) {
      let whInserted = 0;

      for (const win of windows) {
        let pageIndex = 1;
        const wFromUnix = toUnixSeconds(win.from);
        const wToUnix = toUnixSeconds(win.to);

        while (true) {
          if (totalPagesFetched >= MAX_PAGES) {
            console.warn(`Reached MAX_PAGES=${MAX_PAGES}, stopping`);
            break;
          }

          const body = {
            requestModel: {
              warehouseId: wh.id,
              modifiedBegin: wFromUnix,
              modifiedEnd: wToUnix,
            },
            dataPage: {
              pageSize: PAGE_SIZE,
              pageIndex,
            },
          };

          let json: any;
          try {
            json = await callJst("/api/Inventory/GetWarehouseSkuInventorys", body);
          } catch (e: any) {
            console.error(`GetWarehouseSkuInventorys failed for WH=${wh.name}: ${e.message}`);
            dbErrors.push(`WH=${wh.name}: ${e.message}`);
            break;
          }

          const list = extractListFromData(json);
          totalPagesFetched += 1;

          if (pageIndex === 1 && list.length > 0) {
            console.log(`WH=${wh.name} ${win.from.toISOString().slice(0,7)} page ${pageIndex}, got ${list.length}`);
          }

          if (!Array.isArray(list) || list.length === 0) break;

          const rows = list.map((inv: any) => ({
            sku_id:         String(inv.skuId ?? inv.sku_id ?? ""),
            sku_code:       String(inv.skuCode ?? inv.skuId ?? ""),
            item_id:        String(inv.itemId ?? inv.item_id ?? ""),
            item_name:      inv.itemName ?? inv.skuName ?? inv.item_name ?? null,
            warehouse_id:   inv.wmsCoId ?? inv.warehouseId ?? wh.id,
            warehouse_name: inv.wmsCoName ?? inv.warehouseName ?? wh.name,
            available_qty:  inv.qty ?? inv.availableQty ?? 0,
            actual_qty:     (inv.qty ?? 0) + (inv.orderLock ?? 0),
            defective_qty:  inv.defectiveQty ?? inv.defective_qty ?? 0,
            locked_qty:     inv.orderLock ?? inv.lockedQty ?? 0,
            cost_price:     inv.costPrice ?? inv.cost_price ?? null,
            raw_json:       inv,
            synced_at:      now.toISOString(),
          }));

          const upsertResp = await supabase
            .schema("jst_raw")
            .from("inventory_raw")
            .upsert(rows, { onConflict: "sku_id,warehouse_id" });

          if (upsertResp.error) {
            throw new Error(`upsert inventory_raw WH=${wh.name}: ${upsertResp.error.message}`);
          }

          whInserted += rows.length;
          totalInserted += rows.length;

          if (list.length < PAGE_SIZE) break;
          pageIndex += 1;
        }
      }

      warehouseResults[wh.name] = whInserted;
      console.log(`WH=${wh.name}: ${whInserted} rows synced`);
    }

    // 3) Daily snapshot
    const today = now.toISOString().slice(0, 10);

    const snapshotCheck = await supabase
      .schema("jst_raw")
      .from("inventory_history")
      .select("id")
      .eq("snapshot_date", today)
      .limit(1)
      .maybeSingle();

    if (!snapshotCheck.data) {
      console.log(`No snapshot for ${today} yet, creating inventory_history snapshot...`);

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
    }

    // 4) Update sync state
    const updateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_inventory")
      .update({ last_synced_at: (isFullSync ? now : toTime).toISOString() })
      .eq("id", 1);

    if (updateResp.error) {
      dbErrors.push(`update sync_state_inventory: ${updateResp.error.message}`);
    }

    return new Response(
      JSON.stringify({
        message: "inventory sync done",
        fromTime,
        toTime,
        pagesFetched: totalPagesFetched,
        totalInserted,
        warehouseResults,
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
