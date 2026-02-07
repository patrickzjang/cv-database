# Product Image Uploader (web)

## What it does
- Drag & drop JPG files named like `SKU_1.jpg`, `SKU_2.jpg`.
- Validates size (<=2MB) and naming pattern.
- Checks SKU exists in `core.product`.
- Uploads to Supabase Storage path `SKU/filename`.

## Setup
1. Create a Storage bucket named `product-images` (or change `BUCKET` in `config.js`).
2. Update `/Users/pluem/jst-sync/web/config.js` with your Supabase URL and anon key.
3. Confirm `SKU_TABLE` and `SKU_COLUMN` match your schema.

## Local run (simple)
Open `index.html` in a browser.

If your browser blocks local module imports, serve the folder:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173

## Storage policy (example)
The UI uses the anon key. You must allow `select` on `core.product` and allow uploads to the bucket.

Example policies (adjust to your security requirements):

```sql
-- Allow anon read of SKU table (required for SKU check)
create policy "allow anon read products"
  on core.product
  for select
  to anon
  using (true);

-- Allow anon upload to a specific bucket
create policy "allow anon uploads to product-images"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'product-images');

-- (Optional) allow anon read public images
create policy "allow anon read product-images"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'product-images');
```

If you want stronger security later, we can add authentication and remove anon access.
