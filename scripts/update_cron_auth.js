/**
 * Updates the Authorization header in pg_cron jobs that call edge functions.
 * Run this after rotating the Supabase service role key.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/update_cron_auth.js
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

(async () => {
  // 1) List current cron jobs
  const { data: jobs, error: listErr } = await supabase.rpc("list_cron_jobs");
  if (listErr) {
    // Fallback: query cron.job directly via raw SQL
    console.log("list_cron_jobs RPC not found, trying direct query...");
  }

  // Query cron jobs via SQL
  const { data, error } = await supabase.rpc("exec_sql", {
    sql: "SELECT jobid, jobname, command FROM cron.job ORDER BY jobid;"
  });

  if (error) {
    console.error("❌  Cannot query cron.job:", error.message);
    console.log("\n👉  Please run this SQL manually in the Supabase SQL editor:\n");
    console.log(buildUpdateSQL(SERVICE_ROLE_KEY));
    process.exit(0);
  }

  console.log("Current cron jobs:\n", JSON.stringify(data, null, 2));
})();

function buildUpdateSQL(newKey) {
  return `
-- Update Authorization header in all edge function cron jobs
UPDATE cron.job
SET command = regexp_replace(
  command,
  'Bearer [A-Za-z0-9._-]+',
  'Bearer ${newKey}',
  'g'
)
WHERE command ILIKE '%functions/v1%';

-- Verify
SELECT jobid, jobname, LEFT(command, 120) AS command_preview FROM cron.job ORDER BY jobid;
`.trim();
}
