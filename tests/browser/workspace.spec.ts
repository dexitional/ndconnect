import { test, expect } from "@playwright/test";
test("member signs in, imports contacts, sends SMS and voice, and uses shared leads", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Good to see you again." }),
  ).toBeVisible();
  await page.getByLabel("Phone number").fill("0245559002");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Ama." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/member-overview.png",
    fullPage: true,
    caret: "initial",
  });
  await page.getByRole("link", { name: "My contacts", exact: true }).click();
  await page.getByRole("button", { name: "New contact list" }).click();
  await page.getByLabel("List name").fill("Neighborhood team");
  await page.getByLabel("Description").fill("Imported browser test audience.");
  await page
    .getByRole("button", { name: "Create contact list", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Neighborhood team" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Manage contacts" }).click();
  await page.getByLabel("Contact CSV").setInputFiles({
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,phone\nAma,0245559101\nKojo,0245559102\nDuplicate,+233245559101\nInvalid,nope",
    ),
  });
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Import contacts", exact: true })
    .click();
  await expect(
    page.getByText("2 imported · 1 duplicates skipped · 1 invalid"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await page.getByLabel("Contact name", { exact: true }).fill("Esi Addo");
  await page.getByLabel("Contact phone number").fill("0245559103");
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.screenshot({
    path: "test-results/add-contact.png",
    fullPage: true,
    caret: "initial",
  });
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Contacts (3)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Esi Addo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Ama", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Contact phone number").fill("+233245559103");
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(
    page.getByText("This phone number is already in this list."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload CSV", exact: true }).click();
  await page.getByLabel("Contact CSV").setInputFiles({
    name: "additional.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,phone\nDuplicate,0245559103\nYaw,0245559104"),
  });
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Import contacts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Contacts (4)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Esi Addo", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/compose");
  await page.getByLabel("Campaign name").fill("Neighborhood invitation");
  await page.getByText("Neighborhood team", { exact: true }).click();
  await page
    .getByLabel("Your message")
    .fill("Hello neighbors! Join us for our community meeting this Saturday.");
  await page.getByRole("button", { name: "Review campaign" }).click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Neighborhood invitation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("completed", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("dialog").getByText("accepted", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: "Shared leads", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Community volunteers" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Use this audience" }).click();
  await expect(
    page.getByRole("checkbox").filter({ visible: true }).first(),
  ).toBeVisible();
  await page.getByLabel("Campaign name").fill("Voice invitation");
  await page
    .getByRole("button", { name: "Voice message Let them hear it from you." })
    .click();
  await page.getByLabel("Voice recording").setInputFiles({
    name: "greeting.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF0000WAVEfmt "),
  });
  await expect(page.getByText("Recording uploaded.")).toBeVisible();
  await page.getByRole("button", { name: "Review campaign" }).click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(
    page.getByRole("dialog").getByText("completed", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});
test("admin reviews leads, allocates allowance, sees gateway health and audits", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back, admin." }),
  ).toBeVisible();
  await expect(page.locator(".auth-form")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "test-results/admin-login.png",
    fullPage: true,
    caret: "initial",
  });
  await page.getByLabel("Phone number").fill("0245559001");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clear view of every connection." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: "Ama Mensah" });
  await row.getByRole("button", { name: "Allocate" }).click();
  await page.getByLabel("Units to add").fill("250");
  await page.getByRole("button", { name: "Allocate 250 units" }).click();
  await expect(page.getByText("Account updated.")).toBeVisible();
  await page.getByRole("link", { name: "Lead moderation" }).click();
  await page.getByRole("button", { name: "Approved", exact: true }).click();
  await expect(page.getByText("Community volunteers")).toBeVisible();
  await page
    .getByRole("link", { name: "Gateway settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Arkesel messaging" }),
  ).toBeVisible();
  await expect(page.getByText("Local mock")).toBeVisible();
  await page.getByLabel("Messaging provider").selectOption("mnotify");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(
    page.getByRole("heading", { name: "mNotify messaging" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Messaging provider")).toHaveValue("mnotify");
  await expect(page.locator(".content")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "test-results/mnotify-gateway.png",
    fullPage: true,
  });
  await page.getByLabel("Messaging provider").selectOption("arkesel");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(
    page.getByRole("heading", { name: "Arkesel messaging" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Activity log" }).click();
  await expect(
    page.getByText("gateway.provider_changed").first(),
  ).toBeVisible();
  await expect(page.getByText("user.updated").first()).toBeVisible();
});
test("mobile layout fits and navigation opens; signup verifies a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Mobile Member");
  await page.getByLabel("Phone number").fill("0245559201");
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page
    .getByLabel("Password", { exact: true })
    .fill("Mobile-test-password");
  await page.getByLabel("Verification code").fill("123456");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Mobile." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(
    page.getByRole("link", { name: "My contacts", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "My contacts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My contacts", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".content")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "test-results/mobile-contacts.png",
    fullPage: true,
    caret: "initial",
  });
});

test("member submits Mobile Money details, admin gets notified and approves voice credits, and rates remain editable", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill("0245559002");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("link", { name: "SMS & voice credits", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "SMS & voice credits", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0558641826", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Ebenezer Kwabena Blay Ackah", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Number of voice credits").fill("25");
  await page.getByRole("button", { name: "Create payment request" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("GHC 10.00", { exact: true })).toBeVisible();
  await dialog
    .getByLabel("Mobile Money transaction ID")
    .fill("BROWSER-MOMO-123456");
  await dialog.getByLabel("Payer name", { exact: true }).fill("Ama Mensah");
  await dialog.getByLabel("Payer phone number").fill("0245559002");
  await dialog
    .getByLabel("Additional payment details (optional)")
    .fill("Test payment submitted for review.");
  await dialog
    .getByRole("button", { name: "Submit payment for confirmation" })
    .click();
  await expect(
    page.getByText(
      "Payment details submitted. Administrators have been notified.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "pending", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/SMS credits · 0 voice credits available/),
  ).toBeVisible();
  await expect(page.locator(".content")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "test-results/voice-credits.png",
    fullPage: true,
  });

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await adminPage.goto("http://127.0.0.1:3111/admin/login");
    await adminPage.getByLabel("Phone number").fill("0245559001");
    await adminPage
      .getByLabel("Password", { exact: true })
      .fill("Browser-test-password");
    await adminPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await adminPage
      .getByRole("button", { name: /Notifications \(\d+ unread\)/ })
      .click();
    await expect(
      adminPage.getByText("Payment awaiting confirmation", { exact: true }),
    ).toBeVisible();
    await adminPage
      .getByRole("link", { name: /Payment awaiting confirmation/ })
      .click();
    const review = adminPage.getByRole("dialog");
    await expect(
      review.getByText("BROWSER-MOMO-123456", { exact: true }),
    ).toBeVisible();
    await review
      .getByLabel("Review note / rejection reason")
      .fill("Confirmed test payment.");
    await expect(review).toHaveCSS("opacity", "1");
    await adminPage.screenshot({
      path: "test-results/payment-review.png",
      fullPage: true,
    });
    await review
      .getByRole("button", { name: "Confirm payment & add 25 credits" })
      .click();
    await expect(
      adminPage.getByText("Payment approved. Voice credits added."),
    ).toBeVisible();
    await adminPage
      .getByRole("button", { name: "Payment settings", exact: true })
      .click();
    await adminPage.getByLabel("Price per voice credit (GHC)").fill("0.55");
    await adminPage
      .getByRole("button", { name: "Save payment settings" })
      .click();
    await expect(adminPage.getByText("Payment settings saved.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByText(/SMS credits · 25 voice credits available/),
    ).toBeVisible();
    await expect(
      page.getByText("GHC 0.55 per credit", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "GHC 10.00", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "approved", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Notifications \(\d+ unread\)/ })
      .click();
    await expect(
      page.getByText("Voice credits added", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.getByLabel("Credit type").selectOption("sms");
    await page.getByLabel("Number of SMS credits").fill("100");
    await expect(
      page.getByText("GHC 0.06 per credit", { exact: true }),
    ).toBeVisible();
    const beforeSms = await (
      await page.request.get("/api/billing/settings")
    ).json();
    await page.getByRole("button", { name: "Create payment request" }).click();
    await expect(
      page.getByRole("dialog").getByText("GHC 6.00", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Mobile Money transaction ID")
      .fill("BROWSER-SMS-123456");
    await page.getByLabel("Payer name", { exact: true }).fill("Ama Mensah");
    await page.getByLabel("Payer phone number").fill("0245559002");
    await page
      .getByRole("button", { name: "Submit payment for confirmation" })
      .click();
    await expect(
      page.getByRole("cell", { name: "BROWSER-SMS-123456", exact: true }),
    ).toBeVisible();
    await adminPage.goto("http://127.0.0.1:3111/admin/payments");
    await adminPage
      .getByRole("row")
      .filter({ hasText: "BROWSER-SMS-123456" })
      .getByRole("button", { name: "Review payment" })
      .click();
    await adminPage
      .getByRole("button", { name: "Confirm payment & add 100 credits" })
      .click();
    await expect(
      adminPage.getByText("Payment approved. SMS credits added."),
    ).toBeVisible();
    await page.reload();
    const afterSms = await (
      await page.request.get("/api/billing/settings")
    ).json();
    expect(afterSms.smsCredits).toBe(beforeSms.smsCredits + 100);
    expect(afterSms.voiceCredits).toBe(beforeSms.voiceCredits);
    await expect(
      page.getByRole("heading", { name: "SMS & voice credits", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".content")).toHaveCSS("opacity", "1");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/voice-credits-mobile.png",
      fullPage: true,
    });
  } finally {
    await adminContext.close();
  }
});

test("failed campaigns retry and completed campaigns create a suffixed copy for another broadcast", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill("0245559002");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Campaigns", exact: true }).click();
  await page
    .getByRole("button", { name: "Retry browser fixture", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry failed recipients" }).click();
  await expect(
    page.getByText("Retry failed recipients?", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm retry", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("completed", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Clone and resend" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", {
      name: "Retry browser fixture - Copy 1",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("draft", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send campaign", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and queue", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("completed", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.screenshot({
    path: "test-results/campaign-copy.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("member requests a Sender ID, admin confirms gateway registration, and approved sender is used for SMS", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill("0245559002");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "SMS Sender IDs", exact: true }).click();
  await page
    .getByRole("button", { name: "Request Sender ID", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Gateway", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Sender name").fill("TEAMNDC");
  await page
    .getByLabel("Organization and purpose")
    .fill("Community organization event notices");
  await page.getByRole("button", { name: "Submit Sender ID request" }).click();
  await expect(
    page.getByRole("cell", { name: "TEAMNDC", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "pending", exact: true }),
  ).toBeVisible();
  const context = await browser.newContext();
  const admin = await context.newPage();
  try {
    await admin.goto("http://127.0.0.1:3111/admin/login");
    await admin.getByLabel("Phone number").fill("0245559001");
    await admin
      .getByLabel("Password", { exact: true })
      .fill("Browser-test-password");
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await admin
      .getByRole("link", { name: "Sender ID approvals", exact: true })
      .click();
    await admin
      .getByRole("row")
      .filter({ hasText: "TEAMNDC" })
      .getByRole("button", { name: "Review request" })
      .click();
    await admin
      .getByLabel("Gateway confirmation / review note")
      .fill("Verified registration in gateway dashboard");
    await admin.getByRole("button", { name: "Approve Sender ID" }).click();
    await expect(
      admin.getByText(
        "Confirm registration and approval on the selected gateway first.",
        { exact: true },
      ),
    ).toBeVisible();
    await admin.getByRole("checkbox").check();
    await admin.getByRole("button", { name: "Approve Sender ID" }).click();
    await expect(
      admin.getByRole("cell", { name: "approved", exact: true }),
    ).toBeVisible();
    await admin
      .getByRole("link", { name: "SMS notifications", exact: true })
      .click();
    await expect
      .poll(
        async () => {
          const r = await admin.request.get("/api/admin/sms-notifications");
          const data = await r.json();
          return data.notifications.filter(
            (n: any) =>
              n.message.includes("TEAMNDC") && n.status === "accepted",
          ).length;
        },
        { timeout: 15000 },
      )
      .toBe(4);
    await expect(admin.locator(".content")).toHaveCSS("opacity", "1");
    await admin.screenshot({
      path: "test-results/sender-sms-notifications.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/compose");
    await page.getByLabel("Campaign name").fill("Branded SMS campaign");
    await page.getByText("Neighborhood team", { exact: true }).click();
    await expect(page.getByLabel("Sender ID")).toContainText("TEAMNDC");
    await page.getByLabel("Sender ID").selectOption({ label: "TEAMNDC" });
    await page
      .getByLabel("Your message")
      .fill("Hello from our approved sender.");
    await page.getByRole("button", { name: "Review campaign" }).click();
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirm and send" }).click();
    await expect(
      page.getByRole("dialog").getByText("Sender: TEAMNDC", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("completed", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
  } finally {
    await context.close();
  }
});
