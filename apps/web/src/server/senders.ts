import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, one, all, run, audit, type Row } from "@ndc/db";
import {
  activeProvider,
  providerSender,
  mnotifyRequest,
  isMock,
  type Provider,
} from "./provider";
import { notify, notifyAdmins } from "./notifications";
import { rateLimit } from "./security";
export const senderRoutes = new Hono<{ Variables: { user: Row } }>();
function fail(status: 400 | 403 | 404 | 409 | 429, message: string): never {
  throw new HTTPException(status, { message });
}
export function approvedSender(id: string, userId: string, provider: string) {
  const sender = one(
    "SELECT * FROM sender_ids WHERE id=? AND user_id=? AND provider=? AND status='approved' AND gateway_verified_at IS NOT NULL",
    id,
    userId,
    provider,
  );
  if (!sender)
    fail(
      403,
      "This Sender ID is not approved for your account and campaign gateway.",
    );
  return sender;
}
export function checkCampaignSender(campaign: Row) {
  if (campaign.channel === "sms" && campaign.sender_id) {
    const sender = approvedSender(
      campaign.sender_id,
      campaign.owner_id,
      campaign.provider,
    );
    if (sender.name !== campaign.sender)
      fail(403, "The campaign Sender ID no longer matches its approval.");
  }
}
senderRoutes.get("/sender-ids", (c) =>
  c.json({
    provider: activeProvider(),
    defaultSender: providerSender(activeProvider()),
    senders: all(
      "SELECT * FROM sender_ids WHERE user_id=? ORDER BY created_at DESC",
      c.get("user").id,
    ),
  }),
);
senderRoutes.post("/sender-ids", async (c) => {
  const b = z
    .object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(11)
        .regex(
          /^(?=.*[A-Za-z])[A-Za-z0-9]+$/,
          "Use up to 11 letters and numbers, with at least one letter.",
        ),
      purpose: z.string().trim().min(10).max(500),
    })
    .parse(await c.req.json());
  const user = c.get("user");
  if (!rateLimit("sender-request:" + user.id, 5, 86400000))
    fail(429, "You can submit up to five Sender ID requests per day.");
  let requestId = "";
  db.transaction(() => {
    const provider = activeProvider();
    const previous = one(
      "SELECT * FROM sender_ids WHERE user_id=? AND provider=? AND name=?",
      user.id,
      provider,
      b.name,
    );
    if (previous && !["rejected", "revoked"].includes(previous.status))
      fail(409, "This Sender ID already has an active request or approval.");
    requestId = previous?.id || crypto.randomUUID();
    if (previous)
      run(
        "UPDATE sender_ids SET purpose=?,status='pending',version=version+1,reviewer_id=NULL,review_note=NULL,gateway_verified_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        b.purpose,
        requestId,
      );
    else
      run(
        "INSERT INTO sender_ids(id,user_id,provider,name,purpose) VALUES(?,?,?,?,?)",
        requestId,
        user.id,
        provider,
        b.name,
        b.purpose,
      );
    const version = one(
      "SELECT version FROM sender_ids WHERE id=?",
      requestId,
    )!.version;
    const event = `sender:${requestId}:${version}`;
    notify(
      user.id,
      "Sender ID request received",
      `${b.name} (${provider}) is awaiting gateway registration and administrator approval.`,
      "/sender-ids",
      event,
    );
    notifyAdmins(
      "Sender ID awaiting approval",
      `${user.name} requested ${b.name} on ${provider}. Register and verify it on the gateway before approval.`,
      "/admin/sender-ids",
      event,
      user.id,
    );
    audit(user.id, "sender.requested", requestId);
  }).immediate();
  return c.json({ id: requestId }, 201);
});
senderRoutes.use("/admin/*", async (c, next) => {
  if (c.get("user").role !== "admin")
    fail(403, "Administrator access required.");
  await next();
});
senderRoutes.get("/admin/sender-ids", (c) =>
  c.json({
    senders: all(
      "SELECT s.*,u.name AS user_name,u.phone AS user_phone FROM sender_ids s JOIN users u ON u.id=s.user_id ORDER BY (s.status='pending') DESC,s.updated_at DESC LIMIT 500",
    ),
  }),
);
senderRoutes.post("/admin/sender-ids/:id/review", async (c) => {
  const b = z
    .object({
      version: z.number().int().positive(),
      decision: z.enum(["approved", "rejected", "revoked"]),
      gatewayRegistered: z.boolean().default(false),
      note: z.string().trim().min(3).max(500),
    })
    .parse(await c.req.json());
  const before = one("SELECT * FROM sender_ids WHERE id=?", c.req.param("id"));
  if (!before) fail(404, "Sender ID request not found.");
  if (before.version !== b.version)
    fail(409, "This request changed. Refresh before reviewing.");
  if (b.decision === "approved") {
    if (!b.gatewayRegistered)
      fail(
        400,
        "Confirm registration and approval on the selected gateway first.",
      );
    if (before.provider === "mnotify" && !isMock()) {
      const result = await mnotifyRequest("/senderid/status", {
        sender_name: before.name,
      });
      const summary = result?.summary;
      if (
        String(summary?.status).toLowerCase() !== "approved" ||
        String(
          summary?.["sender name"] || summary?.sender_name || "",
        ).toLowerCase() !== before.name.toLowerCase()
      )
        fail(
          409,
          "mNotify has not confirmed this Sender ID as approved. Complete gateway registration first.",
        );
    }
  }
  db.transaction(() => {
    const row = one("SELECT * FROM sender_ids WHERE id=?", before.id)!;
    if (
      row.version !== b.version ||
      (b.decision === "revoked"
        ? row.status !== "approved"
        : row.status !== "pending")
    )
      fail(409, "This request has already changed or been reviewed.");
    run(
      "UPDATE sender_ids SET status=?,reviewer_id=?,review_note=?,gateway_verified_at=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      b.decision,
      c.get("user").id,
      b.note,
      b.decision === "approved" ? new Date().toISOString() : null,
      row.id,
    );
    const event = `sender:${row.id}:${row.version + 1}`;
    const title = `Sender ID ${b.decision}`;
    const message = `${row.name} (${row.provider}) was ${b.decision}. ${b.decision === "approved" ? "You can select it for SMS campaigns." : "Sign in to review the administrator note."}`;
    notify(row.user_id, title, message, "/sender-ids", event);
    notifyAdmins(title, message, "/admin/sender-ids", event, row.user_id);
    audit(c.get("user").id, "sender." + b.decision, row.id, b.note);
  }).immediate();
  return c.json({ success: true });
});
senderRoutes.get("/admin/sms-notifications", (c) =>
  c.json({
    notifications: all(
      "SELECT n.*,u.name AS user_name FROM sms_notifications n JOIN users u ON u.id=n.user_id ORDER BY n.created_at DESC,n.rowid DESC LIMIT 200",
    ),
  }),
);
senderRoutes.post("/admin/sms-notifications/:id/retry", async (c) => {
  const { attempts } = z
    .object({ attempts: z.number().int().min(0) })
    .parse(await c.req.json());
  if (
    !run(
      "UPDATE sms_notifications SET status='pending',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='failed' AND attempts=?",
      c.req.param("id"),
      attempts,
    ).changes
  )
    fail(
      409,
      "Only a confirmed failed notification can be retried. Refresh its status.",
    );
  audit(c.get("user").id, "notification.retry", c.req.param("id"));
  return c.json({ success: true });
});
