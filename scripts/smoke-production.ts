import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
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
const child = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: "3112", HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
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
  for (const path of ["/login", "/admin/login", "/brand/logo.png"]) {
    const response: Response = await fetch(process.env.APP_URL + path);
    assert.equal(response.status, 200, path);
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
  console.log(
    "Production smoke checks passed: SSR pages, assets, SQLite, authentication, secure cookies, authorization, dashboard, and provider switching. No provider requests sent.",
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((r) =>
    child.exitCode !== null ? r(null) : child.once("exit", r),
  );
  await rm(temp, { recursive: true, force: true });
}
