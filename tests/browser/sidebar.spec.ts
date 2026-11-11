import { test, expect } from "@playwright/test";

for (const screen of [
  {
    name: "short desktop",
    width: 1280,
    height: 540,
    density: 1,
    mobile: false,
  },
  {
    name: "dense small screen",
    width: 800,
    height: 450,
    density: 2,
    mobile: false,
  },
  { name: "mobile", width: 390, height: 568, density: 3, mobile: true },
]) {
  test.describe(screen.name, () => {
    test.use({
      viewport: { width: screen.width, height: screen.height },
      deviceScaleFactor: screen.density,
      isMobile: screen.mobile,
      hasTouch: screen.mobile,
      reducedMotion: "reduce",
    });
    for (const admin of [false, true]) {
      test(`${admin ? "admin" : "member"} can scroll to lower navigation and sign out`, async ({
        page,
      }) => {
        await page.goto(admin ? "/admin/login" : "/login");
        await page
          .getByLabel("Phone number")
          .fill(admin ? "0245559001" : "0245559002");
        await page
          .getByLabel("Password", { exact: true })
          .fill("Browser-test-password");
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        const sidebar = page.getByRole("complementary", {
          name: admin ? "Admin navigation" : "Workspace navigation",
        });
        await expect(sidebar).toBeAttached();
        if (screen.mobile)
          await page.getByRole("button", { name: "Toggle navigation" }).click();
        await expect(sidebar).toBeInViewport();
        await expect(sidebar).toHaveCSS("overflow-y", "auto");
        expect(
          await sidebar.evaluate((el) => el.scrollHeight > el.clientHeight),
        ).toBe(true);
        expect(
          await sidebar.evaluate((el) => el.clientHeight),
        ).toBeLessThanOrEqual(screen.height);
        await sidebar.hover();
        await page.mouse.wheel(0, 2500);
        await expect
          .poll(() => sidebar.evaluate((el) => el.scrollTop))
          .toBeGreaterThan(0);
        await expect(sidebar.locator(".profile-button")).toBeInViewport({
          ratio: 1,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/sidebar-${admin ? "admin" : "member"}-${screen.name.replaceAll(" ", "-")}.png`,
        });
        const lowerLink = sidebar.getByRole("link", {
          name: admin ? "Payments & credits" : "My account",
          exact: true,
        });
        await lowerLink.click();
        await expect(page).toHaveURL(
          admin ? /\/admin\/payments$/ : /\/settings$/,
        );
        if (screen.mobile)
          await page.getByRole("button", { name: "Toggle navigation" }).click();
        // Keyboard users can also reach both ends of the independently scrolling menu.
        await sidebar.focus();
        await page.keyboard.press("Home");
        await expect.poll(() => sidebar.evaluate((el) => el.scrollTop)).toBe(0);
        await page.keyboard.press("End");
        await expect(sidebar.locator(".profile-button")).toBeInViewport({
          ratio: 1,
        });
        await sidebar.locator(".profile-button").click();
        await expect(page).toHaveURL(/\/login$/);
      });
    }
  });
}
