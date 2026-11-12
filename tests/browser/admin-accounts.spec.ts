import { test, expect } from "@playwright/test";

test("administrators create, edit, reset, and suspend another administrator", async ({
  page,
  browser,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel("Phone number").fill("0245559001");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add administrator", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Browser Administrator");
  await dialog.getByLabel("Phone number").fill("0245558801");
  await dialog.getByLabel("Email address").fill("browser-admin@example.com");
  await dialog
    .getByLabel("New password", { exact: true })
    .fill("Initial-browser-admin-password");
  await dialog
    .getByLabel("Confirm new password")
    .fill("Initial-browser-admin-password");
  await dialog
    .getByRole("button", { name: "Create administrator", exact: true })
    .click();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Browser Administrator" });
  await expect(row).toBeVisible();
  await row
    .getByRole("button", { name: "Manage account", exact: true })
    .click();
  await dialog.getByLabel("Full name").fill("Managed Browser Administrator");
  await dialog
    .getByRole("button", { name: "Save account", exact: true })
    .click();
  await expect(row).toContainText("Managed Browser Administrator");
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3111",
  });
  const other = await context.newPage();
  try {
    const signIn = async (password: string) => {
      await other.goto("/admin/login");
      await other.getByLabel("Phone number").fill("0245558801");
      await other.getByLabel("Password", { exact: true }).fill(password);
      await other.getByRole("button", { name: "Sign in", exact: true }).click();
    };
    await signIn("Initial-browser-admin-password");
    await expect(other).toHaveURL(/\/admin$/);
    await row
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    await dialog
      .getByLabel("New password", { exact: true })
      .fill("Updated-browser-admin-password");
    await dialog
      .getByLabel("Confirm new password")
      .fill("Updated-browser-admin-password");
    await dialog
      .getByRole("button", { name: "Reset admin password", exact: true })
      .click();
    await expect(
      page.getByText(
        "Administrator password reset. Existing sessions signed out.",
      ),
    ).toBeVisible();
    await other.reload();
    await expect(other).toHaveURL(/\/admin\/login$/);
    await signIn("Initial-browser-admin-password");
    await expect(other.getByRole("alert")).toContainText(
      "Phone number or password is incorrect",
    );
    await signIn("Updated-browser-admin-password");
    await expect(other).toHaveURL(/\/admin$/);
    await row.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(row).toContainText("suspended");
    await other.reload();
    await expect(other).toHaveURL(/\/admin\/login$/);
    await row.getByRole("button", { name: "Reactivate", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Suspend", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Filter account role").selectOption("admin");
    await expect(row).toBeVisible();
  } finally {
    await context.close();
  }
});

test("branding and top-bar icons fit narrow screens", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.locator(".auth-tagline")).toHaveCSS(
    "font-family",
    /DM Serif Display/,
  );
  await page.setViewportSize({ width: 320, height: 640 });
  const brand = await page.locator(".auth-brand").boundingBox();
  const tagline = await page.locator(".auth-tagline").boundingBox();
  expect(tagline!.y).toBeGreaterThanOrEqual(brand!.y + brand!.height);
  await page.screenshot({ path: "test-results/login-tagline-mobile.png" });
  await page.getByLabel("Phone number").fill("0245559001");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const bell = page.getByRole("button", { name: /Notifications \(/ });
  const help = page.getByRole("button", { name: "Workspace help" });
  for (const control of [bell, help]) {
    await expect(control).toBeInViewport({ ratio: 1 });
    const icon = control.locator("svg");
    await expect(icon).toBeVisible();
    await expect(icon).toHaveCSS("width", "20px");
    await expect(icon).toHaveCSS("height", "20px");
    expect(
      await icon.evaluate((el) => (el as SVGGraphicsElement).getBBox().width),
    ).toBeGreaterThan(0);
  }
  await bell.click();
  await expect(
    page.getByRole("dialog", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.locator(".workspace-switch")).toHaveAccessibleName(
    "Administration Platform",
  );
  await expect(page.locator(".brand small")).toHaveCSS("font-size", "9px");
  await page.getByRole("button", { name: "Close navigation" }).click();
  await page.screenshot({ path: "test-results/topbar-icons-mobile.png" });
  await help.click();
  await expect(
    page.getByRole("dialog", { name: "Contact us", exact: true }),
  ).toBeVisible();
});
