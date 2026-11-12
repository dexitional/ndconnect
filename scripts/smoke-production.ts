import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { chromium } from "@playwright/test";
import { logoUrl } from "../apps/web/src/lib/brand";
import { audioFixture } from "../tests/helpers/audio";
const temp = await mkdtemp(resolve(tmpdir(), "ndcms-production-"));
process.env.DATABASE_PATH = resolve(temp, "test.sqlite");
process.env.UPLOAD_DIR = resolve(temp, "uploads");
process.env.APP_URL = "http://127.0.0.1:3112";
process.env.MOCK_PROVIDER = "false";
process.env.NODE_ENV = "production";
process.env.ARKESEL_API_KEY = "production-smoke-test-no-sending";
process.env.MNOTIFY_API_KEY = "production-smoke-mnotify-no-sending";
const { db, run } = await import("@ndc/db");
run(
  "INSERT INTO users(id,name,phone,password_hash,role,verified) VALUES(?,?,?,?,'admin',1)",
  crypto.randomUUID(),
  "Smoke Administrator",
  "+233245559999",
  await hash("Smoke-test-password", 12),
);
db.close();
const childEnv: NodeJS.ProcessEnv = { ...process.env, HOST: "127.0.0.1" };
delete childEnv.PORT;
delete childEnv.NITRO_PORT;
// Use the same entry and working directory as npm start; derive port from APP_URL.
const child = spawn(process.execPath, ["../../scripts/start.mjs"], {
  cwd: resolve("apps/web"),
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
child.stdout.on("data", (d) => {
  logs += d;
});
child.stderr.on("data", (d) => {
  logs += d;
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const healthResponse: Response = await fetch(
        process.env.APP_URL + "/api/health",
      );
      if (healthResponse.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Production server did not become healthy: " + logs);
  for (const path of ["/login", "/admin/login"]) {
    const response: Response = await fetch(process.env.APP_URL + path);
    assert.equal(response.status, 200, path);
  }
  for (const path of [logoUrl, "/brand/logo.png", "/brand/wordmark.png"]) {
    const response: Response = await fetch(process.env.APP_URL + path);
    assert.equal(response.status, 200, path);
    assert.match(
      response.headers.get("content-type") || "",
      /^image\/png/,
      `${path} must be an image, not a catch-all HTML response`,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      bytes.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      path,
    );
  }
  const html = await (await fetch(process.env.APP_URL + "/login")).text();
  const asset = html.match(/\/assets\/[^"\s]+\.css/)?.[0];
  assert.ok(asset, "Stylesheet must be present");
  assert.equal((await fetch(process.env.APP_URL + asset)).status, 200);
  const unauthorized = await fetch(process.env.APP_URL + "/api/admin/users");
  assert.equal(unauthorized.status, 401);
  const login = await fetch(process.env.APP_URL + "/api/auth/login", {
    method: "POST",
    headers: {
      Origin: process.env.APP_URL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone: "0245559999",
      password: "Smoke-test-password",
      admin: true,
    }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get("set-cookie")!;
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  const recording = new FormData();
  recording.append(
    "file",
    new File(
      [new Uint8Array(await audioFixture("m4a"))],
      "production-audio.m4a",
    ),
  );
  const uploaded = await fetch(process.env.APP_URL + "/api/audio", {
    method: "POST",
    headers: { Origin: process.env.APP_URL, Cookie: cookie.split(";")[0] },
    body: recording,
  });
  const upload = (await uploaded.json()) as any;
  assert.equal(uploaded.status, 201, JSON.stringify(upload));
  assert.equal(upload.filename, "production-audio.wav");
  assert.equal(upload.converted, true);
  const converted = await fetch(process.env.APP_URL + upload.url, {
    headers: { Cookie: cookie.split(";")[0] },
  });
  assert.equal(converted.headers.get("content-type"), "audio/wav");
  assert.equal(
    Buffer.from(await converted.arrayBuffer()).toString("ascii", 8, 12),
    "WAVE",
  );
  const dashboard = await fetch(
    process.env.APP_URL + "/api/dashboard?admin=true",
    { headers: { Cookie: cookie.split(";")[0] } },
  );
  assert.equal(dashboard.status, 200);
  const result = (await dashboard.json()) as any;
  assert.equal(result.stats.users, 1);
  assert.equal(result.user.role, "admin");
  const selection = await fetch(process.env.APP_URL + "/api/admin/gateway", {
    method: "PATCH",
    headers: {
      Cookie: cookie.split(";")[0],
      Origin: process.env.APP_URL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider: "mnotify" }),
  });
  assert.equal(selection.status, 200);
  const gateway = await fetch(process.env.APP_URL + "/api/admin/gateway", {
    headers: { Cookie: cookie.split(";")[0] },
  });
  const configuration = await gateway.text();
  assert.equal(JSON.parse(configuration).provider, "mnotify");
  assert.equal(configuration.includes(process.env.MNOTIFY_API_KEY), false);
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(process.env.APP_URL + "/admin/login");
  await page.getByLabel("Phone number").fill("0245559999");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Smoke-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin");
  await page.getByRole("link", { name: "People & access" }).waitFor();
  await page.reload();
  await page.getByRole("link", { name: "People & access" }).waitFor();
  const sessionCookies = await context.cookies();
  assert.ok(
    sessionCookies.some(
      (c) => c.name === "ndc_session" && c.httpOnly && c.secure,
    ),
  );
  await page
    .locator(`img[src="${logoUrl}"]`)
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
    });
  assert.deepEqual(
    pageErrors,
    [],
    "Production browser must hydrate without errors",
  );
  console.log(
    "Production checks passed: WAV conversion, PNG bytes and rendering, browser login and persistent secure session, SSR, assets, SQLite, authorization, dashboard, and provider switching. No provider requests sent.",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) =>
    child.exitCode !== null ? r(null) : child.once("exit", r),
  );
  await rm(temp, { recursive: true, force: true });
}
