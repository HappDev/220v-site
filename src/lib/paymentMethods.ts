export type BillingPaymentMethod = {
  id: number;
  type: string;
  label: string;
};

export function isCardPaymentMethod(method?: BillingPaymentMethod | null): boolean {
  if (!method) return false;

  const type = method.type.trim().toLowerCase();
  return method.id === 11 || type === "card" || type === "carg";
}
