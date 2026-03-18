# Master CSV Update Flow

Files are expected here with naming:

- `MASTER_PAN_DDMMYY.csv`
- `MASTER_ARENA_DDMMYY.csv`
- `MASTER_DAYBREAK_DDMMYY.csv`
- `MASTER_HEELCARE_DDMMYY.csv`

The updater will:

1. Pick the newest file per brand by filename date (`DDMMYY`)
2. Skip if date is not newer than the brand's last imported file
3. Normalize column `BEFORE VAT` to `CBV`
4. Replace data in each `core.master_<brand>` table
5. Preserve existing `product_images` by `ITEM_SKU`
6. Save import state to `.import-state.json`

## Required env vars

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Commands

Dry run (parse and report only):

```bash
npm run master:update:dry-run
```

Preview (parse + show sample rows and decision, no DB write):

```bash
npm run master:update:preview
```

Apply update:

```bash
npm run master:update
```
