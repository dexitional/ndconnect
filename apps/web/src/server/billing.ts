import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, one, all, run, audit, type Row } from "@ndc/db";
import { normalizePhone } from "../lib/shared";
import { money } from "../lib/billing";
import { notify, notifyAdmins } from "./notifications";
import { rateLimit } from "./security";

type Env = { Variables: { user: Row } };
export const billingRoutes = new Hono<Env>();
function fail(status: 400 | 403 | 404 | 409 | 429, message: string): never {
  throw new HTTPException(status, { message });
}
const phone = z
  .string()
  .max(30)
  .transform((value, ctx) => {
    try {
      return normalizePhone(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number." });
      return z.NEVER;
    }
  });
const amount = z
  .string()
  .regex(
    /^\d{1,10}(\.\d{1,2})?$/,
    "Enter a GHC amount with at most two decimal places.",
  )
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  });
export function paymentSettings() {
  const values = Object.fromEntries(
    all(
      "SELECT key,value FROM settings WHERE key IN ('voice_rate_pesewas','sms_rate_pesewas','payment_phone','payment_name','payment_network')",
    ).map((row) => [row.key, row.value]),
  );
  return {
    ratePesewas: Number(values.voice_rate_pesewas),
    smsRatePesewas: Number(values.sms_rate_pesewas),
    phone: values.payment_phone,
    name: values.payment_name,
    network: values.payment_network,
  };
}
function ownedOrder(id: string, userId: string) {
  const order = one(
    "SELECT * FROM payment_requests WHERE id=? AND user_id=?",
    id,
    userId,
  );
  if (!order) fail(404, "Payment request not found.");
  return order;
}
billingRoutes.get("/billing/settings", (c) =>
  c.json({
    settings: paymentSettings(),
    smsCredits: one("SELECT allowance FROM users WHERE id=?", c.get("user").id)!
      .allowance,
    voiceCredits: one(
      "SELECT voice_credits FROM users WHERE id=?",
      c.get("user").id,
    )!.voice_credits,
  }),
);
billingRoutes.get("/billing/orders", (c) =>
  c.json({
    orders: all(
      "SELECT * FROM payment_requests WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200",
      c.get("user").id,
    ),
  }),
);
billingRoutes.post("/billing/orders", async (c) => {
  const { credits, creditType } = z
    .object({
      credits: z.number().int().min(1).max(100000),
      creditType: z.enum(["sms", "voice"]).default("voice"),
    })
    .parse(await c.req.json());
  const user = c.get("user");
  if (!rateLimit("payment-create:" + user.id, 20, 15 * 60000))
    fail(429, "Please wait before creating another payment request.");
  const id = crypto.randomUUID();
  db.transaction(() => {
    const settings = paymentSettings();
    const rate =
      creditType === "sms" ? settings.smsRatePesewas : settings.ratePesewas;
    run(
      "INSERT INTO payment_requests(id,user_id,credits,rate_pesewas,total_pesewas,payment_phone,payment_name,payment_network,credit_type) VALUES(?,?,?,?,?,?,?,?,?)",
      id,
      user.id,
      credits,
      rate,
      credits * rate,
      settings.phone,
      settings.name,
      settings.network,
      creditType,
    );
    notify(
      user.id,
      "Payment request created",
      `Request ${id.slice(0, 8)}: pay ${money(credits * rate)} to ${settings.phone} for ${credits} ${creditType} credits, then submit transaction details.`,
      "/credits?id=" + id,
      `payment:${id}:created`,
    );
    audit(
      user.id,
      "payment.created",
      id,
      `${credits} ${creditType} credits at ${money(rate)} each`,
    );
  }).immediate();
  return c.json({ order: ownedOrder(id, user.id) }, 201);
});
billingRoutes.patch("/billing/orders/:id", async (c) => {
  const body = z
    .object({
      version: z.number().int().min(1),
      transactionId: z
        .string()
        .trim()
        .max(100)
        .transform((v) => v.replace(/\s/g, "").toUpperCase())
        .pipe(
          z
            .string()
            .regex(
              /^[A-Z0-9][A-Z0-9._/-]{4,79}$/,
              "Enter a valid transaction ID (5–80 characters).",
            ),
        ),
      payerName: z.string().trim().min(2).max(120),
      payerPhone: phone,
      payerNetwork: z.enum(["MTN MoMo", "Telecel Cash", "AT Money"]),
      paidAmount: amount,
      paidAt: z.iso.datetime({ offset: true }),
      note: z.string().trim().max(500).default(""),
    })
    .parse(await c.req.json());
  const user = c.get("user");
  if (!rateLimit("payment-submit:" + user.id, 20, 15 * 60000))
    fail(429, "Please wait before updating payment details again.");
  if (Date.parse(body.paidAt) > Date.now() + 300000)
    fail(400, "Payment time cannot be in the future.");
  db.transaction(() => {
    const order = ownedOrder(c.req.param("id"), user.id);
    if (order.status === "approved")
      fail(409, "Approved payments cannot be changed.");
    if (order.version !== body.version)
      fail(409, "This payment changed. Refresh and review the latest details.");
    if (body.paidAmount !== order.total_pesewas)
      fail(
        400,
        `This request requires exactly ${money(order.total_pesewas)}. Check the amount and credits requested.`,
      );
    if (
      one(
        "SELECT id FROM payment_requests WHERE transaction_id=? AND id!=?",
        body.transactionId,
        order.id,
      )
    )
      fail(409, "This transaction ID has already been submitted.");
    run(
      `UPDATE payment_requests SET transaction_id=?,payer_name=?,payer_phone=?,payer_network=?,paid_pesewas=?,paid_at=?,note=?,status='pending',version=version+1,reviewer_id=NULL,review_note=NULL,reviewed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      body.transactionId,
      body.payerName,
      body.payerPhone,
      body.payerNetwork,
      body.paidAmount,
      body.paidAt,
      body.note,
      order.id,
    );
    const event = `payment:${order.id}:submitted:${order.version + 1}`;
    const message = `Request ${order.id.slice(0, 8)}: ${money(order.total_pesewas)} for ${order.credits} ${order.credit_type === "sms" ? "SMS" : "voice"} credits awaits confirmation.`;
    notify(
      user.id,
      "Payment details received",
      message,
      "/credits?id=" + order.id,
      event,
    );
    notifyAdmins(
      order.status === "pending"
        ? "Payment details updated"
        : "Payment awaiting confirmation",
      `${user.name}. ${message}`,
      "/admin/payments?id=" + order.id,
      event,
      user.id,
    );
    audit(
      user.id,
      "payment.submitted",
      order.id,
      `Revision ${order.version + 1}; ${order.credits} ${order.credit_type === "sms" ? "SMS" : "voice"} credits`,
    );
  }).immediate();
  return c.json({ order: ownedOrder(c.req.param("id"), user.id) });
});
billingRoutes.get("/notifications", (c) => {
  const user = c.get("user");
  return c.json({
    notifications: all(
      "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50",
      user.id,
    ),
    unread: one(
      "SELECT count(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL",
      user.id,
    )!.n,
  });
});
billingRoutes.post("/notifications/read-all", (c) => {
  run(
    "UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL",
    c.get("user").id,
  );
  return c.json({ success: true });
});
billingRoutes.post("/notifications/:id/read", (c) => {
  if (
    !run(
      "UPDATE notifications SET read_at=coalesce(read_at,CURRENT_TIMESTAMP) WHERE id=? AND user_id=?",
      c.req.param("id"),
      c.get("user").id,
    ).changes
  )
    fail(404, "Notification not found.");
  return c.json({ success: true });
});
billingRoutes.use("/admin/*", async (c, next) => {
  if (c.get("user").role !== "admin")
    fail(403, "Administrator access required.");
  await next();
});
billingRoutes.get("/admin/payments", (c) =>
  c.json({
    settings: paymentSettings(),
    payments: all(
      "SELECT p.*,u.name AS user_name,u.phone AS user_phone,r.name AS reviewer_name FROM payment_requests p JOIN users u ON u.id=p.user_id LEFT JOIN users r ON r.id=p.reviewer_id WHERE p.status!='awaiting_payment' ORDER BY (p.status='pending') DESC,p.updated_at DESC,p.rowid DESC LIMIT 500",
    ),
    pending: one(
      "SELECT count(*) AS n FROM payment_requests WHERE status='pending'",
    )!.n,
  }),
);
billingRoutes.patch("/admin/payment-settings", async (c) => {
  const body = z
    .object({
      rate: amount.pipe(z.number().int().min(1).max(100000)),
      smsRate: amount.pipe(z.number().int().min(1).max(100000)).optional(),
      phone,
      name: z.string().trim().min(2).max(120),
      network: z.enum(["Mobile Money", "MTN MoMo", "Telecel Cash", "AT Money"]),
    })
    .parse(await c.req.json());
  db.transaction(() => {
    for (const [key, value] of Object.entries({
      voice_rate_pesewas: body.rate,
      ...(body.smsRate === undefined ? {} : { sms_rate_pesewas: body.smsRate }),
      payment_phone: body.phone,
      payment_name: body.name,
      payment_network: body.network,
    }))
      run("UPDATE settings SET value=? WHERE key=?", String(value), key);
    audit(
      c.get("user").id,
      "payment.settings_updated",
      "payments",
      `${money(body.rate)} per voice credit; existing requests keep their quote`,
    );
  }).immediate();
  return c.json({ settings: paymentSettings() });
});
billingRoutes.post("/admin/payments/:id/review", async (c) => {
  const body = z
    .object({
      version: z.number().int().min(1),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().max(500).default(""),
    })
    .parse(await c.req.json());
  if (body.decision === "rejected" && body.note.length < 3)
    fail(400, "Explain why the payment was rejected.");
  const admin = c.get("user");
  db.transaction(() => {
    const order = one(
      "SELECT * FROM payment_requests WHERE id=?",
      c.req.param("id"),
    );
    if (!order) fail(404, "Payment request not found.");
    if (order.status !== "pending")
      fail(
        409,
        "Only pending payments can be reviewed. Credits are never added twice.",
      );
    if (order.version !== body.version)
      fail(
        409,
        "The user updated this payment. Refresh and review the latest details before confirming.",
      );
    if (!order.transaction_id || order.paid_pesewas !== order.total_pesewas)
      fail(400, "Payment details are incomplete or the amount does not match.");
    if (body.decision === "approved") {
      run(
        "INSERT INTO credit_purchases(id,payment_id,user_id,credits,credit_type) VALUES(?,?,?,?,?)",
        crypto.randomUUID(),
        order.id,
        order.user_id,
        order.credits,
        order.credit_type,
      );
      run(
        `UPDATE users SET ${order.credit_type === "sms" ? "allowance=allowance" : "voice_credits=voice_credits"}+? WHERE id=?`,
        order.credits,
        order.user_id,
      );
    }
    run(
      "UPDATE payment_requests SET status=?,version=version+1,reviewer_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      body.decision,
      admin.id,
      body.note,
      order.id,
    );
    notify(
      order.user_id,
      body.decision === "approved"
        ? order.credit_type === "sms"
          ? "SMS credits added"
          : "Voice credits added"
        : "Payment needs attention",
      body.decision === "approved"
        ? `${order.credits} ${order.credit_type === "sms" ? "SMS" : "voice"} credits have been added to your account.`
        : body.note,
      "/credits?id=" + order.id,
      `payment:${order.id}:reviewed:${order.version + 1}`,
    );
    notifyAdmins(
      `Payment ${body.decision}`,
      `Request ${order.id.slice(0, 8)}: ${money(order.total_pesewas)} for ${order.credits} ${order.credit_type} credits was ${body.decision}.`,
      "/admin/payments?id=" + order.id,
      `payment:${order.id}:reviewed:${order.version + 1}`,
      order.user_id,
    );
    audit(
      admin.id,
      "payment." + body.decision,
      order.id,
      `${order.credits} ${order.credit_type === "sms" ? "SMS" : "voice"} credits; ${money(order.total_pesewas)}; ${body.note}`,
    );
  }).immediate();
  return c.json({ success: true });
});
