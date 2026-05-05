export type MetricDimensions = Record<string, string | number | boolean | null>;

export function stableDimensionKey(dimensions: MetricDimensions = {}): string {
  const entries = Object.entries(dimensions)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return "total";
  }

  return entries.map(([key, value]) => `${key}:${String(value)}`).join("|");
}
