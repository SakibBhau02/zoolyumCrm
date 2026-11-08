import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@zoolyum.com").fill("sakib@zoolyum.com");
  await page.locator('input[type="password"]').fill("zoolyum123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard|\/control|\/clients/);
}

test("branding upload dark/light", async ({ page }) => {
  await login(page);
  await page.goto("/control?section=branding");
  await expect(page.getByText("Dark Logo", { exact: true })).toBeVisible();
  await expect(page.getByText("Light Logo", { exact: true })).toBeVisible();
  await expect(page.getByText("Gradient preview", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save branding" })).toBeVisible();
});

test("branding section visible in settings navigation", async ({ page }) => {
  await login(page);
  await page.goto("/control");
  // branding nav item should be visible in left section list
  await expect(page.getByRole("button", { name: "Branding" })).toBeVisible();
});
