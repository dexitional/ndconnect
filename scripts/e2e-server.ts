import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
const temp = await mkdtemp(resolve(tmpdir(), "ndcms-browser-"));
process.env.DATABASE_PATH = resolve(temp, "test.sqlite");
process.env.UPLOAD_DIR = resolve(temp, "uploads");
process.env.MOCK_PROVIDER = "true";
process.env.APP_URL = "http://127.0.0.1:3111";
process.env.NODE_ENV = "development";
process.env.ARKESEL_API_KEY = "test-only-key";
process.env.MNOTIFY_API_KEY = "test-only-mnotify-key";
const { db, run } = await import("@ndc/db");
const { processNotification } =
  await import("../apps/web/src/server/notifications");
const { processOne, maintenance } =
  await import("../apps/web/src/server/queue");
const admin = crypto.randomUUID(),
  member = crypto.randomUUID();
for (const [id, name, phone, role] of [
  [admin, "Platform Admin", "+233245559001", "admin"],
  [member, "Ama Mensah", "+233245559002", "user"],
  [crypto.randomUUID(), "Ama Interface", "+233245559003", "user"],
])
  run(
    "INSERT INTO users(id,name,phone,password_hash,role,verified,allowance,voice_credits) VALUES(?,?,?,?,?,1,10000,8)",
    id,
    name,
    phone,
    await hash("Browser-test-password", 12),
    role,
  );
const list = crypto.randomUUID();
run(
  "INSERT INTO lists(id,owner_id,name,category,visibility,status,description) VALUES(?,?,'Community volunteers','Volunteers','shared','approved','A test audience for bringing the community together.')",
  list,
  admin,
);
for (let i = 0; i < 8; i++)
  run(
    "INSERT INTO contacts(id,list_id,name,phone,consent) VALUES(?,?,?,?,1)",
    crypto.randomUUID(),
    list,
    "Test contact " + i,
    "+23324555800" + i,
  );
const retryId = crypto.randomUUID();
run(
  "INSERT INTO campaigns(id,owner_id,name,channel,message,sender,list_ids,status,provider) VALUES(?,?,'Retry browser fixture','sms','Retry test message','NDC',?,'attention','arkesel')",
  retryId,
  member,
  JSON.stringify([list]),
);
run(
  "INSERT INTO deliveries(id,campaign_id,phone,status,provider_id) VALUES(?,?,?,'failed','old-test-batch')",
  crypto.randomUUID(),
  retryId,
  "+233245558000",
);
let working = false;
const interval = setInterval(async () => {
  if (working) return;
  working = true;
  try {
    maintenance();
    await processNotification();
    await processOne();
  } finally {
    working = false;
  }
}, 500);
const child = spawn(
  process.execPath,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "--configLoader",
    "runner",
    "--port",
    "3111",
    "--host",
    "127.0.0.1",
    "--strictPort",
  ],
  { cwd: resolve("apps/web"), env: process.env, stdio: "inherit" },
);
let stopped = false;
async function cleanup() {
  if (stopped) return;
  stopped = true;
  clearInterval(interval);
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  db.close();
  await rm(temp, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => void cleanup());
process.on("SIGINT", () => void cleanup());
child.on("exit", () => void cleanup());
