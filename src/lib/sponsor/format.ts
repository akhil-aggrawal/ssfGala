// Client-safe money text. Integer cents in, "$1,500.50" out.
export function formatUsd(cents: number): string {
  const whole = Math.trunc(cents / 100).toLocaleString("en-US");
  const rest = cents % 100;
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
}
