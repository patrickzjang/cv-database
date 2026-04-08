/**
 * Resets sync state for both products and orders to the current time.
 * Use this when the sync is stuck far in the past and you want to
 * start syncing from now forward (skipping historical backfill).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/reset_sync_state.js
 *
 * Optional: pass a custom timestamp to reset to a specific point in time:
 *   RESET_TO="2026-01-01T00:00:00Z" node scripts/reset_sync_state.js
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESET_TO = process.env.RESET_TO || new Date().toISOString();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function resetTable(table) {
  const { error } = await supabase
    .schema("jst_raw")
    .from(table)
    .update({ last_synced_at: RESET_TO })
    .eq("id", 1);

  if (error) {
    console.error(`❌  ${table}: ${error.message}`);
  } else {
    console.log(`✅  ${table} → ${RESET_TO}`);
  }
}

(async () => {
  console.log(`Resetting sync state to: ${RESET_TO}\n`);
  await resetTable("sync_state_products");
  await resetTable("sync_state_orders");
  console.log("\nDone.");
})();
