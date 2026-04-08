# Master Data Refresh Runbook (PAN / ARENA / DAYBREAK / HEELCARE)

## 0) Put app in maintenance mode
- Set `MAINTENANCE_MODE=true` in your deployment env.
- Redeploy app.

## 1) Backup current data
Run:

```sql
\i supabase/sql/backup_core_master.sql
```

## 2) Apply schema + data refresh
- Open `supabase/sql/refresh_master_template.sql`
- Fill `TODO` sections with your exact column changes and load SQL
- Execute the file.

## 3) Validate
Run:

```sql
\i supabase/sql/post_refresh_checks.sql
```

Verify:
- Row counts per brand are expected
- No null/empty `VARIATION_SKU`
- Public views return data
- (Optional) function smoke tests pass with known SKU

## 4) Push grants migration (if not already applied)
From repo root:

```bash
supabase db push
```

Includes:
- `20260209000004_grant_service_role_master_select.sql`

## 5) Re-open app
- Set `MAINTENANCE_MODE=false`
- Redeploy app
- Test login/search/upload/download in UI
