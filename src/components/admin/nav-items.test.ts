import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "./nav-items";

const appDir = fileURLToPath(new URL("../../app", import.meta.url));

describe("ADMIN_NAV", () => {
  it("lists the seven admin sections in order", () => {
    expect(ADMIN_NAV.map((i) => i.label)).toEqual([
      "Overview",
      "Attendees",
      "Sponsors",
      "Tables & Seating",
      "Payments",
      "Gala Setup",
      "Exports",
    ]);
  });

  it.each(ADMIN_NAV)("$label links to a page that exists ($href)", ({ href }) => {
    expect(existsSync(`${appDir}${href}/page.tsx`)).toBe(true);
  });
});
