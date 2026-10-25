import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { summarizeSponsorships } from "@/lib/admin/receipts";

vi.mock("./actions", () => ({ recordReceipt: vi.fn(), correctReceipt: vi.fn() }));
const { Balances } = await import("./balances");

const receipt = (id: string, amount_cents: number) => ({
  id,
  sponsorship_id: "s1",
  amount_cents,
  status: "succeeded",
  received_at: "2027-01-05T08:00:00+00:00",
  created_at: "2027-01-05T09:00:00+00:00",
  recorder: { email: "admin@example.test", display_name: "Ada Admin" },
});

const html = renderToStaticMarkup(
  <Balances
    balances={summarizeSponsorships(
      [{ id: "s1", pledged_cents: 200000, status: "committed", sponsor: { display_name: "Acme" } }],
      [receipt("p1", 50000), receipt("p2", 30000)],
    )}
  />,
);
const text = html.replace(/<[^>]+>/g, " ");

describe("Balances", () => {
  it("shows $800 received and $1,200 outstanding on a $2,000 pledge", () => {
    expect(text).toMatch(/\$800\.00\s+received of \$2,000\.00/);
    expect(text).toMatch(/\$1,200\.00\s+outstanding/);
  });

  it("names who recorded each receipt and when it arrived", () => {
    expect(text).toContain("recorded by Ada Admin");
    expect(text).toContain("Jan 5, 2027");
  });

  it("has no card or Stripe payment action", () => {
    expect(html).not.toMatch(/stripe|card|checkout|pay now/i);
    expect(html).not.toMatch(/cc-number|autocomplete="cc-/i);
  });
});
