import { expect, test } from "@playwright/test";

test("GET / returns 200 with placeholder text", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "Small Steps Foundation Gala: An Evening That Moves You",
    }),
  ).toBeVisible();
});
