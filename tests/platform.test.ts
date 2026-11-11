import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
const directory = await mkdtemp(resolve(tmpdir(), "ndcms-tests-"));
process.env.DATABASE_PATH = resolve(directory, "test.sqlite");
process.env.UPLOAD_DIR = resolve(directory, "uploads");
process.env.MOCK_PROVIDER = "true";
process.env.NODE_ENV = "test";
process.env.APP_URL = "http://localhost:3100";
process.env.ARKESEL_API_KEY = "test-only-key";
process.env.ARKESEL_WEBHOOK_SECRET = "test-webhook-secret";
const { apiApp } = await import("../apps/web/src/server/app");
const { db, one, run, all } = await import("@ndc/db");
const { hash, canonical, verifyWebhook } =
  await import("../apps/web/src/server/security");
const { processOne } = await import("../apps/web/src/server/queue");
const { normalizePhone, smsParts } = await import("../apps/web/src/lib/shared");
const { sendBatch, verifyOtp, ProviderError, assertProvider } =
  await import("../apps/web/src/server/provider");
const admin = randomUUID(),
  member = randomUUID(),
  other = randomUUID();
for (const [id, name, role] of [
  [admin, "Admin", "admin"],
  [member, "Member", "user"],
  [other, "Other", "user"],
]) {
  run(
    "INSERT INTO users(id,name,role,verified,allowance,voice_credits) VALUES(?,?,?,1,100000,100000)",
    id,
    name,
    role,
  );
  run(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    hash(id),
    id,
    Date.now() + 86400000,
  );
}
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  user: string | null = member,
  headers: Record<string, string> = {},
) {
  const res = await apiApp.request("http://localhost:3100/api" + path, {
    method,
    headers: {
      Origin: "http://localhost:3100",
      ...(user ? { Cookie: `ndc_session=${user}` } : {}),
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = (await res.json()) as any;
  return { res, data };
}
function newList(owner = member, visibility = "private", status = "approved") {
  const id = randomUUID();
  run(
    "INSERT INTO lists(id,owner_id,name,visibility,status) VALUES(?,?,?,?,?)",
    id,
    owner,
    "Test audience",
    visibility,
    status,
  );
  return id;
}
function addContact(list: string, phone: string) {
  run(
    "INSERT INTO contacts(id,list_id,phone,consent) VALUES(?,?,?,1)",
    randomUUID(),
    list,
    phone,
  );
}
async function campaign(
  listIds: string[],
  extra: Record<string, any> = {},
  user = member,
) {
  const r = await req(
    "/campaigns",
    "POST",
    {
      name: "Integration campaign",
      channel: "sms",
      message: "A community message",
      listIds,
      ...extra,
    },
    user,
  );
  assert.equal(r.res.status, 201, JSON.stringify(r.data));
  return r.data.id as string;
}
after(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
});
test("SQLite enforces foreign keys, WAL, full durability and a busy timeout", () => {
  assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(db.pragma("synchronous", { simple: true }), 2);
  assert.equal(db.pragma("busy_timeout", { simple: true }), 5000);
});
test("phone canonicalization and SMS segmentation handle GSM extension and Unicode", () => {
  assert.equal(normalizePhone("024 123 4567"), "+233241234567");
  assert.equal(normalizePhone("00233241234567"), "+233241234567");
  assert.throws(() => normalizePhone("bad"));
  assert.equal(smsParts("a".repeat(160)).parts, 1);
  assert.equal(smsParts("a".repeat(161)).parts, 2);
  assert.equal(smsParts("^".repeat(81)).parts, 2);
  assert.equal(smsParts("🙂".repeat(36)).parts, 2);
});
test("unauthenticated requests and non-admin management access are denied", async () => {
  assert.equal((await req("/lists", "GET", undefined, null)).res.status, 401);
  assert.equal((await req("/admin/users")).res.status, 403);
  assert.equal(
    (await req("/admin/users", "GET", undefined, admin)).res.status,
    200,
  );
});
test("mutations reject foreign and missing Origin headers", async () => {
  assert.equal(
    (
      await req("/lists", "POST", { name: "Injected" }, member, {
        Origin: "https://attacker.invalid",
      })
    ).res.status,
    403,
  );
  assert.equal(
    (await req("/lists", "POST", { name: "Injected" }, member, { Origin: "" }))
      .res.status,
    403,
  );
});
test("signup requires a valid OTP, stores a password hash, prevents replay and issues HttpOnly session", async () => {
  const phone = "0245550101";
  assert.equal(
    (
      await req(
        "/auth/register",
        "POST",
        { name: "Ama", phone, password: "long-test-password", code: "123456" },
        null,
      )
    ).res.status,
    400,
  );
  assert.equal(
    (await req("/auth/otp", "POST", { phone }, null)).res.status,
    200,
  );
  assert.equal(
    (
      await req(
        "/auth/register",
        "POST",
        { name: "Ama", phone, password: "long-test-password", code: "111111" },
        null,
      )
    ).res.status,
    502,
  );
  const result = await req(
    "/auth/register",
    "POST",
    { name: "Ama", phone, password: "long-test-password", code: "123456" },
    null,
  );
  assert.equal(result.res.status, 201);
  assert.match(result.res.headers.get("set-cookie")!, /HttpOnly/);
  assert.notEqual(
    one("SELECT password_hash FROM users WHERE phone=?", normalizePhone(phone))!
      .password_hash,
    "long-test-password",
  );
  assert.equal(
    (
      await req(
        "/auth/reset-password",
        "POST",
        { phone, password: "changed-password", code: "123456" },
        null,
      )
    ).res.status,
    400,
  );
  const login = await req(
    "/auth/login",
    "POST",
    { phone, password: "long-test-password" },
    null,
  );
  assert.equal(login.res.status, 200);
  assert.equal(
    (await req("/auth/login", "POST", { phone, password: "wrong" }, null)).res
      .status,
    401,
  );
  assert.equal(
    (
      await req(
        "/auth/login",
        "POST",
        { phone, password: "long-test-password", admin: true },
        null,
      )
    ).res.status,
    401,
  );
});
test("OTP expiry, five-attempt cap and resend cooldown are enforced", async () => {
  const phone = "+233245550102";
  await req("/auth/otp", "POST", { phone }, null);
  assert.equal(
    (await req("/auth/otp", "POST", { phone }, null)).res.status,
    429,
  );
  run("UPDATE otp_requests SET attempts=5 WHERE phone=?", phone);
  assert.equal(
    (
      await req(
        "/auth/register",
        "POST",
        {
          name: "Blocked",
          phone,
          password: "long-test-password",
          code: "123456",
        },
        null,
      )
    ).res.status,
    400,
  );
  run(
    "UPDATE otp_requests SET attempts=0,requested_at=? WHERE phone=?",
    Date.now() - 301000,
    phone,
  );
  assert.equal(
    (
      await req(
        "/auth/register",
        "POST",
        {
          name: "Expired",
          phone,
          password: "long-test-password",
          code: "123456",
        },
        null,
      )
    ).res.status,
    400,
  );
});
test("CSV import normalizes, deduplicates, reports invalid rows and requires consent", async () => {
  const list = newList();
  const f = new FormData();
  f.append(
    "file",
    new File(
      [
        "name,phone\nAma,0241234567\nDuplicate,+233241234567\nBad,nope\nKojo,0201234567",
      ],
      "contacts.csv",
      { type: "text/csv" },
    ),
  );
  assert.equal((await req(`/lists/${list}/import`, "POST", f)).res.status, 400);
  f.append("consent", "true");
  const r = await req(`/lists/${list}/import`, "POST", f);
  assert.equal(r.res.status, 200);
  assert.equal(r.data.inserted, 2);
  assert.equal(r.data.duplicates, 1);
  assert.equal(r.data.invalidCount, 1);
  assert.equal(
    (await req(`/lists/${list}/contacts`, "GET", undefined, other)).res.status,
    404,
  );
  assert.equal(
    (await req(`/lists/${list}`, "DELETE", undefined, other)).res.status,
    404,
  );
});
test("shared lists are pending until admin approval and do not reveal contacts", async () => {
  const list = (
    await req("/lists", "POST", {
      name: "Community leads",
      visibility: "shared",
    })
  ).data.id;
  addContact(list, "+233245550201");
  assert.equal(
    one("SELECT status FROM lists WHERE id=?", list)!.status,
    "pending",
  );
  assert.equal(
    (
      await req(
        "/campaigns",
        "POST",
        {
          name: "Blocked list",
          channel: "sms",
          message: "Hello",
          listIds: [list],
        },
        other,
      )
    ).res.status,
    403,
  );
  await req("/admin/lists/" + list, "PATCH", { status: "approved" }, admin);
  assert.equal(
    (await req("/lists?shared=true", "GET", undefined, other)).data.lists.some(
      (l: any) => l.id === list,
    ),
    true,
  );
  assert.equal(
    (await req(`/lists/${list}/contacts`, "GET", undefined, other)).res.status,
    404,
  );
  const c = await campaign([list], {}, other);
  assert.ok(c);
});
test("queue snapshots recipients, excludes opt-outs, deduplicates and atomically reserves allowance once", async () => {
  const a = newList(),
    b = newList();
  addContact(a, "+233245550301");
  addContact(a, "+233245550302");
  addContact(b, "+233245550301");
  run(
    "INSERT INTO suppressions(phone,reason) VALUES(?,?)",
    "+233245550302",
    "Requested",
  );
  const before = one(
    "SELECT allowance FROM users WHERE id=?",
    member,
  )!.allowance;
  const c = await campaign([a, b]);
  const r = await req(`/campaigns/${c}/queue`, "POST");
  assert.equal(r.res.status, 200);
  assert.equal(
    one("SELECT count(*) AS n FROM deliveries WHERE campaign_id=?", c)!.n,
    1,
  );
  assert.equal(
    one("SELECT allowance FROM users WHERE id=?", member)!.allowance,
    before - 1,
  );
  assert.equal((await req(`/campaigns/${c}/queue`, "POST")).res.status, 409);
  assert.equal((await req(`/campaigns/${c}/cancel`, "POST")).res.status, 200);
  assert.equal(
    one("SELECT allowance FROM users WHERE id=?", member)!.allowance,
    before,
  );
  assert.equal((await req(`/campaigns/${c}/cancel`, "POST")).res.status, 409);
});
test("insufficient allowance rolls back delivery rows and leaves draft unchanged", async () => {
  const list = newList(other);
  addContact(list, "+233245550401");
  run("UPDATE users SET allowance=0 WHERE id=?", other);
  const c = await campaign([list], {}, other);
  assert.equal(
    (await req(`/campaigns/${c}/queue`, "POST", {}, other)).res.status,
    400,
  );
  assert.equal(
    one("SELECT status FROM campaigns WHERE id=?", c)!.status,
    "draft",
  );
  assert.equal(
    one("SELECT count(*) AS n FROM deliveries WHERE campaign_id=?", c)!.n,
    0,
  );
  run("UPDATE users SET allowance=100000 WHERE id=?", other);
});
test("worker submits a batch once and records acceptance without claiming delivery", async () => {
  const list = newList();
  addContact(list, "+233245550501");
  const c = await campaign([list]);
  await req(`/campaigns/${c}/queue`, "POST");
  let calls = 0;
  await processOne(async (_, phones) => {
    calls++;
    return phones.map((phone) => ({
      phone,
      providerId: "test-provider-" + phone,
    }));
  });
  assert.equal(calls, 1);
  assert.equal(
    one("SELECT status FROM campaigns WHERE id=?", c)!.status,
    "completed",
  );
  assert.equal(
    one("SELECT status FROM deliveries WHERE campaign_id=?", c)!.status,
    "accepted",
  );
  await processOne(async () => {
    calls++;
    return [];
  });
  assert.equal(calls, 1);
});
test("scheduled messages wait, new opt-outs are checked before dispatch", async () => {
  const list = newList();
  addContact(list, "+233245550601");
  const c = await campaign([list], { scheduledAt: Date.now() + 3600000 });
  await req(`/campaigns/${c}/queue`, "POST");
  let calls = 0;
  assert.equal(
    await processOne(async () => {
      calls++;
      return [];
    }),
    false,
  );
  run(
    "INSERT INTO suppressions(phone,reason) VALUES(?,?)",
    "+233245550601",
    "Late opt-out",
  );
  run("UPDATE campaigns SET scheduled_at=? WHERE id=?", Date.now() - 1, c);
  await processOne(async () => {
    calls++;
    return [];
  });
  assert.equal(calls, 0);
  assert.equal(
    one("SELECT status FROM deliveries WHERE campaign_id=?", c)!.status,
    "cancelled",
  );
});
test("gateway timeout never causes an automatic duplicate send", async () => {
  const list = newList();
  addContact(list, "+233245550701");
  const c = await campaign([list]);
  await req(`/campaigns/${c}/queue`, "POST");
  let calls = 0;
  const send = async () => {
    calls++;
    throw new ProviderError("timeout", true);
  };
  await processOne(send);
  await processOne(send);
  assert.equal(calls, 1);
  assert.equal(
    one("SELECT status FROM campaigns WHERE id=?", c)!.status,
    "attention",
  );
  assert.equal(
    one("SELECT status FROM deliveries WHERE campaign_id=?", c)!.status,
    "unknown",
  );
});
test("a crashed worker marks its in-flight recipients unknown without requeueing them", async () => {
  const list = newList();
  addContact(list, "+233245550801");
  const c = await campaign([list]);
  await req(`/campaigns/${c}/queue`, "POST");
  run(
    "UPDATE campaigns SET status='processing',lease_until=? WHERE id=?",
    Date.now() - 1,
    c,
  );
  run("UPDATE deliveries SET status='sending' WHERE campaign_id=?", c);
  let calls = 0;
  await processOne(async () => {
    calls++;
    return [];
  });
  assert.equal(calls, 0);
  assert.equal(
    one("SELECT status FROM deliveries WHERE campaign_id=?", c)!.status,
    "unknown",
  );
});
test("suspending an owner stops queued sending and revokes sessions", async () => {
  const list = newList(other);
  addContact(list, "+233245550901");
  const c = await campaign([list], {}, other);
  await req(`/campaigns/${c}/queue`, "POST", {}, other);
  await req("/admin/users/" + other, "PATCH", { status: "suspended" }, admin);
  let calls = 0;
  await processOne(async () => {
    calls++;
    return [];
  });
  assert.equal(calls, 0);
  assert.equal(
    one("SELECT status FROM campaigns WHERE id=?", c)!.status,
    "attention",
  );
  assert.equal((await req("/lists", "GET", undefined, other)).res.status, 401);
});
test("webhook signatures reject forgery and replay, and bind provider id to recipient", async () => {
  const delivery = one("SELECT * FROM deliveries WHERE status='accepted'")!;
  const payload = {
    id: delivery.provider_id,
    recipient: delivery.phone.slice(1),
    status: "DELIVERED",
  };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", process.env.ARKESEL_WEBHOOK_SECRET!)
    .update(timestamp + "." + canonical(payload))
    .digest("hex");
  assert.equal(
    verifyWebhook(
      payload,
      timestamp,
      "v1=" + signature,
      process.env.ARKESEL_WEBHOOK_SECRET!,
    ),
    true,
  );
  assert.equal(
    verifyWebhook(
      payload,
      "1",
      "v1=" + signature,
      process.env.ARKESEL_WEBHOOK_SECRET!,
    ),
    false,
  );
  const headers = {
    "x-arkesel-webhook-timestamp": timestamp,
    "x-arkesel-webhook-signature": "v1=" + signature,
    "x-arkesel-webhook-id": "event-001",
  };
  assert.equal(
    (
      await req("/webhooks/arkesel", "POST", payload, null, {
        ...headers,
        "x-arkesel-webhook-signature": "v1=" + "0".repeat(64),
      })
    ).res.status,
    401,
  );
  assert.equal(
    (await req("/webhooks/arkesel", "POST", payload, null, headers)).res.status,
    200,
  );
  assert.equal(
    one("SELECT status FROM deliveries WHERE id=?", delivery.id)!.status,
    "delivered",
  );
  await req("/webhooks/arkesel", "POST", payload, null, headers);
  assert.equal(
    one("SELECT count(*) AS n FROM webhook_events WHERE id=?", "event-001")!.n,
    1,
  );
});
test("voice uploads check file signature and enforce ownership", async () => {
  const bad = new FormData();
  bad.append("file", new File(["<script>bad</script>"], "fake.mp3"));
  assert.equal((await req("/audio", "POST", bad)).res.status, 400);
  const form = new FormData();
  form.append(
    "file",
    new File([Buffer.from("RIFF0000WAVEfmt ")], "voice.wav", {
      type: "audio/wav",
    }),
  );
  const r = await req("/audio", "POST", form);
  assert.equal(r.res.status, 201);
  const list = newList();
  addContact(list, "+233245551001");
  const c = await campaign([list], {
    channel: "voice",
    message: "",
    audioId: r.data.id,
  });
  await req(`/campaigns/${c}/queue`, "POST");
  await processOne();
  assert.equal(
    one("SELECT status FROM deliveries WHERE campaign_id=?", c)!.status,
    "accepted",
  );
  const wrong = await apiApp.request(
    "http://localhost:3100/api/audio/" + r.data.id,
    { headers: { Cookie: `ndc_session=${admin}` } },
  );
  assert.equal(wrong.status, 404);
});
test("provider adapter uses real SMS/voice formats, verifies OTP code 1100, fails closed on malformed success", async () => {
  const original = globalThis.fetch;
  process.env.MOCK_PROVIDER = "false";
  const calls: { url: string; init: RequestInit }[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return Response.json(
        String(url).endsWith("/verify")
          ? { code: "1100" }
          : String(url).includes("/voice/")
            ? { status: "success", data: { campaign_id: "voice-id" } }
            : {
                status: "success",
                data: [{ recipient: "233245551101", id: "sms-id" }],
              },
      );
    };
    assert.equal(
      (
        await sendBatch({ channel: "sms", sender: "NDC", message: "Hello" }, [
          "+233245551101",
        ])
      )[0].providerId,
      "sms-id",
    );
    assert.deepEqual(JSON.parse(calls[0].init.body as string).recipients, [
      "233245551101",
    ]);
    const audioId = randomUUID();
    await writeFile(resolve(directory, "uploads", audioId), "ID3test");
    await sendBatch(
      { channel: "voice", sender: "0240000000" },
      ["+233245551101"],
      { id: audioId, mime: "audio/mpeg", filename: "voice.mp3" },
    );
    const form = calls[1].init.body as FormData;
    assert.ok(form.get("voice_file") instanceof File);
    assert.equal(form.get("voice_id"), "0240000000");
    assert.deepEqual(form.getAll("recipients[]"), ["233245551101"]);
    assert.equal(form.get("retry"), "false");
    await verifyOtp("+233245551101", "123456");
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(() => verifyOtp("+233245551101", "123456"));
    globalThis.fetch = async () => {
      throw new Error("network loss");
    };
    await assert.rejects(
      () =>
        sendBatch({ channel: "sms", sender: "NDC", message: "Hello" }, [
          "+233245551101",
        ]),
      (e: any) => e.uncertain === true,
    );
  } finally {
    globalThis.fetch = original;
    process.env.MOCK_PROVIDER = "true";
  }
});
test("production refuses the mock provider", () => {
  process.env.NODE_ENV = "production";
  assert.throws(() => assertProvider(), /forbidden/);
  process.env.NODE_ENV = "test";
});
test("Google callback rejects missing state without contacting Google", async () => {
  const r = await apiApp.request(
    "http://localhost:3100/api/auth/google/callback?code=bad&state=bad",
  );
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/login?error=google");
});
test("SMS callbacks without phone numbers are replayed when the send response arrives", async () => {
  const list = newList();
  addContact(list, "+233245551201");
  const c = await campaign([list]);
  await req(`/campaigns/${c}/queue`, "POST");
  const payload = { sms_id: "early-provider-id", status: "DELIVERED" };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", process.env.ARKESEL_WEBHOOK_SECRET!)
    .update(timestamp + "." + canonical(payload))
    .digest("hex");
  await processOne(async (_, phones) => {
    const r = await req("/webhooks/arkesel", "POST", payload, null, {
      "x-arkesel-webhook-timestamp": timestamp,
      "x-arkesel-webhook-signature": "v1=" + signature,
      "x-arkesel-webhook-id": "early-callback",
    });
    assert.equal(r.res.status, 200);
    return phones.map((phone) => ({ phone, providerId: "early-provider-id" }));
  });
  assert.equal(
    one("SELECT status FROM deliveries WHERE campaign_id=?", c)!.status,
    "delivered",
  );
  assert.equal(
    one("SELECT processed FROM webhook_events WHERE id=?", "early-callback")!
      .processed,
    1,
  );
});
test("shared-only recipient numbers are masked in member reports and exports", async () => {
  const list = newList(admin, "shared");
  addContact(list, "+233245551301");
  const c = await campaign([list]);
  await req(`/campaigns/${c}/queue`, "POST");
  const detail = await req("/campaigns/" + c);
  assert.equal(detail.data.deliveries[0].phone, "+233••••301");
  const exportResponse = await apiApp.request(
    "http://localhost:3100/api/campaigns/" + c + "/export",
    { headers: { Cookie: `ndc_session=${member}` } },
  );
  assert.ok(!(await exportResponse.text()).includes("245551301"));
  await req(`/campaigns/${c}/cancel`, "POST");
});
test("resume sends only pending recipients and never retries an ambiguous batch", async () => {
  const list = newList();
  for (let i = 0; i < 101; i++)
    addContact(list, "+23324666" + String(i).padStart(4, "0"));
  const c = await campaign([list]);
  await req(`/campaigns/${c}/queue`, "POST");
  await processOne(async () => {
    throw new ProviderError("timeout", true);
  });
  assert.equal(
    one(
      "SELECT count(*) AS n FROM deliveries WHERE campaign_id=? AND status='unknown'",
      c,
    )!.n,
    100,
  );
  assert.equal((await req(`/campaigns/${c}/resume`, "POST")).res.status, 200);
  let count = 0;
  await processOne(async (_, phones) => {
    count += phones.length;
    return phones.map((phone) => ({ phone, providerId: "resumed-" + phone }));
  });
  assert.equal(count, 1);
  assert.equal(
    one(
      "SELECT count(*) AS n FROM deliveries WHERE campaign_id=? AND status='unknown'",
      c,
    )!.n,
    100,
  );
});

test("an obsolete worker claim cannot overwrite cancellation or dispatch another batch", async () => {
  const list = newList();
  for (let i = 0; i < 101; i++)
    addContact(list, "+23324777" + String(i).padStart(4, "0"));
  const c = await campaign([list]);
  await req(`/campaigns/${c}/queue`, "POST");
  let sent = 0;
  await processOne(async (_, phones) => {
    sent += phones.length;
    // Simulate a paused old worker, lease recovery by another worker, then cancellation.
    run("UPDATE campaigns SET lease_until=? WHERE id=?", Date.now() - 1, c);
    await processOne(async () => {
      throw new Error("No new claim should be sent");
    });
    assert.equal((await req(`/campaigns/${c}/cancel`, "POST")).res.status, 200);
    return phones.map((phone) => ({
      phone,
      providerId: "late-result-" + phone,
    }));
  });
  assert.equal(sent, 100);
  assert.equal(
    one("SELECT status FROM campaigns WHERE id=?", c)!.status,
    "cancelled",
  );
  assert.equal(
    one(
      "SELECT count(*) AS n FROM deliveries WHERE campaign_id=? AND status='cancelled'",
      c,
    )!.n,
    1,
  );
});
test("registration rejects passwords that bcrypt would silently truncate", async () => {
  const r = await req(
    "/auth/register",
    "POST",
    {
      name: "Long Password",
      phone: "0245550105",
      password: "🙂".repeat(20),
      code: "123456",
    },
    null,
  );
  assert.equal(r.res.status, 400);
  assert.match(r.data.error, /72 UTF-8/);
});

test("manual contacts append to an imported list and reject normalized duplicates", async () => {
  const list = newList();
  const csv = new FormData();
  csv.append("consent", "true");
  csv.append(
    "file",
    new File(["name,phone\nOriginal contact,0245553301"], "contacts.csv"),
  );
  assert.equal(
    (await req(`/lists/${list}/import`, "POST", csv)).data.inserted,
    1,
  );
  const original = one("SELECT * FROM contacts WHERE list_id=?", list)!;
  const result = await req(`/lists/${list}/contacts`, "POST", {
    name: "  New contact  ",
    phone: "024 555 3302",
    consent: true,
  });
  assert.equal(result.res.status, 201);
  assert.equal(result.data.contact.name, "New contact");
  assert.equal(result.data.contact.phone, "+233245553302");
  assert.equal(
    one("SELECT count(*) AS n FROM contacts WHERE list_id=?", list)!.n,
    2,
  );
  assert.deepEqual(
    one("SELECT * FROM contacts WHERE id=?", original.id),
    original,
  );
  assert.equal(
    (
      await req(`/lists/${list}/contacts`, "POST", {
        name: "Changed name",
        phone: "+233245553302",
        consent: true,
      })
    ).res.status,
    409,
  );
  assert.equal(
    one("SELECT name FROM contacts WHERE id=?", result.data.contact.id)!.name,
    "New contact",
  );
  assert.equal(
    one(
      "SELECT count(*) AS n FROM audit_log WHERE action='contact.added' AND target_id=?",
      list,
    )!.n,
    1,
  );
  // A later CSV also appends without overwriting manually entered contacts.
  const more = new FormData();
  more.append("consent", "true");
  more.append(
    "file",
    new File(
      ["name,phone\nDuplicate,0245553302\nMore contacts,0245553303"],
      "more.csv",
    ),
  );
  const imported = await req(`/lists/${list}/import`, "POST", more);
  assert.equal(imported.data.inserted, 1);
  assert.equal(imported.data.duplicates, 1);
  assert.equal(
    one("SELECT count(*) AS n FROM contacts WHERE list_id=?", list)!.n,
    3,
  );
  assert.equal(
    one("SELECT name FROM contacts WHERE id=?", result.data.contact.id)!.name,
    "New contact",
  );
});

test("manual additions enforce validation, consent, authentication, and list permissions", async () => {
  const list = newList();
  const input = { phone: "0245553401", consent: true };
  assert.equal(
    (await req(`/lists/${list}/contacts`, "POST", input, null)).res.status,
    401,
  );
  for (const body of [
    { phone: input.phone },
    { ...input, consent: false },
    { ...input, phone: "not-a-phone" },
    { ...input, name: "a".repeat(101) },
  ]) {
    assert.equal(
      (await req(`/lists/${list}/contacts`, "POST", body)).res.status,
      400,
    );
  }
  assert.equal(
    one("SELECT count(*) AS n FROM contacts WHERE list_id=?", list)!.n,
    0,
  );
  const privateList = newList(admin);
  assert.equal(
    (await req(`/lists/${privateList}/contacts`, "POST", input)).res.status,
    404,
  );
  const sharedList = newList(admin, "shared");
  assert.equal(
    (await req(`/lists/${sharedList}/contacts`, "POST", input)).res.status,
    404,
  );
  assert.equal(
    (await req(`/lists/${randomUUID()}/contacts`, "POST", input)).res.status,
    404,
  );
  const authorized = await req(`/lists/${list}/contacts`, "POST", input, admin);
  assert.equal(authorized.res.status, 201);
  assert.equal(authorized.data.contact.name, "");
});

test("manually changed shared audiences require reapproval while admin additions remain approved", async () => {
  const list = newList(member, "shared");
  await req(`/lists/${list}/contacts`, "POST", {
    phone: "0245553501",
    consent: true,
  });
  assert.equal(
    one("SELECT status FROM lists WHERE id=?", list)!.status,
    "pending",
  );
  assert.equal(
    (await req("/lists?shared=true")).data.lists.some(
      (l: any) => l.id === list,
    ),
    false,
  );
  await req(`/admin/lists/${list}`, "PATCH", { status: "approved" }, admin);
  await req(
    `/lists/${list}/contacts`,
    "POST",
    { phone: "0245553502", consent: true },
    admin,
  );
  assert.equal(
    one("SELECT status FROM lists WHERE id=?", list)!.status,
    "approved",
  );
  // A rejected duplicate must not invalidate an otherwise approved list.
  assert.equal(
    (
      await req(`/lists/${list}/contacts`, "POST", {
        phone: "0245553501",
        consent: true,
      })
    ).res.status,
    409,
  );
  assert.equal(
    one("SELECT status FROM lists WHERE id=?", list)!.status,
    "approved",
  );
});

test("ordinary session checks never consume the authentication attempt limit", async () => {
  const previousTrust = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "false";
  run("DELETE FROM rate_limits WHERE key=?", "auth-ip:local");
  try {
    for (let i = 0; i < 60; i++) {
      const result = await req(
        "/auth/me",
        "GET",
        undefined,
        i % 2 ? member : null,
      );
      assert.equal(result.res.status, 200);
      assert.equal(result.data.user?.id ?? null, i % 2 ? member : null);
    }
    assert.equal(
      one("SELECT count FROM rate_limits WHERE key=?", "auth-ip:local"),
      undefined,
    );
  } finally {
    if (previousTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrust;
    run("DELETE FROM rate_limits WHERE key=?", "auth-ip:local");
  }
});

test("session checks and logout work during a sign-in lockout while sensitive auth endpoints stay limited", async () => {
  const previousTrust = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "false";
  const logoutToken = randomUUID();
  run(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    hash(logoutToken),
    member,
    Date.now() + 60000,
  );
  run(
    "INSERT OR REPLACE INTO rate_limits(key,count,reset_at) VALUES(?,50,?)",
    "auth-ip:local",
    Date.now() + 900000,
  );
  try {
    const signedIn = await req("/auth/me", "GET", undefined, logoutToken);
    assert.equal(signedIn.res.status, 200);
    assert.equal(signedIn.data.user.id, member);
    const signedOut = await req("/auth/me", "GET", undefined, null);
    assert.equal(signedOut.res.status, 200);
    assert.equal(signedOut.data.user, null);
    assert.equal(
      (await req("/auth/logout", "POST", {}, logoutToken)).res.status,
      200,
    );
    assert.equal(
      one(
        "SELECT token_hash FROM sessions WHERE token_hash=?",
        hash(logoutToken),
      ),
      undefined,
    );
    assert.equal(
      one("SELECT count FROM rate_limits WHERE key=?", "auth-ip:local")!.count,
      50,
    );
    for (const path of [
      "/auth/login",
      "/auth/otp",
      "/auth/register",
      "/auth/reset-password",
    ]) {
      assert.equal((await req(path, "POST", {}, null)).res.status, 429, path);
    }
    assert.equal(
      (await req("/auth/google", "GET", undefined, null)).res.status,
      429,
    );
    assert.equal(
      (await req("/auth/me", "GET", undefined, member)).res.status,
      200,
    );
  } finally {
    if (previousTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrust;
    run("DELETE FROM rate_limits WHERE key=?", "auth-ip:local");
    run("DELETE FROM sessions WHERE token_hash=?", hash(logoutToken));
  }
});

test("live-mode voice campaigns can be created, queued, and sent with an optional caller ID", async () => {
  const originalFetch = globalThis.fetch;
  const previousVoiceId = process.env.ARKESEL_VOICE_ID;
  const previousMock = process.env.MOCK_PROVIDER;
  const previousNodeEnv = process.env.NODE_ENV;
  const list = newList();
  addContact(list, "+233245553601");
  const recording = new FormData();
  recording.append(
    "file",
    new File([Buffer.from("RIFF0000WAVEfmt ")], "optional-caller.wav", {
      type: "audio/wav",
    }),
  );
  const uploaded = await req("/audio", "POST", recording);
  assert.equal(uploaded.res.status, 201);
  const requests: FormData[] = [];
  try {
    // Exercise the real request adapter without contacting Arkesel or any recipients.
    process.env.MOCK_PROVIDER = "false";
    process.env.NODE_ENV = "production";
    globalThis.fetch = async (url, init) => {
      assert.equal(
        String(url),
        "https://sms.arkesel.com/api/v2/sms/voice/send",
      );
      assert.ok(init?.body instanceof FormData);
      requests.push(init.body);
      return Response.json({
        status: "success",
        data: { campaign_id: "optional-voice-" + requests.length },
      });
    };
    for (const configured of [undefined, "", "   ", " 0240000000 "]) {
      if (configured === undefined) delete process.env.ARKESEL_VOICE_ID;
      else process.env.ARKESEL_VOICE_ID = configured;
      assert.equal(
        (await req("/config", "GET", undefined, null)).data.voiceEnabled,
        true,
      );
      const campaignId = await campaign([list], {
        channel: "voice",
        message: "",
        audioId: uploaded.data.id,
      });
      assert.equal(
        one("SELECT sender FROM campaigns WHERE id=?", campaignId)!.sender,
        configured?.trim() || "",
      );
      assert.equal(
        (await req(`/campaigns/${campaignId}/queue`, "POST")).res.status,
        200,
      );
      assert.equal(await processOne(), true);
      const form = requests.at(-1)!;
      assert.equal(form.has("voice_id"), Boolean(configured?.trim()));
      if (configured?.trim()) assert.equal(form.get("voice_id"), "0240000000");
      assert.ok(form.get("voice_file") instanceof File);
      assert.deepEqual(form.getAll("recipients[]"), ["233245553601"]);
      assert.equal(form.get("retry"), "false");
      assert.equal(
        one("SELECT status FROM campaigns WHERE id=?", campaignId)!.status,
        "completed",
      );
      assert.equal(
        one("SELECT status FROM deliveries WHERE campaign_id=?", campaignId)!
          .status,
        "accepted",
      );
    }
    assert.equal(requests.length, 4);
    // Older blank sender values are also omitted directly by the adapter.
    const audio = one(
      "SELECT * FROM audio_files WHERE id=?",
      uploaded.data.id,
    )!;
    await sendBatch(
      { channel: "voice", sender: "   " },
      ["+233245553601"],
      audio,
    );
    assert.equal(requests.at(-1)!.has("voice_id"), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      ARKESEL_VOICE_ID: previousVoiceId,
      MOCK_PROVIDER: previousMock,
      NODE_ENV: previousNodeEnv,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("only administrators can switch configured providers; campaigns pin their provider and sender", async () => {
  const previousMock = process.env.MOCK_PROVIDER;
  const previousKey = process.env.MNOTIFY_API_KEY;
  const previousSender = process.env.MNOTIFY_SENDER_ID;
  try {
    assert.equal(
      (await req("/admin/gateway", "PATCH", { provider: "mnotify" })).res
        .status,
      403,
    );
    assert.equal(
      (await req("/admin/gateway", "PATCH", { provider: "mnotify" }, null)).res
        .status,
      401,
    );
    assert.equal(
      (
        await req("/admin/gateway", "PATCH", { provider: "mnotify" }, admin, {
          Origin: "https://evil.test",
        })
      ).res.status,
      403,
    );
    assert.equal(
      (await req("/admin/gateway", "PATCH", { provider: "invalid" }, admin)).res
        .status,
      400,
    );
    process.env.MOCK_PROVIDER = "false";
    delete process.env.MNOTIFY_API_KEY;
    assert.equal(
      (await req("/admin/gateway", "PATCH", { provider: "mnotify" }, admin)).res
        .status,
      502,
    );
    assert.equal(
      one("SELECT value FROM settings WHERE key='messaging_provider'")!.value,
      "arkesel",
    );
    const list = newList();
    addContact(list, "+233245557001");
    const original = await campaign([list]);
    process.env.MNOTIFY_API_KEY = "mnotify-test-only-key";
    process.env.MNOTIFY_SENDER_ID = "NDCtest";
    assert.equal(
      (await req("/admin/gateway", "PATCH", { provider: "mnotify" }, admin)).res
        .status,
      200,
    );
    assert.equal(
      one("SELECT value FROM settings WHERE key='messaging_provider'")!.value,
      "mnotify",
    );
    const config = (await req("/config")).data;
    assert.equal(config.provider, "mnotify");
    assert.equal(config.sender, "NDCtest");
    assert.equal(config.voiceEnabled, true);
    const current = await campaign([list]);
    assert.equal(
      one("SELECT provider FROM campaigns WHERE id=?", original)!.provider,
      "arkesel",
    );
    assert.equal(
      one("SELECT provider,sender FROM campaigns WHERE id=?", current)!.sender,
      "NDCtest",
    );
    assert.equal(
      one("SELECT provider FROM campaigns WHERE id=?", current)!.provider,
      "mnotify",
    );
    const gateway = (await req("/admin/gateway", "GET", undefined, admin)).data;
    assert.equal(gateway.providers.length, 2);
    assert.equal(
      JSON.stringify(gateway).includes("mnotify-test-only-key"),
      false,
    );
    assert.ok(
      one(
        "SELECT id FROM audit_log WHERE action='gateway.provider_changed' AND actor_id=?",
        admin,
      ),
    );
    await req("/admin/gateway", "PATCH", { provider: "arkesel" }, admin);
    delete process.env.MNOTIFY_API_KEY;
    assert.equal(
      (await req(`/campaigns/${current}/queue`, "POST")).res.status,
      502,
    );
    process.env.MOCK_PROVIDER = "true";
    assert.equal(
      (await req(`/campaigns/${current}/queue`, "POST")).res.status,
      200,
    );
    let usedProvider = "";
    await processOne(async (c, phones) => {
      usedProvider = c.provider;
      return phones.map((phone) => ({ phone, providerId: "pinned-provider" }));
    });
    assert.equal(usedProvider, "mnotify");
  } finally {
    run("UPDATE settings SET value='arkesel' WHERE key='messaging_provider'");
    for (const [key, value] of Object.entries({
      MOCK_PROVIDER: previousMock,
      MNOTIFY_API_KEY: previousKey,
      MNOTIFY_SENDER_ID: previousSender,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

async function realMnotify(testCase: () => Promise<void>) {
  const previous = {
    MOCK_PROVIDER: process.env.MOCK_PROVIDER,
    MNOTIFY_API_KEY: process.env.MNOTIFY_API_KEY,
  };
  const originalFetch = globalThis.fetch;
  process.env.MOCK_PROVIDER = "false";
  process.env.MNOTIFY_API_KEY = "mnotify-test-only-key";
  try {
    await testCase();
  } finally {
    globalThis.fetch = originalFetch;
    run("UPDATE settings SET value='arkesel' WHERE key='messaging_provider'");
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("mNotify SMS and voice use documented payloads and only confirm explicitly accepted recipients", async () =>
  realMnotify(async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: new URL(String(url)), init });
      return Response.json({
        status: "success",
        code: "2000",
        summary: {
          _id: "mnotify-batch",
          numbers_sent: ["0245557002"],
          total_rejected: 1,
        },
      });
    };
    const phones = ["+233245557002", "+233245557003"];
    const result = await sendBatch(
      {
        provider: "mnotify",
        channel: "sms",
        sender: "NDCtest",
        message: "Hello",
      },
      phones,
    );
    assert.deepEqual(result, [
      { phone: phones[0], providerId: "mnotify-batch" },
      { phone: phones[1], providerId: null },
    ]);
    assert.equal(calls[0].url.origin, "https://api.mnotify.com");
    assert.equal(calls[0].url.pathname, "/api/sms/quick");
    assert.equal(calls[0].url.searchParams.get("key"), "mnotify-test-only-key");
    assert.equal(calls[0].init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      recipient: ["233245557002", "233245557003"],
      sender: "NDCtest",
      message: "Hello",
      is_schedule: false,
      schedule_date: "",
    });
    const recording = new FormData();
    recording.append(
      "file",
      new File([Buffer.from("RIFF0000WAVEfmt ")], "mnotify.wav", {
        type: "audio/wav",
      }),
    );
    const uploaded = await req("/audio", "POST", recording);
    const audio = one(
      "SELECT * FROM audio_files WHERE id=?",
      uploaded.data.id,
    )!;
    await sendBatch(
      {
        provider: "mnotify",
        channel: "voice",
        name: "Voice campaign",
        sender: "0240000000",
      },
      phones,
      audio,
    );
    assert.equal(calls[1].url.pathname, "/api/voice/quick");
    const form = calls[1].init?.body as FormData;
    assert.deepEqual(form.getAll("recipient[]"), [
      "233245557002",
      "233245557003",
    ]);
    assert.equal(form.get("campaign"), "Voice campaign");
    assert.equal(form.get("is_schedule"), "false");
    assert.ok(form.get("file") instanceof File);
    assert.equal(form.has("voice_id"), false);
    assert.equal(form.has("sender"), false);
    assert.equal(form.has("voice_file"), false);
    assert.equal(await (form.get("file") as File).text(), "RIFF0000WAVEfmt ");
    globalThis.fetch = async () =>
      Response.json({
        status: "success",
        code: "2000",
        summary: { _id: "without-recipients" },
      });
    assert.equal(
      (await sendBatch({ provider: "mnotify", channel: "sms" }, phones))[0]
        .providerId,
      null,
    );
    globalThis.fetch = async () => {
      throw new Error("private URL and key");
    };
    await assert.rejects(
      sendBatch({ provider: "mnotify", channel: "sms" }, phones),
      (e: any) =>
        e instanceof ProviderError &&
        e.uncertain &&
        !e.message.includes("private URL"),
    );
    globalThis.fetch = async () =>
      Response.json({
        status: "error",
        code: "1001",
        message: "private account",
      });
    await assert.rejects(
      sendBatch({ provider: "mnotify", channel: "sms" }, phones),
      (e: any) =>
        e instanceof ProviderError &&
        !e.uncertain &&
        !e.message.includes("private account"),
    );
    globalThis.fetch = async () => new Response("invalid", { status: 502 });
    await assert.rejects(
      sendBatch({ provider: "mnotify", channel: "sms" }, phones),
      (e: any) => e.uncertain,
    );
  }));

test("mNotify OTP codes stay hashed, bounded, and verifiable after changing the active provider", async () =>
  realMnotify(async () => {
    run("UPDATE settings SET value='mnotify' WHERE key='messaging_provider'");
    let code = "";
    let requests = 0;
    const phone = "+233245557004";
    globalThis.fetch = async (url, init) => {
      requests++;
      assert.equal(new URL(String(url)).pathname, "/api/sms/quick");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.sms_type, "otp");
      code = body.message.match(/code is (\d{6})/)[1];
      return Response.json({
        status: "success",
        code: "2000",
        summary: { _id: "otp-id", numbers_sent: [phone] },
      });
    };
    const sent = await req("/auth/otp", "POST", { phone }, null);
    assert.equal(sent.res.status, 200);
    assert.equal(sent.data.testCode, undefined);
    const attempt = one("SELECT * FROM otp_requests WHERE phone=?", phone)!;
    assert.equal(attempt.provider, "mnotify");
    assert.notEqual(attempt.code_hash, code);
    assert.match(attempt.code_hash, /^[\da-f-]+:[\da-f]{64}$/);
    assert.equal(
      (await req("/auth/otp", "POST", { phone }, null)).res.status,
      429,
    );
    run("UPDATE settings SET value='arkesel' WHERE key='messaging_provider'");
    const details = {
      name: "mNotify Member",
      phone,
      password: "Mnotify-test-password",
      code: code === "000000" ? "111111" : "000000",
    };
    assert.equal(
      (await req("/auth/register", "POST", details, null)).res.status,
      502,
    );
    details.code = code;
    assert.equal(
      (await req("/auth/register", "POST", details, null)).res.status,
      201,
    );
    assert.equal(
      one("SELECT consumed FROM otp_requests WHERE phone=?", phone)!.consumed,
      1,
    );
    assert.equal(requests, 1);
    assert.equal(
      (
        await req(
          "/auth/reset-password",
          "POST",
          { phone, code, password: "Another-test-password" },
          null,
        )
      ).res.status,
      400,
    );
  }));

test("mNotify reports reconcile by campaign and recipient without crossing provider boundaries or resending", async () =>
  realMnotify(async () => {
    const { refreshMnotifyReports } =
      await import("../apps/web/src/server/reports");
    const { replayReceipts } = await import("../apps/web/src/server/webhooks");
    const list = newList();
    const sms = await campaign([list]);
    const voice = await campaign([list]);
    const arkesel = await campaign([list]);
    run(
      "UPDATE campaigns SET provider='mnotify',created_at=datetime('now','-10 days') WHERE id IN (?,?)",
      sms,
      voice,
    );
    run("UPDATE campaigns SET channel='voice' WHERE id=?", voice);
    for (const id of [sms, voice, arkesel]) {
      run(
        "INSERT INTO deliveries(id,campaign_id,phone,status,provider_id) VALUES(?,?,?,'accepted',?)",
        randomUUID(),
        id,
        "+233245557005",
        id === voice ? "voice-reference" : "same-reference",
      );
      run(
        "INSERT INTO deliveries(id,campaign_id,phone,status,provider_id) VALUES(?,?,?,'accepted',?)",
        randomUUID(),
        id,
        "+233245557006",
        id === voice ? "voice-reference" : "same-reference",
      );
    }
    const urls: string[] = [];
    globalThis.fetch = async (url, init) => {
      assert.equal(init?.method, "GET");
      const path = new URL(String(url)).pathname;
      urls.push(path);
      const isVoice = path.includes("/calls/");
      return Response.json({
        status: "success",
        report: [
          {
            campaign_id: isVoice ? "per-call-reference" : "same-reference",
            recipient: "0245557005",
            status: isVoice ? "received" : "DELIVERED",
          },
          {
            campaign_id: isVoice ? "per-call-reference" : "same-reference",
            recipient: "0245557006",
            status: isVoice ? "missed" : "submitted",
          },
          {
            campaign_id: "wrong-campaign",
            recipient: "0245557006",
            status: "DELIVERED",
          },
        ],
      });
    };
    await refreshMnotifyReports();
    assert.ok(urls.includes("/api/campaign/same-reference"));
    assert.ok(urls.includes("/api/calls/voice-reference"));
    const states = (id: string) =>
      all(
        "SELECT status FROM deliveries WHERE campaign_id=? ORDER BY phone",
        id,
      ).map((d) => d.status);
    assert.deepEqual(states(sms), ["delivered", "accepted"]);
    assert.deepEqual(states(voice), ["delivered", "failed"]);
    assert.deepEqual(states(arkesel), ["accepted", "accepted"]);
    const count = urls.length;
    await refreshMnotifyReports();
    assert.equal(urls.length, count);
    run(
      "INSERT INTO webhook_events(id,created_at,payload) VALUES(?,?,?)",
      randomUUID(),
      Date.now(),
      JSON.stringify({
        sms_id: "same-reference",
        recipient: "0245557006",
        status: "DELIVERED",
      }),
    );
    replayReceipts();
    assert.deepEqual(states(arkesel), ["accepted", "delivered"]);
    assert.deepEqual(states(sms), ["delivered", "accepted"]);
    run("UPDATE deliveries SET report_checked_at=0 WHERE campaign_id=?", sms);
    globalThis.fetch = async () => {
      throw new Error("report outage");
    };
    await refreshMnotifyReports();
    assert.deepEqual(states(sms), ["delivered", "accepted"]);
  }));

test("targeted dispatch sends only the requested campaign and leaves unrelated queued or stale work untouched", async () => {
  const list = newList();
  addContact(list, "+233245557101");
  const earlier = await campaign([list]);
  const target = await campaign([list]);
  const stale = await campaign([list]);
  for (const id of [earlier, target, stale])
    assert.equal((await req(`/campaigns/${id}/queue`, "POST")).res.status, 200);
  run(
    "UPDATE campaigns SET status='processing',lease_until=0 WHERE id=?",
    stale,
  );
  run("UPDATE deliveries SET status='sending' WHERE campaign_id=?", stale);
  const sent: string[] = [];
  const send = async (c: Record<string, any>, phones: string[]) => {
    sent.push(c.id);
    return phones.map((phone) => ({ phone, providerId: "targeted-test" }));
  };
  assert.equal(await processOne(send, target), true);
  assert.deepEqual(sent, [target]);
  assert.equal(
    one("SELECT status FROM campaigns WHERE id=?", earlier)!.status,
    "queued",
  );
  assert.equal(
    one("SELECT status FROM campaigns WHERE id=?", stale)!.status,
    "processing",
  );
  assert.equal(
    one("SELECT status FROM deliveries WHERE campaign_id=?", stale)!.status,
    "sending",
  );
  assert.equal(await processOne(send, target), false);
  assert.equal(await processOne(send, randomUUID()), false);
  assert.deepEqual(sent, [target]);
});

test("unreadable voice files fail before submission and preserve pending recipients for a safe resume", async () => {
  const previousMock = process.env.MOCK_PROVIDER;
  const previousFetch = globalThis.fetch;
  let requests = 0;
  try {
    process.env.MOCK_PROVIDER = "false";
    globalThis.fetch = async () => {
      requests++;
      throw new Error("No network expected");
    };
    const list = newList();
    addContact(list, "+233245557102");
    const audioId = randomUUID();
    run(
      "INSERT INTO audio_files(id,owner_id,filename,mime,size) VALUES(?,?,?,?,?)",
      audioId,
      member,
      "missing.wav",
      "audio/wav",
      16,
    );
    const id = await campaign([list], {
      channel: "voice",
      audioId,
      message: "",
    });
    assert.equal((await req(`/campaigns/${id}/queue`, "POST")).res.status, 200);
    await processOne(undefined, id);
    assert.equal(requests, 0);
    assert.equal(
      one("SELECT status FROM campaigns WHERE id=?", id)!.status,
      "attention",
    );
    assert.match(
      one("SELECT error FROM campaigns WHERE id=?", id)!.error,
      /cannot read the voice recording/,
    );
    assert.equal(
      one("SELECT status FROM deliveries WHERE campaign_id=?", id)!.status,
      "pending",
    );
    assert.equal(
      (await req(`/campaigns/${id}/resume`, "POST")).res.status,
      200,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMock === undefined) delete process.env.MOCK_PROVIDER;
    else process.env.MOCK_PROVIDER = previousMock;
  }
});

test("mNotify accepts count-confirmed batches without numbers_sent but never guesses partial acceptance", async () =>
  realMnotify(async () => {
    const phones = ["+233245557103", "+233245557104"];
    for (const [summary, accepted] of [
      [
        { _id: "batch-counts", total_sent: 2, contacts: 2, total_rejected: 0 },
        true,
      ],
      [
        {
          _id: "batch-counts",
          total_sent: "2",
          contacts: "2",
          total_rejected: "0",
        },
        true,
      ],
      [
        { _id: "partial", total_sent: 1, contacts: 2, total_rejected: 1 },
        false,
      ],
      [{ _id: "missing-rejections", total_sent: 2, contacts: 2 }, false],
      [
        {
          _id: "dropped",
          total_sent: 2,
          contacts: 2,
          total_rejected: 0,
          international_dropped: 1,
        },
        false,
      ],
    ] as const) {
      globalThis.fetch = async () =>
        Response.json({ status: "success", code: "2000", summary });
      const result = await sendBatch(
        {
          provider: "mnotify",
          channel: "sms",
          sender: "Test",
          message: "Test",
        },
        phones,
      );
      assert.equal(
        result.every((row) => Boolean(row.providerId)),
        accepted,
      );
    }
  }));

test("campaign responses distinguish an absent or stale worker from a recent heartbeat", async () => {
  const previous = all(
    "SELECT * FROM audit_log WHERE action='worker.heartbeat'",
  );
  try {
    run("DELETE FROM audit_log WHERE action='worker.heartbeat'");
    assert.equal((await req("/campaigns")).data.workerActive, false);
    run(
      "INSERT INTO audit_log(action,created_at) VALUES('worker.heartbeat',datetime('now','-5 minutes'))",
    );
    assert.equal((await req("/campaigns")).data.workerActive, false);
    run(
      "UPDATE audit_log SET created_at=CURRENT_TIMESTAMP WHERE action='worker.heartbeat'",
    );
    assert.equal((await req("/campaigns")).data.workerActive, true);
  } finally {
    run("DELETE FROM audit_log WHERE action='worker.heartbeat'");
    for (const row of previous)
      run(
        "INSERT INTO audit_log(id,actor_id,action,target_id,detail,created_at) VALUES(?,?,?,?,?,?)",
        row.id,
        row.actor_id,
        row.action,
        row.target_id,
        row.detail,
        row.created_at,
      );
  }
});

test("all seven audio formats upload with validated signatures, correct MIME types, and ownership protection", async () => {
  const formats: [string, Buffer, string][] = [
    ["mp3", Buffer.from("ID3test"), "audio/mpeg"],
    ["wav", Buffer.from("RIFF0000WAVEfmt "), "audio/wav"],
    ["flac", Buffer.from("fLaCtest"), "audio/flac"],
    [
      "aac",
      Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x01, 0x7f, 0xfc]),
      "audio/aac",
    ],
    [
      "wma",
      Buffer.from("3026b2758e66cf11a6d900aa0062ce6c0000", "hex"),
      "audio/x-ms-wma",
    ],
    [
      "m4a",
      Buffer.from("00000018667479704d3441200000000069736f6d4d344120", "hex"),
      "audio/mp4",
    ],
    ["ogg", Buffer.from("OggS\x00header\x01vorbis"), "audio/ogg"],
  ];
  for (const [ext, bytes, mime] of formats) {
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(bytes)], `recording.${ext.toUpperCase()}`, {
        type: "application/octet-stream",
      }),
    );
    const uploaded = await req("/audio", "POST", form);
    assert.equal(uploaded.res.status, 201, ext);
    const response = await apiApp.request(
      "http://localhost:3100/api/audio/" + uploaded.data.id,
      { headers: { Cookie: `ndc_session=${member}` } },
    );
    assert.equal(response.headers.get("content-type"), mime, ext);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const bad = new FormData();
    bad.append("file", new File([Buffer.from("not audio")], `forged.${ext}`));
    assert.equal((await req("/audio", "POST", bad)).res.status, 400, ext);
  }
  const mismatch = new FormData();
  mismatch.append(
    "file",
    new File([Buffer.from("RIFF0000WAVEfmt ")], "renamed.mp3"),
  );
  assert.equal((await req("/audio", "POST", mismatch)).res.status, 400);
});

async function paymentOrder(credits = 25, user = member) {
  const created = await req("/billing/orders", "POST", { credits }, user);
  assert.equal(created.res.status, 201, JSON.stringify(created.data));
  return created.data.order;
}
function paymentDetails(
  order: Record<string, any>,
  transactionId = "PAY-" + randomUUID(),
) {
  return {
    version: order.version,
    transactionId,
    payerName: "Test payer",
    payerPhone: "0245557101",
    payerNetwork: "MTN MoMo",
    paidAmount: (order.total_pesewas / 100).toFixed(2),
    paidAt: new Date().toISOString(),
    note: "Test payment details",
  };
}

test("payment settings use exact pesewa arithmetic and each order keeps its price and receiving account", async () => {
  const saved = all(
    "SELECT * FROM settings WHERE key IN ('voice_rate_pesewas','payment_phone','payment_name','payment_network')",
  );
  try {
    const config = (await req("/billing/settings")).data.settings;
    assert.deepEqual(config, {
      ratePesewas: 40,
      smsRatePesewas: 6,
      phone: "0558641826",
      name: "Ebenezer Kwabena Blay Ackah",
      network: "Mobile Money",
    });
    const order = await paymentOrder(3);
    assert.equal(order.total_pesewas, 120);
    assert.equal(
      (
        await req("/admin/payment-settings", "PATCH", {
          rate: "0.55",
          phone: "0245557102",
          name: "New recipient",
          network: "MTN MoMo",
        })
      ).res.status,
      403,
    );
    assert.equal(
      (
        await req(
          "/admin/payment-settings",
          "PATCH",
          {
            rate: "0.55",
            phone: "0245557102",
            name: "New recipient",
            network: "MTN MoMo",
          },
          admin,
        )
      ).res.status,
      200,
    );
    const next = await paymentOrder(3);
    assert.equal(next.total_pesewas, 165);
    assert.equal(next.payment_name, "New recipient");
    assert.equal(
      one("SELECT total_pesewas FROM payment_requests WHERE id=?", order.id)!
        .total_pesewas,
      120,
    );
    assert.equal(
      one("SELECT payment_phone FROM payment_requests WHERE id=?", order.id)!
        .payment_phone,
      "0558641826",
    );
    assert.equal(
      (
        await req(
          "/admin/payment-settings",
          "PATCH",
          {
            rate: "0.555",
            phone: "0245557102",
            name: "New recipient",
            network: "MTN MoMo",
          },
          admin,
        )
      ).res.status,
      400,
    );
    assert.equal(
      (await req("/billing/orders", "POST", { credits: 1.5 })).res.status,
      400,
    );
    assert.equal(
      (await req("/billing/orders", "POST", { credits: -1 })).res.status,
      400,
    );
    assert.equal(
      (await req("/billing/settings", "GET", undefined, null)).res.status,
      401,
    );
  } finally {
    for (const row of saved)
      run("UPDATE settings SET value=? WHERE key=?", row.value, row.key);
  }
});

test("submitted payments notify admins, reject duplicates and stale reviews, and credit exactly once", async () => {
  const before = one(
    "SELECT allowance,voice_credits FROM users WHERE id=?",
    member,
  )!;
  const order = await paymentOrder(25);
  const details = paymentDetails(order, "MOMO-123456789");
  assert.equal(
    (
      await req(`/billing/orders/${order.id}`, "PATCH", {
        ...details,
        paidAmount: "9.99",
      })
    ).res.status,
    400,
  );
  assert.equal(
    (await req(`/billing/orders/${order.id}`, "PATCH", details, admin)).res
      .status,
    404,
  );
  const submitted = await req(`/billing/orders/${order.id}`, "PATCH", details);
  assert.equal(submitted.res.status, 200);
  assert.equal(submitted.data.order.status, "pending");
  assert.equal(
    one("SELECT voice_credits FROM users WHERE id=?", member)!.voice_credits,
    before.voice_credits,
  );
  assert.ok(
    one(
      "SELECT id FROM notifications WHERE user_id=? AND href=? AND read_at IS NULL",
      admin,
      "/admin/payments?id=" + order.id,
    ),
  );
  const duplicate = await paymentOrder(25);
  assert.equal(
    (
      await req(
        `/billing/orders/${duplicate.id}`,
        "PATCH",
        paymentDetails(duplicate, "momo-123456789"),
      )
    ).res.status,
    409,
  );
  const updated = await req(`/billing/orders/${order.id}`, "PATCH", {
    ...details,
    version: submitted.data.order.version,
    note: "Corrected payer details",
  });
  assert.equal(updated.res.status, 200);
  assert.ok(
    one(
      "SELECT id FROM notifications WHERE user_id=? AND title='Payment details updated' AND href=?",
      admin,
      "/admin/payments?id=" + order.id,
    ),
  );
  assert.equal(
    (
      await req(
        `/admin/payments/${order.id}/review`,
        "POST",
        { decision: "approved", version: submitted.data.order.version },
        admin,
      )
    ).res.status,
    409,
  );
  assert.equal(
    (
      await req(`/admin/payments/${order.id}/review`, "POST", {
        decision: "approved",
        version: updated.data.order.version,
      })
    ).res.status,
    403,
  );
  const reviews = await Promise.all(
    [1, 2].map(() =>
      req(
        `/admin/payments/${order.id}/review`,
        "POST",
        {
          decision: "approved",
          version: updated.data.order.version,
          note: "Payment verified",
        },
        admin,
      ),
    ),
  );
  assert.deepEqual(reviews.map((r) => r.res.status).sort(), [200, 409]);
  assert.equal(
    one("SELECT voice_credits FROM users WHERE id=?", member)!.voice_credits,
    before.voice_credits + 25,
  );
  assert.equal(
    one("SELECT allowance FROM users WHERE id=?", member)!.allowance,
    before.allowance,
  );
  assert.equal(
    one(
      "SELECT count(*) AS n FROM credit_purchases WHERE payment_id=?",
      order.id,
    )!.n,
    1,
  );
  assert.equal(
    (
      await req(`/billing/orders/${order.id}`, "PATCH", {
        ...details,
        version: updated.data.order.version,
      })
    ).res.status,
    409,
  );
  const approved = one("SELECT * FROM payment_requests WHERE id=?", order.id)!;
  assert.equal(approved.reviewer_id, admin);
  const notifications = (await req("/notifications")).data;
  assert.ok(
    notifications.notifications.some(
      (n: any) => n.title === "Voice credits added",
    ),
  );
  const adminNotice = one(
    "SELECT id FROM notifications WHERE user_id=? LIMIT 1",
    admin,
  )!;
  assert.equal(
    (await req(`/notifications/${adminNotice.id}/read`, "POST")).res.status,
    404,
  );
  assert.equal((await req("/notifications/read-all", "POST")).res.status, 200);
  assert.equal((await req("/notifications")).data.unread, 0);
  assert.equal(
    (await req("/billing/orders", "GET", undefined, admin)).data.orders.some(
      (o: any) => o.id === order.id,
    ),
    false,
  );
});

test("rejected payments grant no credits, require a reason, and can be corrected for a new review", async () => {
  const before = one(
    "SELECT voice_credits FROM users WHERE id=?",
    member,
  )!.voice_credits;
  const order = await paymentOrder(7);
  const submitted = (
    await req(`/billing/orders/${order.id}`, "PATCH", paymentDetails(order))
  ).data.order;
  assert.equal(
    (
      await req(
        `/admin/payments/${order.id}/review`,
        "POST",
        { decision: "rejected", version: submitted.version },
        admin,
      )
    ).res.status,
    400,
  );
  assert.equal(
    (
      await req(
        `/admin/payments/${order.id}/review`,
        "POST",
        {
          decision: "rejected",
          version: submitted.version,
          note: "Transaction not found",
        },
        admin,
      )
    ).res.status,
    200,
  );
  assert.equal(
    one("SELECT voice_credits FROM users WHERE id=?", member)!.voice_credits,
    before,
  );
  const rejected = one("SELECT * FROM payment_requests WHERE id=?", order.id)!;
  const corrected = await req(
    `/billing/orders/${order.id}`,
    "PATCH",
    paymentDetails(rejected),
  );
  assert.equal(corrected.res.status, 200);
  assert.equal(corrected.data.order.status, "pending");
  assert.equal(
    (
      await req(
        `/admin/payments/${order.id}/review`,
        "POST",
        { decision: "approved", version: corrected.data.order.version },
        admin,
      )
    ).res.status,
    200,
  );
  assert.equal(
    one("SELECT voice_credits FROM users WHERE id=?", member)!.voice_credits,
    before + 7,
  );
});

test("channel balances are isolated and unsent voice refunds return only voice credits", async () => {
  const original = one(
    "SELECT allowance,voice_credits FROM users WHERE id=?",
    member,
  )!;
  try {
    run("UPDATE users SET allowance=100,voice_credits=2 WHERE id=?", member);
    const list = newList();
    for (const phone of ["+233245557201", "+233245557202", "+233245557203"])
      addContact(list, phone);
    const recording = new FormData();
    recording.append(
      "file",
      new File([Buffer.from("fLaCtest")], "funding.flac"),
    );
    const audioId = (await req("/audio", "POST", recording)).data.id;
    const voice = await campaign([list], {
      channel: "voice",
      audioId,
      message: "",
    });
    assert.equal(
      (await req(`/campaigns/${voice}/queue`, "POST")).res.status,
      400,
    );
    assert.equal(
      one("SELECT count(*) AS n FROM deliveries WHERE campaign_id=?", voice)!.n,
      0,
    );
    assert.deepEqual(
      one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
      { allowance: 100, voice_credits: 2 },
    );
    run("UPDATE users SET allowance=0,voice_credits=3 WHERE id=?", member);
    const sms = await campaign([list]);
    assert.equal(
      (await req(`/campaigns/${sms}/queue`, "POST")).res.status,
      400,
    );
    assert.equal(
      (await req(`/campaigns/${voice}/queue`, "POST")).res.status,
      200,
    );
    assert.deepEqual(
      one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
      { allowance: 0, voice_credits: 0 },
    );
    assert.equal(
      (await req(`/campaigns/${voice}/cancel`, "POST")).res.status,
      200,
    );
    assert.equal(
      (await req(`/campaigns/${voice}/cancel`, "POST")).res.status,
      409,
    );
    assert.deepEqual(
      one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
      { allowance: 0, voice_credits: 3 },
    );
    const next = await campaign([list], {
      channel: "voice",
      audioId,
      message: "",
    });
    await req(`/campaigns/${next}/queue`, "POST");
    run(
      "INSERT INTO suppressions(phone,reason) VALUES('+233245557201','Test')",
    );
    await processOne(
      async (_c, phones) =>
        phones.map((phone) => ({ phone, providerId: "channel-test" })),
      next,
    );
    assert.deepEqual(
      one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
      { allowance: 0, voice_credits: 1 },
    );
  } finally {
    run(
      "UPDATE users SET allowance=?,voice_credits=? WHERE id=?",
      original.allowance,
      original.voice_credits,
      member,
    );
  }
});

test("SMS purchases use the six-pesewa rate and approval credits only SMS once", async () => {
  const before = one(
    "SELECT allowance,voice_credits FROM users WHERE id=?",
    member,
  )!;
  const created = await req("/billing/orders", "POST", {
    credits: 100,
    creditType: "sms",
  });
  assert.equal(created.res.status, 201);
  const order = created.data.order;
  assert.equal(order.credit_type, "sms");
  assert.equal(order.rate_pesewas, 6);
  assert.equal(order.total_pesewas, 600);
  const config = (await req("/billing/settings")).data.settings;
  const changed = await req(
    "/admin/payment-settings",
    "PATCH",
    {
      rate: "0.40",
      smsRate: "0.08",
      phone: config.phone,
      name: config.name,
      network: config.network,
    },
    admin,
  );
  assert.equal(changed.res.status, 200);
  assert.equal(changed.data.settings.smsRatePesewas, 8);
  assert.equal(
    one("SELECT rate_pesewas FROM payment_requests WHERE id=?", order.id)!
      .rate_pesewas,
    6,
  );
  run("UPDATE settings SET value='6' WHERE key='sms_rate_pesewas'");
  const submitted = await req(
    `/billing/orders/${order.id}`,
    "PATCH",
    paymentDetails(order),
  );
  assert.equal(submitted.res.status, 200);
  const reviewed = await Promise.all(
    [1, 2].map(() =>
      req(
        `/admin/payments/${order.id}/review`,
        "POST",
        { version: submitted.data.order.version, decision: "approved" },
        admin,
      ),
    ),
  );
  assert.deepEqual(reviewed.map((r) => r.res.status).sort(), [200, 409]);
  assert.deepEqual(
    one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
    { allowance: before.allowance + 100, voice_credits: before.voice_credits },
  );
  assert.equal(
    one(
      "SELECT credit_type FROM credit_purchases WHERE payment_id=?",
      order.id,
    )!.credit_type,
    "sms",
  );
  assert.ok(
    (await req("/notifications")).data.notifications.some(
      (n: any) => n.title === "SMS credits added",
    ),
  );
  assert.equal(
    (
      await req("/billing/orders", "POST", {
        credits: 1,
        creditType: "anything",
      })
    ).res.status,
    400,
  );
});

test("retry reserves fresh matching credits once, preserves attempts and excludes successful or unknown deliveries", async () => {
  run("UPDATE users SET status='active' WHERE id=?", other);
  run(
    "INSERT OR REPLACE INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    hash(other),
    other,
    Date.now() + 86400000,
  );

  const list = newList();
  for (let i = 0; i < 6; i++) addContact(list, "+23324555970" + i);
  const id = await campaign([list], { message: "a".repeat(161) });
  await req(`/campaigns/${id}/queue`, "POST");
  const statuses = [
    "failed",
    "rejected",
    "delivered",
    "accepted",
    "unknown",
    "failed",
  ];
  const rows = all(
    "SELECT * FROM deliveries WHERE campaign_id=? ORDER BY phone",
    id,
  );
  rows.forEach((r, i) =>
    run(
      "UPDATE deliveries SET status=?,provider_id=? WHERE id=?",
      statuses[i],
      "old-batch",
      r.id,
    ),
  );
  run("INSERT INTO suppressions(phone,reason) VALUES(?,'Test')", rows[5].phone);
  run("UPDATE campaigns SET status='attention' WHERE id=?", id);
  assert.equal(
    (await req(`/campaigns/${id}/retry`, "POST", {}, other)).res.status,
    404,
  );
  const before = one(
    "SELECT allowance,voice_credits FROM users WHERE id=?",
    member,
  )!;
  run("UPDATE users SET allowance=0 WHERE id=?", member);
  assert.equal((await req(`/campaigns/${id}/retry`, "POST")).res.status, 400);
  assert.equal(
    one("SELECT count(*) AS n FROM delivery_attempts WHERE campaign_id=?", id)!
      .n,
    0,
  );
  run("UPDATE users SET allowance=? WHERE id=?", before.allowance, member);
  const responses = await Promise.all(
    [1, 2].map(() => req(`/campaigns/${id}/retry`, "POST")),
  );
  assert.deepEqual(responses.map((r) => r.res.status).sort(), [200, 409]);
  assert.deepEqual(
    one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
    { allowance: before.allowance - 4, voice_credits: before.voice_credits },
  );
  assert.equal(
    one(
      "SELECT count(*) AS n FROM delivery_attempts WHERE campaign_id=? AND provider_id='old-batch'",
      id,
    )!.n,
    2,
  );
  assert.deepEqual(
    all(
      "SELECT status FROM deliveries WHERE campaign_id=? ORDER BY phone",
      id,
    ).map((r) => r.status),
    ["pending", "pending", "delivered", "accepted", "unknown", "failed"],
  );
  assert.equal(
    one("SELECT provider_id FROM deliveries WHERE id=?", rows[0].id)!
      .provider_id,
    null,
  );
  let recipients: string[] = [];
  await processOne(async (_c, phones) => {
    recipients = phones;
    return phones.map((phone) => ({ phone, providerId: "new-batch" }));
  }, id);
  assert.deepEqual(
    recipients.sort(),
    rows
      .slice(0, 2)
      .map((r) => r.phone)
      .sort(),
  );
  assert.equal((await req(`/campaigns/${id}/retry`, "POST")).res.status, 409);
});

test("completed campaigns clone to uniquely suffixed drafts without deductions and charge on queue", async () => {
  const list = newList();
  addContact(list, "+233245559750");
  const id = await campaign([list], {
    name: "Community broadcast",
    scheduledAt: Date.now() + 60000,
  });
  await req(`/campaigns/${id}/queue`, "POST");
  run("UPDATE campaigns SET scheduled_at=NULL WHERE id=?", id);
  await processOne(
    async (_c, phones) =>
      phones.map((phone) => ({ phone, providerId: "original-batch" })),
    id,
  );
  const before = one(
    "SELECT allowance,voice_credits FROM users WHERE id=?",
    member,
  )!;
  assert.equal(
    (await req(`/campaigns/${id}/clone`, "POST", {}, other)).res.status,
    404,
  );
  const copies = await Promise.all(
    [1, 2].map(() => req(`/campaigns/${id}/clone`, "POST")),
  );
  assert.deepEqual(
    copies.map((c) => c.res.status),
    [201, 201],
  );
  copies.forEach((r, i) => {
    const copy = one("SELECT * FROM campaigns WHERE id=?", r.data.id)!;
    assert.equal(copy.name, `Community broadcast - Copy ${i + 1}`);
    assert.equal(copy.status, "draft");
    assert.equal(copy.source_campaign_id, id);
    assert.equal(copy.scheduled_at, null);
    assert.equal(copy.message, "A community message");
  });
  assert.deepEqual(
    one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
    before,
  );
  assert.equal(
    (await req(`/campaigns/${copies[0].data.id}/clone`, "POST")).res.status,
    409,
  );
  assert.equal(
    (await req(`/campaigns/${copies[0].data.id}/queue`, "POST")).res.status,
    200,
  );
  assert.equal(
    one("SELECT allowance FROM users WHERE id=?", member)!.allowance,
    before.allowance - 1,
  );
  assert.equal(
    one("SELECT provider_id FROM deliveries WHERE campaign_id=?", id)!
      .provider_id,
    "original-batch",
  );
});

test("voice retries charge voice only, cancellation refunds that attempt, and admin grants stay separated", async () => {
  const before = one(
    "SELECT allowance,voice_credits FROM users WHERE id=?",
    member,
  )!;
  const list = newList();
  addContact(list, "+233245559760");
  const recording = new FormData();
  recording.append("file", new File([Buffer.from("fLaCtest")], "retry.flac"));
  const audioId = (await req("/audio", "POST", recording)).data.id;
  const id = await campaign([list], { channel: "voice", audioId, message: "" });
  await req(`/campaigns/${id}/queue`, "POST");
  await processOne(async () => {
    throw new ProviderError("Provider rejected this call");
  }, id);
  run("UPDATE users SET voice_credits=0 WHERE id=?", member);
  assert.equal((await req(`/campaigns/${id}/retry`, "POST")).res.status, 400);
  assert.equal(
    (
      await req(
        `/admin/users/${member}`,
        "PATCH",
        { grant: 2, creditType: "voice" },
        admin,
      )
    ).res.status,
    200,
  );
  assert.equal(
    one("SELECT allowance FROM users WHERE id=?", member)!.allowance,
    before.allowance,
  );
  assert.equal((await req(`/campaigns/${id}/retry`, "POST")).res.status, 200);
  assert.deepEqual(
    one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
    { allowance: before.allowance, voice_credits: 1 },
  );
  assert.equal((await req(`/campaigns/${id}/cancel`, "POST")).res.status, 200);
  assert.deepEqual(
    one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
    { allowance: before.allowance, voice_credits: 2 },
  );
  assert.equal(
    (
      await req(
        `/admin/users/${member}`,
        "PATCH",
        { grant: 3, creditType: "sms" },
        admin,
      )
    ).res.status,
    200,
  );
  assert.deepEqual(
    one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
    { allowance: before.allowance + 3, voice_credits: 2 },
  );
  run(
    "UPDATE users SET allowance=?,voice_credits=? WHERE id=?",
    before.allowance,
    before.voice_credits,
    member,
  );
});

test("Sender IDs require gateway confirmation, enforce ownership and gateway binding, and stop after revocation", async () => {
  run("UPDATE users SET phone='+233245551001',verified=1 WHERE id=?", member);
  run("UPDATE users SET phone='+233245551002',verified=1 WHERE id=?", admin);
  const created = await req("/sender-ids", "POST", {
    name: "TEAMCONNECT",
    purpose: "Community event invitations",
    provider: "arkesel",
  });
  assert.equal(created.res.status, 201);
  const id = created.data.id;
  assert.equal(
    (
      await req("/sender-ids", "POST", {
        name: "teamconnect",
        purpose: "Community event invitations",
        provider: "arkesel",
      })
    ).res.status,
    409,
  );
  assert.equal(
    (
      await req("/sender-ids", "POST", {
        name: "12345",
        purpose: "Community event invitations",
        provider: "arkesel",
      })
    ).res.status,
    400,
  );
  const list = newList();
  addContact(list, "+233245551003");
  const payload = {
    name: "Custom sender campaign",
    channel: "sms",
    message: "Hello",
    listIds: [list],
    senderId: id,
  };
  assert.equal((await req("/campaigns", "POST", payload)).res.status, 403);
  assert.equal(
    (
      await req(`/admin/sender-ids/${id}/review`, "POST", {
        version: 1,
        decision: "approved",
        gatewayRegistered: true,
        note: "Confirmed in gateway dashboard",
      })
    ).res.status,
    403,
  );
  assert.equal(
    (
      await req(
        `/admin/sender-ids/${id}/review`,
        "POST",
        {
          version: 1,
          decision: "approved",
          note: "Confirmed in gateway dashboard",
        },
        admin,
      )
    ).res.status,
    400,
  );
  assert.equal(
    (
      await req(
        `/admin/sender-ids/${id}/review`,
        "POST",
        {
          version: 1,
          decision: "approved",
          gatewayRegistered: true,
          note: "Confirmed in gateway dashboard",
        },
        admin,
      )
    ).res.status,
    200,
  );
  assert.equal(
    (
      await req(
        `/admin/sender-ids/${id}/review`,
        "POST",
        {
          version: 1,
          decision: "approved",
          gatewayRegistered: true,
          note: "Duplicate confirmation",
        },
        admin,
      )
    ).res.status,
    409,
  );
  assert.equal(
    all("SELECT * FROM sms_notifications WHERE event_key=?", `sender:${id}:1`)
      .length,
    2,
  );
  assert.equal(
    all("SELECT * FROM sms_notifications WHERE event_key=?", `sender:${id}:2`)
      .length,
    2,
  );
  assert.equal(
    (await req("/sender-ids", "GET", undefined, other)).data.senders.some(
      (s: any) => s.id === id,
    ),
    false,
  );
  const otherList = newList(other);
  addContact(otherList, "+233245551004");
  assert.equal(
    (
      await req(
        "/campaigns",
        "POST",
        { ...payload, listIds: [otherList] },
        other,
      )
    ).res.status,
    403,
  );
  run("UPDATE settings SET value='mnotify' WHERE key='messaging_provider'");
  assert.equal((await req("/campaigns", "POST", payload)).res.status, 403);
  run("UPDATE settings SET value='arkesel' WHERE key='messaging_provider'");
  const campaignId = (await req("/campaigns", "POST", payload)).data.id;
  const campaignRow = one("SELECT * FROM campaigns WHERE id=?", campaignId)!;
  assert.equal(campaignRow.sender, "TEAMCONNECT");
  assert.equal(campaignRow.sender_id, id);
  await req(`/campaigns/${campaignId}/queue`, "POST");
  assert.equal(
    (
      await req(
        `/admin/sender-ids/${id}/review`,
        "POST",
        {
          version: 2,
          decision: "revoked",
          note: "Gateway registration withdrawn",
        },
        admin,
      )
    ).res.status,
    200,
  );
  let called = false;
  await processOne(async () => {
    called = true;
    return [];
  }, campaignId);
  assert.equal(called, false);
  assert.equal(
    one("SELECT status FROM campaigns WHERE id=?", campaignId)!.status,
    "attention",
  );
  assert.equal(
    (await req(`/campaigns/${campaignId}/resume`, "POST")).res.status,
    403,
  );
  await req(`/campaigns/${campaignId}/cancel`, "POST");
});

test("mNotify Sender ID approval requires a matching gateway Approved response", async () =>
  realMnotify(async () => {
    const created = await req("/sender-ids", "POST", {
      name: "MNTEAM",
      purpose: "Community notices from members",
      provider: "mnotify",
    });
    assert.equal(created.res.status, 201);
    const id = created.data.id;
    let status = "Pending",
      name = "MNTEAM",
      calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(new URL(String(url)).pathname, "/api/senderid/status");
      assert.equal(JSON.parse(String(init?.body)).sender_name, "MNTEAM");
      return Response.json({
        status: "success",
        code: "2000",
        summary: { "sender name": name, status },
      });
    };
    const body = {
      version: 1,
      decision: "approved",
      gatewayRegistered: true,
      note: "Gateway registration reviewed",
    };
    assert.equal(
      (await req(`/admin/sender-ids/${id}/review`, "POST", body, admin)).res
        .status,
      409,
    );
    status = "Approved";
    name = "WRONG";
    assert.equal(
      (await req(`/admin/sender-ids/${id}/review`, "POST", body, admin)).res
        .status,
      409,
    );
    name = "MNTEAM";
    assert.equal(
      (await req(`/admin/sender-ids/${id}/review`, "POST", body, admin)).res
        .status,
      200,
    );
    assert.equal(calls, 3);
  }));

test("SMS outbox claims once, preserves balances, and never automatically resends uncertain sends", async () => {
  const { notify, processNotification } =
    await import("../apps/web/src/server/notifications");
  // Finish older fixture events so this test isolates its dispatch attempts.
  run("UPDATE sms_notifications SET status='skipped' WHERE status='pending'");
  const before = one(
    "SELECT allowance,voice_credits FROM users WHERE id=?",
    member,
  )!;
  db.transaction(() => {
    notify(
      member,
      "Test event",
      "Request received.",
      "/credits",
      "outbox-test",
    );
    notify(
      member,
      "Test event",
      "Request received.",
      "/credits",
      "outbox-test",
    );
  }).immediate();
  assert.equal(
    one(
      "SELECT count(*) AS n FROM sms_notifications WHERE event_key='outbox-test'",
    )!.n,
    1,
  );
  let sends = 0;
  const send = async (c: any, phones: string[]) => {
    sends++;
    assert.equal(c.notification, true);
    assert.notEqual(c.sender, "TEAMCONNECT");
    assert.deepEqual(phones, ["+233245551001"]);
    await new Promise((r) => setTimeout(r, 5));
    return phones.map((phone) => ({ phone, providerId: "alert-ref" }));
  };
  await Promise.all([processNotification(send), processNotification(send)]);
  assert.equal(sends, 1);
  assert.equal(
    one("SELECT status FROM sms_notifications WHERE event_key='outbox-test'")!
      .status,
    "accepted",
  );
  assert.deepEqual(
    one("SELECT allowance,voice_credits FROM users WHERE id=?", member),
    before,
  );
  db.transaction(() =>
    notify(
      member,
      "Uncertain event",
      "Do not duplicate.",
      "/credits",
      "outbox-unknown",
    ),
  ).immediate();
  await processNotification(async () => {
    throw new ProviderError("Timed out", true);
  });
  const unknown = one(
    "SELECT * FROM sms_notifications WHERE event_key='outbox-unknown'",
  )!;
  assert.equal(unknown.status, "unknown");
  assert.equal(await processNotification(send), false);
  assert.equal(
    (
      await req(
        `/admin/sms-notifications/${unknown.id}/retry`,
        "POST",
        { attempts: unknown.attempts },
        admin,
      )
    ).res.status,
    409,
  );
  db.transaction(() =>
    notify(member, "Rejected event", "Can retry.", "/credits", "outbox-failed"),
  ).immediate();
  await processNotification(async () => {
    throw new ProviderError("Rejected", false);
  });
  const failed = one(
    "SELECT * FROM sms_notifications WHERE event_key='outbox-failed'",
  )!;
  assert.equal(failed.status, "failed");
  assert.equal(
    (
      await req(`/admin/sms-notifications/${failed.id}/retry`, "POST", {
        attempts: failed.attempts,
      })
    ).res.status,
    403,
  );
  assert.equal(
    (
      await req(
        `/admin/sms-notifications/${failed.id}/retry`,
        "POST",
        { attempts: failed.attempts },
        admin,
      )
    ).res.status,
    200,
  );
  await processNotification(send);
  assert.equal(
    one("SELECT status FROM sms_notifications WHERE id=?", failed.id)!.status,
    "accepted",
  );
  db.transaction(() =>
    notify(member, "Lost worker", "Reconcile.", "/credits", "outbox-stale"),
  ).immediate();
  run(
    "UPDATE sms_notifications SET status='sending',lease_until=0 WHERE event_key='outbox-stale'",
  );
  await processNotification(send);
  assert.equal(
    one("SELECT status FROM sms_notifications WHERE event_key='outbox-stale'")!
      .status,
    "unknown",
  );
});

test("SMS and voice payment submissions and reviews queue alerts for the user and administrator exactly once", async () => {
  for (const creditType of ["sms", "voice"]) {
    const created = await req("/billing/orders", "POST", {
      credits: 2,
      creditType,
    });
    assert.equal(created.res.status, 201);
    const order = created.data.order;
    const submitted = await req(
      `/billing/orders/${order.id}`,
      "PATCH",
      paymentDetails(order),
    );
    assert.equal(submitted.res.status, 200);
    const event = `payment:${order.id}:submitted:2`;
    const notices = all(
      "SELECT * FROM sms_notifications WHERE event_key=?",
      event,
    );
    assert.equal(notices.length, 2);
    assert.deepEqual(
      new Set(notices.map((n) => n.user_id)),
      new Set([member, admin]),
    );
    assert.ok(notices.every((n) => n.status === "pending"));
    const approved = await req(
      `/admin/payments/${order.id}/review`,
      "POST",
      { version: 2, decision: "approved" },
      admin,
    );
    assert.equal(approved.res.status, 200);
    assert.equal(
      all(
        "SELECT * FROM sms_notifications WHERE event_key=?",
        `payment:${order.id}:reviewed:3`,
      ).length,
      2,
    );
    assert.equal(
      (
        await req(
          `/admin/payments/${order.id}/review`,
          "POST",
          { version: 2, decision: "approved" },
          admin,
        )
      ).res.status,
      409,
    );
    assert.equal(
      all(
        "SELECT * FROM sms_notifications WHERE event_key=?",
        `payment:${order.id}:reviewed:3`,
      ).length,
      2,
    );
  }
});
