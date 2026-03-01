export function formatCurrency(cents: number, currency: string = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}
