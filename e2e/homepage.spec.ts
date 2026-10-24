import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("homepage", () => {
  test("shows the event date, time, venue and reception time", async ({
    page,
  }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { level: 1, name: "An Evening That Moves You" }),
    ).toBeVisible();
    await expect(main.getByText("Saturday, January 23, 2027")).toBeVisible();
    await expect(main.getByText("6:30 – 11:00 PM")).toBeVisible();
    await expect(main.getByText("ICC Milpitas")).toBeVisible();
    await expect(
      main.getByText("Founders & Friends reception at 5:30 PM"),
    ).toBeVisible();
  });

  test("header links: Gala, About, Buy Tickets, Sponsor a Table, Sign In", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    const expected: [string, string][] = [
      ["Gala", "/"],
      ["About", "/#about"],
      ["Buy Tickets", "/tickets"],
      ["Sponsor a Table", "/sponsor"],
      ["Sign In", "/signin"],
    ];
    for (const [name, href] of expected) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  test("hero calls to action link to /tickets and /sponsor", async ({
    page,
  }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    await expect(
      main.getByRole("link", { name: "Buy Tickets", exact: true }),
    ).toHaveAttribute("href", "/tickets");
    await expect(
      main.getByRole("link", { name: "Sponsor a Table", exact: true }),
    ).toHaveAttribute("href", "/sponsor");
  });

  for (const viewport of [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "mobile", width: 375, height: 667 },
  ]) {
    test(`meets WCAG AA (axe) on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test("no horizontal scroll at 375 px wide", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
