import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

// Checkout Sessions opened before #15 return to the old success URL.
describe("next.config redirects", () => {
  it("forwards the old Stripe success URL to /tickets/success", async () => {
    expect(await nextConfig.redirects!()).toContainEqual({
      source: "/tickets/checkout/success",
      destination: "/tickets/success",
      permanent: false,
    });
  });
});
