import { Hono } from "hono";
import { replayReceipts } from "./webhooks";
import { senderRoutes, approvedSender, checkCampaignSender } from "./senders";
import { billingRoutes } from "./billing";
import { refundRecipients, reserveCredits } from "./credits";
import { audioMime } from "./audio";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { hash as passwordHash, compare } from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import Papa from "papaparse";
import qs from "qs";
import { randomUUID } from "node:crypto";
import { writeFile, readFile, unlink, stat, chown } from "node:fs/promises";
import { resolve } from "node:path";
import { db, all, one, run, audit, uploadDir, type Row } from "@ndc/db";
import { normalizePhone } from "../lib/shared";
import {
  currentUser,
  publicUser,
  session,
  hash,
  token,
  rateLimit,
  verifyWebhook,
} from "./security";
import {
  requestOtp,
  verifyOtp,
  isMock,
  ProviderError,
  assertProvider,
  activeProvider,
  providerConfigured,
  providerSender,
} from "./provider";

type Env = { Variables: { user: Row } };
export const apiApp = new Hono<Env>().basePath("/api");
function fail(
  status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
  message: string,
): never {
  throw new HTTPException(status, { message });
}
const id = () => randomUUID();
const phoneSchema = z
  .string()
  .max(30)
  .transform((v, ctx) => {
    try {
      return normalizePhone(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid phone number." });
      return z.NEVER;
    }
  });
const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters for your password.")
  .max(128)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must fit within 72 UTF-8 bytes.",
  );
apiApp.use("*", secureHeaders());
apiApp.use(
  "*",
  bodyLimit({
    maxSize: 12 * 1024 * 1024,
    onError: (c) =>
      c.json({ error: "Upload exceeds the 12 MB request limit." }, 413),
  }),
);
apiApp.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    !c.req.path.startsWith("/api/webhooks/")
  ) {
    const origin = c.req.header("origin");
    const expected = new URL(process.env.APP_URL || "http://localhost:3100")
      .origin;
    if (origin !== expected)
      return c.json({ error: "Request origin is not allowed." }, 403);
  }
  await next();
});
apiApp.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return c.json(
      { error: error.issues[0]?.message || "Invalid request." },
      400,
    );
  if (error instanceof ProviderError)
    return c.json({ error: error.message }, 502);
  if (error instanceof SyntaxError)
    return c.json({ error: "Invalid request body." }, 400);
  console.error(
    "API error:",
    error instanceof Error
      ? error.message.replace(/(?:api[-_ ]?key)[^\s]*/gi, "[redacted]")
      : "unknown",
  );
  return c.json(
    { error: "The request could not be completed. Please try again." },
    500,
  );
});
apiApp.get("/health", (c) => {
  one("SELECT 1");
  return c.json({ status: "ok" });
});
apiApp.get("/config", (c) =>
  c.json({
    googleEnabled: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
    mock: isMock(),
    provider: activeProvider(),
    sender: providerSender(activeProvider()),
    voiceEnabled: providerConfigured(activeProvider()) || isMock(),
  }),
);
apiApp.use("/auth/*", async (c, next) => {
  // Reading the current session happens on every workspace navigation/refocus.
  // It is not a sign-in attempt, and logout must remain available when blocked.
  if (
    (c.req.method === "GET" && c.req.path === "/api/auth/me") ||
    (c.req.method === "POST" && c.req.path === "/api/auth/logout")
  ) {
    await next();
    return;
  }
  const ip =
    process.env.TRUST_PROXY === "true"
      ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
      : "local";
  if (!rateLimit("auth-ip:" + ip, 50, 15 * 60000))
    return c.json(
      { error: "Too many attempts. Please try again in 15 minutes." },
      429,
    );
  await next();
});
apiApp.get("/auth/me", (c) => {
  const u = currentUser(c);
  return c.json({ user: u ? publicUser(u) : null });
});
apiApp.post("/auth/otp", async (c) => {
  const { phone } = z.object({ phone: phoneSchema }).parse(await c.req.json());
  if (!rateLimit("otp:" + phone, 3, 15 * 60000))
    fail(429, "Please wait 15 minutes before requesting another code.");
  const prev = one("SELECT * FROM otp_requests WHERE phone=?", phone);
  if (prev && Date.now() - prev.requested_at < 60000)
    fail(429, "Wait one minute before requesting a new code.");
  const provider = activeProvider();
  const requestedAt = Date.now();
  run(
    "INSERT INTO otp_requests(phone,requested_at,provider) VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET requested_at=excluded.requested_at,provider=excluded.provider,code_hash=NULL,attempts=0,consumed=0",
    phone,
    requestedAt,
    provider,
  );
  await requestOtp(phone, provider, requestedAt);
  return c.json({
    message: "Verification code sent.",
    ...(isMock() ? { testCode: "123456" } : {}),
  });
});
async function consumeOtp(phone: string, code: string) {
  const attempt = one(
    "UPDATE otp_requests SET attempts=attempts+1 WHERE phone=? AND consumed=0 AND attempts<5 AND requested_at>? RETURNING *",
    phone,
    Date.now() - 300000,
  );
  if (!attempt)
    fail(
      400,
      "Request a new verification code. This code is expired or has too many attempts.",
    );
  await verifyOtp(phone, code, attempt);
  if (
    !run(
      "UPDATE otp_requests SET consumed=1 WHERE phone=? AND requested_at=? AND consumed=0",
      phone,
      attempt.requested_at,
    ).changes
  )
    fail(409, "Code already used. Request another.");
}
apiApp.post("/auth/register", async (c) => {
  const b = z
    .object({
      name: z.string().trim().min(2).max(100),
      phone: phoneSchema,
      password: passwordSchema,
      code: z.string().regex(/^\d{6}$/),
    })
    .parse(await c.req.json());
  if (one("SELECT id FROM users WHERE phone=?", b.phone))
    fail(409, "An account already uses this number. Sign in instead.");
  const digest = await passwordHash(b.password, 12);
  await consumeOtp(b.phone, b.code);
  const userId = id();
  run(
    "INSERT INTO users(id,name,phone,password_hash,verified) VALUES(?,?,?,?,1)",
    userId,
    b.name,
    b.phone,
    digest,
  );
  session(c, userId);
  audit(userId, "account.created", userId);
  return c.json(
    { user: publicUser(one("SELECT * FROM users WHERE id=?", userId)!) },
    201,
  );
});
apiApp.post("/auth/login", async (c) => {
  const b = z
    .object({
      phone: phoneSchema,
      password: z.string().min(1).max(128),
      admin: z.boolean().optional(),
    })
    .parse(await c.req.json());
  if (!rateLimit("login:" + b.phone, 10, 15 * 60000))
    fail(429, "Too many sign-in attempts. Try again in 15 minutes.");
  const u = one("SELECT * FROM users WHERE phone=?", b.phone);
  const valid = await compare(
    b.password,
    u?.password_hash ||
      "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5NqByFwfVYImoAKRfUx7uV7M0NJbxmS",
  );
  if (
    !u ||
    !valid ||
    !u.verified ||
    u.status !== "active" ||
    (b.admin && u.role !== "admin")
  )
    fail(
      401,
      "Phone number or password is incorrect, or the account is unavailable.",
    );
  session(c, u.id);
  return c.json({ user: publicUser(u) });
});
apiApp.post("/auth/reset-password", async (c) => {
  const b = z
    .object({
      phone: phoneSchema,
      code: z.string().regex(/^\d{6}$/),
      password: passwordSchema,
    })
    .parse(await c.req.json());
  const digest = await passwordHash(b.password, 12);
  await consumeOtp(b.phone, b.code);
  db.transaction(() => {
    const u = one("SELECT id FROM users WHERE phone=?", b.phone);
    if (u) {
      run("UPDATE users SET password_hash=? WHERE id=?", digest, u.id);
      run("DELETE FROM sessions WHERE user_id=?", u.id);
      audit(u.id, "password.reset", u.id);
    }
  }).immediate();
  return c.json({ success: true });
});
apiApp.post("/auth/logout", (c) => {
  const value = getCookie(c, "ndc_session");
  if (value) run("DELETE FROM sessions WHERE token_hash=?", hash(value));
  deleteCookie(c, "ndc_session", { path: "/" });
  return c.json({ success: true });
});
function googleClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    fail(503, "Google sign-in has not been configured.");
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/auth/google/callback`,
  );
}
apiApp.get("/auth/google", (c) => {
  const client = googleClient();
  const state = token();
  const nonce = token();
  setCookie(c, "ndc_oauth", state + "." + nonce, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/auth/google",
  });
  return c.redirect(
    client.generateAuthUrl({
      scope: ["openid", "email", "profile"],
      state,
      nonce,
      prompt: "select_account",
    }),
  );
});
apiApp.get("/auth/google/callback", async (c) => {
  const stored = getCookie(c, "ndc_oauth");
  deleteCookie(c, "ndc_oauth", { path: "/api/auth/google" });
  if (
    !stored ||
    !c.req.query("state") ||
    stored.split(".")[0] !== c.req.query("state") ||
    !c.req.query("code")
  )
    return c.redirect("/login?error=google");
  try {
    const client = googleClient();
    const { tokens } = await client.getToken(c.req.query("code")!);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload() as ReturnType<typeof ticket.getPayload> & {
      nonce?: string;
    };
    if (
      !p?.sub ||
      !p.email_verified ||
      !p.email ||
      p.nonce !== stored.split(".")[1]
    )
      return c.redirect("/login?error=google");
    let u = one("SELECT * FROM users WHERE google_id=?", p.sub);
    if (!u) {
      // Never silently link an existing account on an email match.
      if (one("SELECT id FROM users WHERE email=?", p.email))
        return c.redirect("/login?error=google");
      const userId = id();
      run(
        "INSERT INTO users(id,name,email,google_id,verified) VALUES(?,?,?,?,1)",
        userId,
        p.name || p.email.split("@")[0],
        p.email,
        p.sub,
      );
      u = one("SELECT * FROM users WHERE id=?", userId)!;
    }
    if (u.status !== "active") return c.redirect("/login?error=google");
    session(c, u.id);
    return c.redirect("/");
  } catch {
    return c.redirect("/login?error=google");
  }
});
apiApp.all("/webhooks/arkesel", async (c) => {
  if (!["GET", "POST"].includes(c.req.method))
    return c.json({ error: "Method not allowed." }, 405);
  const payload =
    c.req.method === "GET"
      ? qs.parse(new URL(c.req.url).search.slice(1), {
          depth: 5,
          parameterLimit: 1000,
        })
      : await c.req.json();
  const eventId = c.req.header("x-arkesel-webhook-id") || "";
  if (
    !eventId ||
    eventId.length > 200 ||
    !verifyWebhook(
      payload,
      c.req.header("x-arkesel-webhook-timestamp") || "",
      c.req.header("x-arkesel-webhook-signature") || "",
      process.env.ARKESEL_WEBHOOK_SECRET || "",
    )
  )
    fail(401, "Invalid webhook signature.");
  db.transaction(() => {
    if (
      !run(
        "INSERT OR IGNORE INTO webhook_events(id,created_at,payload) VALUES(?,?,?)",
        eventId,
        Date.now(),
        JSON.stringify(payload),
      ).changes
    )
      return;
    replayReceipts();
  }).immediate();
  return c.json({ success: true });
});
apiApp.use("*", async (c, next) => {
  const u = currentUser(c);
  if (!u) fail(401, "Please sign in to continue.");
  c.set("user", u);
  await next();
});
apiApp.route("/", billingRoutes);
apiApp.route("/", senderRoutes);
const listQuery = `SELECT l.*,u.name AS owner_name,(SELECT count(*) FROM contacts WHERE list_id=l.id) AS contact_count FROM lists l JOIN users u ON u.id=l.owner_id`;
apiApp.get("/dashboard", (c) => {
  const u = c.get("user");
  const admin = c.req.query("admin") === "true" && u.role === "admin";
  const scope = admin ? "1=1" : "owner_id=?";
  const args = admin ? [] : [u.id];
  const campaigns = all(
    `SELECT c.*, (SELECT count(*) FROM deliveries WHERE campaign_id=c.id) AS recipients FROM campaigns c WHERE ${scope} ORDER BY c.created_at DESC LIMIT 5`,
    ...args,
  );
  const stats = one(
    `SELECT count(*) AS campaigns,coalesce(sum(channel='sms'),0) AS sms_campaigns,coalesce(sum(channel='voice'),0) AS voice_campaigns FROM campaigns WHERE ${scope}`,
    ...args,
  );
  const delivery = one(
    `SELECT count(*) AS recipients,coalesce(sum(d.status='delivered'),0) AS delivered,coalesce(sum(d.status='accepted'),0) AS accepted,coalesce(sum(d.status IN ('failed','unknown')),0) AS failed FROM deliveries d JOIN campaigns c ON c.id=d.campaign_id WHERE ${admin ? "1=1" : "c.owner_id=?"}`,
    ...args,
  );
  const activity = all(
    `SELECT date(c.created_at) AS day,count(*) AS total FROM deliveries d JOIN campaigns c ON c.id=d.campaign_id WHERE ${admin ? "1=1" : "c.owner_id=?"} AND c.created_at>=datetime('now','-6 days') GROUP BY date(c.created_at)`,
    ...args,
  );
  return c.json({
    stats: {
      ...stats,
      ...delivery,
      contacts: one(
        `SELECT count(*) AS n FROM contacts ct JOIN lists l ON l.id=ct.list_id WHERE ${admin ? "1=1" : "l.owner_id=?"}`,
        ...args,
      )!.n,
      shared: one(
        "SELECT count(*) AS n FROM lists WHERE visibility='shared' AND status='approved'",
      )!.n,
      users: admin ? one("SELECT count(*) AS n FROM users")!.n : undefined,
    },
    campaigns,
    activity,
    user: publicUser(u),
  });
});
apiApp.get("/lists", (c) => {
  const u = c.get("user");
  const shared = c.req.query("shared") === "true";
  return c.json({
    lists: all(
      `${listQuery} WHERE ${shared ? "l.visibility='shared' AND l.status='approved' AND u.status='active'" : "l.owner_id=?"} ORDER BY l.created_at DESC LIMIT 500`,
      ...(shared ? [] : [u.id]),
    ),
  });
});
apiApp.post("/lists", async (c) => {
  const b = z
    .object({
      name: z.string().trim().min(2).max(100),
      description: z.string().max(500).default(""),
      category: z.string().max(50).default("General"),
      visibility: z.enum(["private", "shared"]).default("private"),
    })
    .parse(await c.req.json());
  const u = c.get("user");
  const listId = id();
  run(
    "INSERT INTO lists(id,owner_id,name,description,category,visibility,status) VALUES(?,?,?,?,?,?,?)",
    listId,
    u.id,
    b.name,
    b.description,
    b.category,
    b.visibility,
    b.visibility === "shared" && u.role !== "admin" ? "pending" : "approved",
  );
  audit(u.id, "list.created", listId);
  return c.json({ id: listId }, 201);
});
function ownedList(listId: string, user: Row) {
  const l = one("SELECT * FROM lists WHERE id=?", listId);
  if (!l || (l.owner_id !== user.id && user.role !== "admin"))
    fail(404, "Contact list not found.");
  return l;
}
apiApp.get("/lists/:id/contacts", (c) => {
  ownedList(c.req.param("id"), c.get("user"));
  const page = Math.max(0, Number(c.req.query("page")) || 0);
  return c.json({
    contacts: all(
      "SELECT * FROM contacts WHERE list_id=? ORDER BY name,phone LIMIT 100 OFFSET ?",
      c.req.param("id"),
      Math.min(page, 100000) * 100,
    ),
    total: one(
      "SELECT count(*) AS n FROM contacts WHERE list_id=?",
      c.req.param("id"),
    )!.n,
  });
});
apiApp.post("/lists/:id/contacts", async (c) => {
  const user = c.get("user");
  const input = z
    .object({
      name: z.string().trim().max(100).default(""),
      phone: phoneSchema,
      consent: z.literal(true, {
        error:
          "Confirm you have permission to contact and, when shared, share this contact.",
      }),
    })
    .parse(await c.req.json());
  const contactId = id();
  db.transaction(() => {
    const list = ownedList(c.req.param("id"), user);
    const inserted = run(
      "INSERT INTO contacts(id,list_id,name,phone,consent) VALUES(?,?,?,?,1) ON CONFLICT(list_id,phone) DO NOTHING",
      contactId,
      list.id,
      input.name,
      input.phone,
    );
    if (!inserted.changes)
      fail(409, "This phone number is already in this list.");
    if (list.visibility === "shared" && user.role !== "admin") {
      run("UPDATE lists SET status='pending' WHERE id=?", list.id);
    }
    audit(user.id, "contact.added", list.id, contactId);
  }).immediate();
  return c.json(
    { contact: { id: contactId, name: input.name, phone: input.phone } },
    201,
  );
});
apiApp.patch("/lists/:id", async (c) => {
  const u = c.get("user");
  const l = ownedList(c.req.param("id"), u);
  const b = z
    .object({ visibility: z.enum(["private", "shared"]) })
    .parse(await c.req.json());
  run(
    "UPDATE lists SET visibility=?,status=? WHERE id=?",
    b.visibility,
    b.visibility === "shared" && u.role !== "admin" ? "pending" : "approved",
    l.id,
  );
  audit(u.id, "list.visibility", l.id, b.visibility);
  return c.json({ success: true });
});
apiApp.delete("/lists/:id", (c) => {
  const l = ownedList(c.req.param("id"), c.get("user"));
  run("DELETE FROM lists WHERE id=?", l.id);
  audit(c.get("user").id, "list.deleted", l.id);
  return c.json({ success: true });
});
apiApp.post("/lists/:id/import", async (c) => {
  const u = c.get("user");
  const l = ownedList(c.req.param("id"), u);
  const form = await c.req.formData();
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    file.size > 5 * 1024 * 1024 ||
    !/\.csv$/i.test(file.name)
  )
    fail(400, "Upload a CSV file up to 5 MB.");
  if (form.get("consent") !== "true")
    fail(
      400,
      "Confirm you have permission to contact and, when shared, share these contacts.",
    );
  const parsed = Papa.parse<Record<string, string>>(await file.text(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/^\ufeff/, ""),
  });
  if (!parsed.meta.fields?.includes("phone"))
    fail(400, "Your CSV needs a phone column. A name column is optional.");
  if (parsed.errors.length)
    fail(
      400,
      "The CSV contains malformed rows. Check quotes and column counts.",
    );
  if (parsed.data.length > 20000)
    fail(400, "Import at most 20,000 contacts per file.");
  let inserted = 0,
    duplicates = 0;
  const invalid: { row: number; reason: string }[] = [];
  const contacts: { phone: string; name: string }[] = [];
  parsed.data.forEach((r, i) => {
    try {
      contacts.push({
        phone: normalizePhone(r.phone || ""),
        name: (r.name || "").trim().slice(0, 100),
      });
    } catch {
      invalid.push({ row: i + 2, reason: "Invalid phone number" });
    }
  });
  db.transaction(() => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO contacts(id,list_id,name,phone,consent) VALUES(?,?,?,?,1)",
    );
    contacts.forEach((r) => {
      if (insert.run(id(), l.id, r.name, r.phone).changes) inserted++;
      else duplicates++;
    });
    if (l.visibility === "shared" && u.role !== "admin")
      run("UPDATE lists SET status='pending' WHERE id=?", l.id);
    audit(
      u.id,
      "contacts.imported",
      l.id,
      JSON.stringify({ inserted, duplicates, invalid: invalid.length }),
    );
  }).immediate();
  return c.json({
    inserted,
    duplicates,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 100),
  });
});
apiApp.delete("/lists/:list/contacts/:id", (c) => {
  ownedList(c.req.param("list"), c.get("user"));
  run(
    "DELETE FROM contacts WHERE id=? AND list_id=?",
    c.req.param("id"),
    c.req.param("list"),
  );
  return c.json({ success: true });
});
apiApp.post("/audio", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > 10 * 1024 * 1024 ||
    !/\.(mp3|wav|flac|aac|wma|m4a|ogg)$/i.test(file.name)
  )
    fail(
      400,
      "Upload an MP3, WAV, FLAC, AAC, WMA, M4A, or OGG file up to 10 MB.",
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = audioMime(file.name, bytes);
  if (!mime)
    fail(
      400,
      "The recording does not match a supported audio format. Export it as MP3, WAV, FLAC, AAC, WMA, M4A, or OGG.",
    );
  const audioId = id();
  const filename =
    file.name.replace(/[^\w. -]/g, "").slice(0, 100) || "recording.mp3";
  await writeFile(resolve(uploadDir, audioId), bytes, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    // IDE previews can run as root while the worker runs as the workspace owner.
    // Retain private (0600) recordings, owned by the upload directory's account.
    if (process.getuid?.() === 0) {
      const owner = await stat(uploadDir);
      await chown(resolve(uploadDir, audioId), owner.uid, owner.gid);
    }
    run(
      "INSERT INTO audio_files(id,owner_id,filename,mime,size) VALUES(?,?,?,?,?)",
      audioId,
      c.get("user").id,
      filename,
      mime,
      bytes.length,
    );
  } catch (error) {
    await unlink(resolve(uploadDir, audioId));
    throw error;
  }
  return c.json({ id: audioId, filename, url: `/api/audio/${audioId}` }, 201);
});
apiApp.get("/audio/:id", async (c) => {
  const a = one(
    "SELECT * FROM audio_files WHERE id=? AND owner_id=?",
    c.req.param("id"),
    c.get("user").id,
  );
  if (!a) fail(404, "Recording not found.");
  c.header("Content-Type", a.mime);
  return c.body(await readFile(resolve(uploadDir, a.id)));
});
const campaignSchema = z.object({
  senderId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(2).max(120),
  channel: z.enum(["sms", "voice"]),
  message: z.string().max(1600).default(""),
  audioId: z.string().uuid().nullable().default(null),
  listIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one contact list.")
    .max(50),
  scheduledAt: z.number().int().positive().nullable().default(null),
});
function accessibleLists(ids: string[], user: Row) {
  for (const listId of ids) {
    const l = one(
      "SELECT l.*,u.status AS owner_status FROM lists l JOIN users u ON u.id=l.owner_id WHERE l.id=?",
      listId,
    );
    if (
      !l ||
      l.owner_status !== "active" ||
      (l.owner_id !== user.id &&
        !(l.visibility === "shared" && l.status === "approved"))
    )
      fail(403, "A selected list is no longer available.");
  }
}
apiApp.post("/campaigns", async (c) => {
  const b = campaignSchema.parse(await c.req.json());
  const u = c.get("user");
  accessibleLists(b.listIds, u);
  if (b.channel === "sms" && !b.message.trim())
    fail(400, "Write a message before saving.");
  if (
    b.channel === "voice" &&
    (!b.audioId ||
      !one(
        "SELECT id FROM audio_files WHERE id=? AND owner_id=?",
        b.audioId,
        u.id,
      ))
  )
    fail(400, "Upload your voice recording.");
  if (b.scheduledAt && b.scheduledAt < Date.now())
    fail(400, "Choose a future delivery time.");
  const provider = activeProvider();
  if (b.channel === "voice" && b.senderId)
    fail(400, "SMS Sender IDs cannot be used for voice campaigns.");
  const sender = b.senderId
    ? approvedSender(b.senderId, u.id, provider).name
    : providerSender(provider, b.channel);
  const campaignId = id();
  run(
    "INSERT INTO campaigns(id,owner_id,name,channel,message,sender,audio_id,list_ids,scheduled_at,provider,sender_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    campaignId,
    u.id,
    b.name,
    b.channel,
    b.message,
    sender,
    b.audioId,
    JSON.stringify([...new Set(b.listIds)]),
    b.scheduledAt,
    provider,
    b.senderId,
  );
  audit(u.id, "campaign.created", campaignId);
  return c.json({ id: campaignId }, 201);
});
const campaignQuery = `SELECT c.*,u.name AS owner_name,(SELECT count(*) FROM deliveries WHERE campaign_id=c.id) AS recipients,(SELECT count(*) FROM deliveries WHERE campaign_id=c.id AND status='delivered') AS delivered,(SELECT count(*) FROM deliveries WHERE campaign_id=c.id AND status='accepted') AS accepted,(SELECT count(*) FROM deliveries WHERE campaign_id=c.id AND status IN ('failed','unknown')) AS failed FROM campaigns c JOIN users u ON u.id=c.owner_id`;
function workerActive() {
  const heartbeat = one(
    "SELECT created_at FROM audit_log WHERE action='worker.heartbeat' ORDER BY id DESC LIMIT 1",
  );
  return Boolean(
    heartbeat &&
    Date.now() - new Date(heartbeat.created_at + "Z").getTime() < 90000,
  );
}
apiApp.get("/campaigns", (c) => {
  const u = c.get("user");
  const admin = c.req.query("admin") === "true" && u.role === "admin";
  return c.json({
    workerActive: workerActive(),
    campaigns: all(
      `${campaignQuery} WHERE ${admin ? "1=1" : "c.owner_id=?"} ORDER BY c.created_at DESC LIMIT 200`,
      ...(admin ? [] : [u.id]),
    ),
  });
});
function ownedCampaign(campaignId: string, user: Row) {
  const campaign = one(`${campaignQuery} WHERE c.id=?`, campaignId);
  if (!campaign || (campaign.owner_id !== user.id && user.role !== "admin"))
    fail(404, "Campaign not found.");
  return campaign;
}
function deliveryReport(campaignId: string, user: Row, limited = false): Row[] {
  return all(
    `SELECT d.*, CASE WHEN ?='admin' OR EXISTS (SELECT 1 FROM contacts ct JOIN lists l ON l.id=ct.list_id WHERE ct.phone=d.phone AND l.owner_id=?) THEN 1 ELSE 0 END AS visible FROM deliveries d WHERE campaign_id=? ORDER BY updated_at DESC ${limited ? "LIMIT 100" : ""}`,
    user.role,
    user.id,
    campaignId,
  ).map(({ visible, ...r }) => ({
    ...r,
    phone: visible ? r.phone : r.phone.slice(0, 4) + "••••" + r.phone.slice(-3),
  }));
}
apiApp.get("/campaigns/:id", (c) => {
  const campaign = ownedCampaign(c.req.param("id"), c.get("user"));
  return c.json({
    campaign,
    workerActive: workerActive(),
    deliveries: deliveryReport(campaign.id, c.get("user"), true),
    breakdown: all(
      "SELECT status,count(*) AS count FROM deliveries WHERE campaign_id=? GROUP BY status",
      campaign.id,
    ),
  });
});
apiApp.post("/campaigns/:id/queue", (c) => {
  const u = c.get("user");
  const campaign = ownedCampaign(c.req.param("id"), u);
  assertProvider(campaign.provider);
  db.transaction(() => {
    const current = one(
      "SELECT status FROM campaigns WHERE id=?",
      campaign.id,
    )!;
    if (current.status !== "draft")
      fail(409, "This campaign has already been submitted.");
    checkCampaignSender(campaign);
    const ids: string[] = JSON.parse(campaign.list_ids);
    accessibleLists(ids, { ...u, id: campaign.owner_id });
    const contacts = all(
      `SELECT DISTINCT ct.phone FROM contacts ct WHERE ct.list_id IN (${ids.map(() => "?").join(",")}) AND ct.consent=1 AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.phone=ct.phone) LIMIT 100001`,
      ...ids,
    );
    if (!contacts.length)
      fail(400, "No eligible contacts in the selected lists.");
    if (contacts.length > 100000)
      fail(400, "Select at most 100,000 recipients per campaign.");
    const source = reserveCredits(campaign, contacts.length);
    const insert = db.prepare(
      "INSERT INTO deliveries(id,campaign_id,phone,credit_source) VALUES(?,?,?,?)",
    );
    contacts.forEach((r) => insert.run(id(), campaign.id, r.phone, source));
    run(
      "UPDATE campaigns SET status=?,queued_at=CURRENT_TIMESTAMP WHERE id=?",
      campaign.scheduled_at && campaign.scheduled_at > Date.now()
        ? "scheduled"
        : "queued",
      campaign.id,
    );
    audit(u.id, "campaign.queued", campaign.id, String(contacts.length));
  }).immediate();
  return c.json({ success: true });
});
apiApp.post("/campaigns/:id/resume", (c) => {
  const u = c.get("user");
  const campaign = ownedCampaign(c.req.param("id"), u);
  assertProvider(campaign.provider);
  db.transaction(() => {
    checkCampaignSender(campaign);
    accessibleLists(JSON.parse(campaign.list_ids), {
      ...u,
      id: campaign.owner_id,
    });
    if (
      !one(
        "SELECT id FROM deliveries WHERE campaign_id=? AND status='pending' LIMIT 1",
        campaign.id,
      )
    )
      fail(409, "There are no unsent recipients to resume.");
    if (
      !run(
        "UPDATE campaigns SET status='queued',error=NULL WHERE id=? AND status='attention'",
        campaign.id,
      ).changes
    )
      fail(409, "Only campaigns needing attention can be resumed.");
    audit(
      u.id,
      "campaign.resumed",
      campaign.id,
      "Only recipients never submitted will be sent.",
    );
  }).immediate();
  return c.json({ success: true });
});
apiApp.post("/campaigns/:id/retry", (c) => {
  const user = c.get("user");
  db.transaction(() => {
    const campaign = ownedCampaign(c.req.param("id"), user);
    if (
      !["attention", "failed", "rejected", "completed"].includes(
        campaign.status,
      )
    )
      fail(
        409,
        "Only finished or paused campaigns with failed recipients can be retried.",
      );
    assertProvider(campaign.provider);
    checkCampaignSender(campaign);
    accessibleLists(JSON.parse(campaign.list_ids), {
      ...user,
      id: campaign.owner_id,
    });
    if (
      one("SELECT status FROM users WHERE id=?", campaign.owner_id)?.status !==
      "active"
    )
      fail(403, "The campaign owner is suspended.");
    const failed = all(
      "SELECT * FROM deliveries WHERE campaign_id=? AND status IN ('failed','rejected') AND phone NOT IN (SELECT phone FROM suppressions)",
      campaign.id,
    );
    if (!failed.length)
      fail(
        409,
        "There are no eligible failed or rejected recipients to retry. Unknown results must be reconciled first.",
      );
    const source = reserveCredits(campaign, failed.length);
    for (const row of failed) {
      run(
        "INSERT INTO delivery_attempts(id,delivery_id,campaign_id,phone,status,provider_id,error,credit_source,attempted_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id(),
        row.id,
        campaign.id,
        row.phone,
        row.status,
        row.provider_id,
        row.error,
        row.credit_source,
        row.updated_at,
      );
      run(
        "UPDATE deliveries SET status='pending',provider_id=NULL,error=NULL,credit_source=?,report_checked_at=0,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        source,
        row.id,
      );
    }
    run(
      "UPDATE campaigns SET status='queued',scheduled_at=NULL,error=NULL,lease_until=NULL,lease_token=NULL,queued_at=CURRENT_TIMESTAMP WHERE id=?",
      campaign.id,
    );
    audit(
      user.id,
      "campaign.retried",
      campaign.id,
      `${failed.length} failed recipients; new ${campaign.channel} credits reserved. Existing unsent recipients keep their reservation.`,
    );
  }).immediate();
  return c.json({ success: true });
});
apiApp.post("/campaigns/:id/clone", (c) => {
  const user = c.get("user");
  const campaignId = id();
  db.transaction(() => {
    const original = ownedCampaign(c.req.param("id"), user);
    if (original.status !== "completed")
      fail(
        409,
        "Only completed campaigns can be copied for another broadcast.",
      );
    accessibleLists(JSON.parse(original.list_ids), {
      ...user,
      id: original.owner_id,
    });
    let copy = 1;
    let name = "";
    do {
      name = original.name.slice(0, 100) + ` - Copy ${copy++}`;
    } while (
      one(
        "SELECT id FROM campaigns WHERE owner_id=? AND name=?",
        original.owner_id,
        name,
      )
    );
    checkCampaignSender(original);
    const provider = original.sender_id ? original.provider : activeProvider();
    run(
      "INSERT INTO campaigns(id,owner_id,name,channel,message,sender,audio_id,list_ids,provider,source_campaign_id,sender_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      campaignId,
      original.owner_id,
      name,
      original.channel,
      original.message,
      original.sender_id
        ? original.sender
        : providerSender(provider, original.channel),
      original.audio_id,
      original.list_ids,
      provider,
      original.id,
      original.sender_id,
    );
    audit(
      user.id,
      "campaign.cloned",
      campaignId,
      `Copied from ${original.id}; awaiting send confirmation.`,
    );
  }).immediate();
  return c.json({ id: campaignId }, 201);
});
apiApp.post("/campaigns/:id/cancel", (c) => {
  const campaign = ownedCampaign(c.req.param("id"), c.get("user"));
  db.transaction(() => {
    if (
      !run(
        "UPDATE campaigns SET status='cancelled' WHERE id=? AND status IN ('draft','queued','scheduled','attention')",
        campaign.id,
      ).changes
    )
      fail(
        409,
        "Only drafts, waiting campaigns, or paused campaigns can be cancelled.",
      );
    const cancelled = all(
      "UPDATE deliveries SET status='cancelled' WHERE campaign_id=? AND status='pending' RETURNING credit_source",
      campaign.id,
    );
    refundRecipients(campaign, cancelled);
    audit(c.get("user").id, "campaign.cancelled", campaign.id);
  }).immediate();
  return c.json({ success: true });
});
apiApp.get("/campaigns/:id/export", (c) => {
  const campaign = ownedCampaign(c.req.param("id"), c.get("user"));
  const rows = deliveryReport(campaign.id, c.get("user")).map(
    ({ phone, status, provider_id, updated_at }) => ({
      phone,
      status,
      provider_id,
      updated_at,
    }),
  );
  const safe = rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v,
      ]),
    ),
  );
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="campaign-report.csv"');
  return c.body(Papa.unparse(safe));
});
apiApp.patch("/profile", async (c) => {
  const b = z
    .object({ name: z.string().trim().min(2).max(100) })
    .parse(await c.req.json());
  run("UPDATE users SET name=? WHERE id=?", b.name, c.get("user").id);
  return c.json({ success: true });
});
apiApp.use("/admin/*", async (c, next) => {
  if (c.get("user").role !== "admin")
    fail(403, "Administrator access required.");
  await next();
});
apiApp.get("/admin/users", (c) =>
  c.json({
    users: all(
      "SELECT id,name,phone,email,role,status,allowance,voice_credits,created_at FROM users ORDER BY created_at DESC LIMIT 500",
    ),
  }),
);
apiApp.patch("/admin/users/:id", async (c) => {
  const b = z
    .object({
      status: z.enum(["active", "suspended"]).optional(),
      grant: z.number().int().min(1).max(1000000).optional(),
      creditType: z.enum(["sms", "voice"]).default("sms"),
    })
    .parse(await c.req.json());
  const target = one("SELECT * FROM users WHERE id=?", c.req.param("id"));
  if (!target) fail(404, "Account not found.");
  if (target.id === c.get("user").id && b.status === "suspended")
    fail(400, "You cannot suspend yourself.");
  db.transaction(() => {
    if (b.status) {
      run("UPDATE users SET status=? WHERE id=?", b.status, target.id);
      if (b.status === "suspended")
        run("DELETE FROM sessions WHERE user_id=?", target.id);
    }
    if (b.grant)
      run(
        `UPDATE users SET ${b.creditType === "voice" ? "voice_credits=voice_credits" : "allowance=allowance"}+? WHERE id=?`,
        b.grant,
        target.id,
      );
    audit(c.get("user").id, "user.updated", target.id, JSON.stringify(b));
  }).immediate();
  return c.json({ success: true });
});
apiApp.get("/admin/lists", (c) =>
  c.json({
    lists: all(
      `${listQuery} WHERE l.visibility='shared' ORDER BY l.created_at DESC LIMIT 500`,
    ),
  }),
);
apiApp.patch("/admin/lists/:id", async (c) => {
  const b = z
    .object({ status: z.enum(["approved", "rejected"]) })
    .parse(await c.req.json());
  if (
    !run(
      "UPDATE lists SET status=? WHERE id=? AND visibility='shared'",
      b.status,
      c.req.param("id"),
    ).changes
  )
    fail(404, "Shared list not found.");
  audit(c.get("user").id, "list." + b.status, c.req.param("id"));
  return c.json({ success: true });
});
apiApp.get("/admin/audit", (c) =>
  c.json({
    events: all(
      "SELECT a.*,u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200",
    ),
  }),
);
apiApp.get("/admin/gateway", (c) =>
  c.json({
    provider: activeProvider(),
    providers: ["arkesel", "mnotify"].map((id) => ({
      id,
      name: id === "arkesel" ? "Arkesel" : "mNotify",
      configured: providerConfigured(id as "arkesel" | "mnotify"),
      sender: providerSender(id as "arkesel" | "mnotify"),
    })),
    configured: providerConfigured(activeProvider()),
    mock: isMock(),
    sender: providerSender(activeProvider()),
    voiceId: providerSender(activeProvider(), "voice") || null,
    webhooks:
      activeProvider() === "arkesel" &&
      Boolean(process.env.ARKESEL_WEBHOOK_SECRET),
    google: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
    worker: one(
      "SELECT detail,created_at FROM audit_log WHERE action='worker.heartbeat' ORDER BY id DESC LIMIT 1",
    ),
    sqlite: one("SELECT sqlite_version() AS version")?.version,
  }),
);
apiApp.patch("/admin/gateway", async (c) => {
  const { provider } = z
    .object({ provider: z.enum(["arkesel", "mnotify"]) })
    .parse(await c.req.json());
  assertProvider(provider);
  db.transaction(() => {
    const previous = activeProvider();
    run("UPDATE settings SET value=? WHERE key='messaging_provider'", provider);
    if (previous !== provider)
      audit(
        c.get("user").id,
        "gateway.provider_changed",
        provider,
        `${previous} → ${provider}`,
      );
  }).immediate();
  return c.json({ provider });
});
apiApp.get("/admin/suppressions", (c) =>
  c.json({
    suppressions: all(
      "SELECT * FROM suppressions ORDER BY created_at DESC LIMIT 500",
    ),
  }),
);
apiApp.post("/admin/suppressions", async (c) => {
  const b = z
    .object({ phone: phoneSchema, reason: z.string().trim().min(2).max(200) })
    .parse(await c.req.json());
  run(
    "INSERT INTO suppressions(phone,reason) VALUES(?,?) ON CONFLICT(phone) DO UPDATE SET reason=excluded.reason",
    b.phone,
    b.reason,
  );
  audit(c.get("user").id, "contact.suppressed", b.phone);
  return c.json({ success: true });
});
apiApp.notFound((c) => c.json({ error: "API endpoint not found." }, 404));
