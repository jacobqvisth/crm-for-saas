export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
}

export function formatCurrency(
  value: number,
  currency = "USD",
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 1_000 ? 0 : 2,
    ...options,
  }).format(value);
}

export function formatPercent(value: number, digits = 1) {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  return `${value.toFixed(digits)}%`;
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
