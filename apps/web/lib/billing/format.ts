// Stripe charge/invoice minor units, including ISK/UGX compatibility rules.
const zeroDecimal = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);
export function formatBillingAmount(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value / (zeroDecimal.has(currency.toLowerCase()) ? 1 : 100));
}
