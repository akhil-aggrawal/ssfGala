import { expect, test } from "@playwright/test";

test("GET / returns 200 with the gala heading", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "An Evening That Moves You",
    }),
  ).toBeVisible();
});
