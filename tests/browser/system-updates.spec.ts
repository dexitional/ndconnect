import { test, expect, type Page } from "@playwright/test";
import { audioFixture } from "../helpers/audio";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill("0245559003");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Ama." }),
  ).toBeVisible();
}

for (const width of [1440, 390, 320]) {
  test(`login typography and navigation controls fit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.locator(".auth-tagline")).toHaveCSS(
      "font-family",
      /DM Serif Display/,
    );
    expect(
      await page
        .locator(".auth-form h1")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeLessThanOrEqual(width < 700 ? 22 : 26);
    expect(
      await page
        .locator(".auth-form > .eyebrow")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeLessThanOrEqual(width < 700 ? 9 : 10);
    await page.screenshot({
      path: `test-results/login-updated-${width}.png`,
      fullPage: true,
    });
    await login(page);
    const topbar = page.locator(".topbar");
    for (const control of [
      topbar.getByRole("button", { name: /Notifications/ }),
      topbar.getByRole("button", { name: "Workspace help" }),
      topbar.getByRole("link", { name: "My profile" }),
    ]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = await control.boundingBox();
      expect(box!.width).toBe(40);
      expect(box!.height).toBe(40);
    }
    for (const selector of [
      ".notification-trigger > svg",
      ".help-link > svg",
    ]) {
      const icon = topbar.locator(selector);
      await expect(icon).toHaveCSS("width", "20px");
      await expect(icon).toHaveCSS("height", "20px");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/header-updated-${width}.png`,
      fullPage: true,
    });
    await topbar.getByRole("button", { name: "Workspace help" }).click();
    await expect(
      page.getByRole("dialog", { name: "Contact us", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await topbar.getByRole("button", { name: /Notifications/ }).click();
    await expect(
      page.getByRole("dialog", { name: "Notifications", exact: true }),
    ).toBeVisible();
  });
}

test("member edits draft and cancelled audiences, manages contacts, and resends after review", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const headers = { Origin: "http://127.0.0.1:3111" };
  const names = ["Original campaign audience", "Replacement campaign audience"];
  const ids: string[] = [];
  for (const [index, name] of names.entries()) {
    const created = await page.request.post("/api/lists", {
      headers,
      data: { name },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    ids.push(id);
    const contact = await page.request.post(`/api/lists/${id}/contacts`, {
      headers,
      data: { name: "Test contact", phone: `024555960${index}`, consent: true },
    });
    expect(contact.ok()).toBe(true);
  }
  const created = await page.request.post("/api/campaigns", {
    headers,
    data: {
      name: "Editable audience campaign",
      channel: "sms",
      message: "A test community message",
      listIds: [ids[0]],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/campaigns?id=${id}`);
  const detail = page.getByRole("dialog", {
    name: "Editable audience campaign",
    exact: true,
  });
  await detail.getByRole("button", { name: "Edit contact lists" }).click();
  const editor = page.getByRole("region", {
    name: "Edit campaign contact lists",
  });
  await editor.getByRole("checkbox", { name: new RegExp(names[0]) }).uncheck();
  await editor.getByRole("checkbox", { name: new RegExp(names[1]) }).check();
  await editor.getByRole("button", { name: "Save contact lists" }).click();
  await expect(editor).not.toBeVisible();
  expect(
    JSON.parse(
      (await (await page.request.get(`/api/campaigns/${id}`)).json()).campaign
        .list_ids,
    ),
  ).toEqual([ids[1]]);
  await detail.getByRole("button", { name: "Cancel campaign" }).click();
  await expect(
    detail.getByRole("button", { name: "Resend campaign" }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Edit contact lists" }).click();
  await editor.getByRole("checkbox", { name: new RegExp(names[1]) }).uncheck();
  await editor.getByRole("checkbox", { name: new RegExp(names[0]) }).check();
  await editor
    .locator(".audience-row")
    .filter({ hasText: names[0] })
    .getByRole("button", { name: "Manage contacts" })
    .click();
  const manager = page.getByRole("dialog", { name: names[0], exact: true });
  await manager.getByLabel("Contact phone number").fill("0245559602");
  await manager
    .getByRole("button", { name: "Save contact", exact: true })
    .click();
  await expect(
    manager.getByRole("heading", { name: "Contacts (2)", exact: true }),
  ).toBeVisible();
  await manager.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    editor.getByRole("checkbox", {
      name: new RegExp(`${names[0]} 2 contacts`),
    }),
  ).toBeChecked();
  await page.screenshot({
    path: "test-results/cancelled-audience-editor.png",
    fullPage: true,
  });
  await editor.getByRole("button", { name: "Save contact lists" }).click();
  await expect(editor).not.toBeVisible();
  await detail.getByRole("button", { name: "Resend campaign" }).click();
  const copy = page.getByRole("dialog", {
    name: "Editable audience campaign - Copy 1",
    exact: true,
  });
  await expect(
    copy.getByRole("button", { name: "Send campaign" }),
  ).toBeVisible();
  await copy.getByRole("button", { name: "Send campaign" }).click();
  await copy.getByRole("button", { name: "Confirm and queue" }).click();
  await expect(copy.getByText("2 recipients", { exact: true })).toBeVisible();
  await expect(
    copy.getByRole("button", { name: "Send campaign" }),
  ).not.toBeVisible();
  const original = await (
    await page.request.get(`/api/campaigns/${id}`)
  ).json();
  expect(original.campaign.status).toBe("cancelled");
  expect(original.deliveries).toHaveLength(0);
});

test("uploaded M4A is converted to a playable WAV and can be saved in a voice draft", async ({
  page,
}) => {
  await login(page);
  await page.goto("/compose?channel=voice");
  await page.getByLabel("Campaign name").fill("Converted voice recording");
  await page.getByText("Community volunteers", { exact: true }).click();
  await page.getByLabel("Voice recording").setInputFiles({
    name: "meeting.m4a",
    mimeType: "audio/mp4",
    buffer: await audioFixture("m4a"),
  });
  await expect(
    page.getByText("Recording converted to WAV and uploaded.", { exact: true }),
  ).toBeVisible();
  const player = page.locator("audio.audio-player");
  await expect
    .poll(() => player.evaluate((el: HTMLAudioElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(
    await player.evaluate((el: HTMLAudioElement) => el.duration),
  ).toBeGreaterThan(0);
  await expect(
    page.getByRole("link", { name: "download the recording" }),
  ).toHaveAttribute("download", "meeting.wav");
  await page
    .getByRole("button", { name: "Save as draft", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Converted voice recording",
      exact: true,
    }),
  ).toBeVisible();
});
