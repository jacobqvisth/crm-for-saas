// Canonical shop_type values for `discovered_shops`.
// `shop_type` was added as the ICP classifier in the SE 'other' bucket cleanup
// migration (2026-05-06) — it's the source of truth for "is this an ICP fit",
// independent of Google Maps' `category` (which is missing on ~25% of rows).

// Note: `auto_glass` was in core ICP per the SE 'other' bucket cleanup PR's
// stated enrollment filter, but Jacob narrowed it on 2026-05-06 — pure auto
// glass shops (Carglass, Ryds Bilglas, etc.) aren't a fit for the mechanic-
// focused outreach. Shops that combo auto_body + auto_glass live under
// shop_type='auto_body' (or get caught by the `all_categories` overlap if
// future filters use that), so the combo cohort isn't lost.
export const CORE_ICP_SHOP_TYPES = [
  "auto_repair",
  "tire_combo",
  "auto_body",
] as const;

export const SHOP_TYPE_LABELS: Record<string, string> = {
  auto_repair: "Auto repair",
  auto_body: "Auto body",
  auto_glass: "Auto glass",
  tire_combo: "Tire + service",
  tire_only: "Tire only",
  dealer: "Dealer",
  truck_repair: "Truck repair",
  motorcycle: "Motorcycle",
  parts: "Parts",
  auto_specialty: "Auto specialty",
  non_auto_vehicle: "Non-auto vehicle",
  salvage: "Salvage",
  towing: "Towing",
  inspection: "Inspection",
  other: "Other",
  unclassified: "Unclassified",
};

export function shopTypeLabel(value: string): string {
  return SHOP_TYPE_LABELS[value] ?? value;
}
