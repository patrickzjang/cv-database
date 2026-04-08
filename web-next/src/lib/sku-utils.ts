/**
 * Derive VARIATION_SKU from ITEM_SKU.
 * - DAYBREAK (DB): dash-separated, strip trailing size segments
 * - PAN/HEELCARE/ARENA: PARENTS_SKU(7 chars) + color(2 chars) = first 9 chars
 */
export function deriveVariationSku(
  brand: string,
  itemSku: string,
  parentsSku: string,
): string {
  if (!itemSku) return "";

  // DAYBREAK uses dash-separated format
  if (brand === "DB") {
    return itemSku
      .replace(/(-\d{1,2}){1,2}$/, "")    // strip -36 or -27-28
      .replace(/-(0[SML]|XL|2L|00)$/, ""); // strip -0S, -0M, -0L, -XL, -2L, -00
  }

  // PAN, HC, AN: PARENTS_SKU + first 2 chars of suffix (color code)
  if (parentsSku && itemSku.length >= parentsSku.length + 2) {
    return parentsSku + itemSku.slice(parentsSku.length, parentsSku.length + 2);
  }

  // Fallback: first 9 chars (legacy behavior)
  return itemSku.slice(0, 9);
}

/** Extract size portion from ITEM_SKU given VARIATION_SKU */
export function extractSize(itemSku: string, variationSku: string): string {
  if (!itemSku || !variationSku) return "";
  const suffix = itemSku.slice(variationSku.length);
  // Remove leading dash for DAYBREAK format
  return suffix.replace(/^-/, "");
}

/**
 * Derive SIZE from ITEM_SKU using regex — replicates Google Sheet formula:
 * REGEXEXTRACT(ITEM_SKU, "F$|S$|M$|L$|XL$|2XL$|3XL$|...|\\d{2}$")
 *
 * Matches from the END of the SKU string. Order matters:
 * longer patterns first to avoid partial matches (e.g. 4XL before XL).
 */
export function deriveSize(itemSku: string): string {
  if (!itemSku) return "";
  // Try patterns from longest to shortest to avoid partial matches
  const match = itemSku.match(
    /(?:4XL|3XL|2XL|XL|F|S|M|L|9\.5|8\.5|7\.5|6\.5|5\.5|4\.5|3\.5|2\.5|1\.5|\d{2}|\d)$/
  );
  return match ? match[0] : "";
}

/** Brand code to full name mapping */
export const BRAND_MAP: Record<string, string> = {
  DB: "DAYBREAK",
  JN: "PAN",    // JN = Junior PAN, but stored under PAN brand
  PN: "PAN",
  HC: "HEELCARE",
  AN: "ARENA",
};

/** Full brand name to table mapping */
export const BRAND_TABLE: Record<string, string> = {
  DAYBREAK: "core.master_daybreak",
  PAN: "core.master_pan",
  HEELCARE: "core.master_heelcare",
  ARENA: "core.master_arena",
};
