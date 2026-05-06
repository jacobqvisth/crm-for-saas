// Canonical shop_type values for `discovered_shops`.
// `shop_type` was added as the ICP classifier in the SE 'other' bucket cleanup
// migration (2026-05-06) — it's the source of truth for "is this an ICP fit",
// independent of Google Maps' `category` (which is missing on ~25% of rows).

export const CORE_ICP_SHOP_TYPES = [
  "auto_repair",
  "tire_combo",
  "auto_glass",
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
