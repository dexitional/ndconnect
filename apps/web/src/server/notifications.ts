import { db, one, all, run, type Row } from "@ndc/db";
import {
  activeProvider,
  providerSender,
  sendBatch,
  ProviderError,
  assertProvider,
} from "./provider";
import { normalizePhone } from "../lib/shared";

// Call inside the business transaction: a committed event always has its alerts.
export function notify(
  userId: string,
  title: string,
  message: string,
  href: string,
  eventKey: string,
) {
  const user = one("SELECT * FROM users WHERE id=?", userId);
  if (!user || user.status !== "active") return;
  if (
    one(
      "SELECT id FROM sms_notifications WHERE event_key=? AND user_id=?",
      eventKey,
      userId,
    )
  )
    return;
  run(
    "INSERT INTO notifications(id,user_id,title,message,href) VALUES(?,?,?,?,?)",
    crypto.randomUUID(),
    userId,
    title,
    message,
    href,
  );
  let phone: string | null = null;
  try {
    if (user.phone && user.verified) phone = normalizePhone(user.phone);
  } catch {}
  const provider = activeProvider();
  run(
    "INSERT INTO sms_notifications(id,event_key,user_id,phone,message,provider,sender,status,error) VALUES(?,?,?,?,?,?,?,?,?)",
    crypto.randomUUID(),
    eventKey,
    userId,
    phone,
    `NDC Connect: ${title}. ${message}`.slice(0, 450),
    provider,
    providerSender(provider),
    phone ? "pending" : "skipped",
    phone ? null : "No verified phone number on this account.",
  );
}
export function notifyAdmins(
  title: string,
  message: string,
  href: string,
  eventKey: string,
  excludeUser?: string,
) {
  for (const admin of all(
    "SELECT id FROM users WHERE role='admin' AND status='active'",
  ))
    if (admin.id !== excludeUser)
      notify(admin.id, title, message, href, eventKey);
}
export async function processNotification(send: typeof sendBatch = sendBatch) {
  const item: Row | undefined = db
    .transaction(() => {
      run(
        "UPDATE sms_notifications SET status='unknown',error='Worker interrupted; check gateway before resending.',lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='sending' AND lease_until<?",
        Date.now(),
      );
      const row = one(
        "SELECT * FROM sms_notifications WHERE status='pending' ORDER BY created_at,rowid LIMIT 1",
      );
      if (!row) return;
      if (
        one("SELECT status FROM users WHERE id=?", row.user_id)?.status !==
        "active"
      ) {
        run(
          "UPDATE sms_notifications SET status='skipped',error='Account is inactive.',updated_at=CURRENT_TIMESTAMP WHERE id=?",
          row.id,
        );
        return;
      }
      // Validate configuration before claiming, so missing keys never create an uncertain send.
      try {
        assertProvider(row.provider);
      } catch {
        run(
          "UPDATE sms_notifications SET status='failed',error='Gateway is not configured.',updated_at=CURRENT_TIMESTAMP WHERE id=?",
          row.id,
        );
        return;
      }
      run(
        "UPDATE sms_notifications SET status='sending',attempts=attempts+1,lease_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        Date.now() + 120000,
        row.id,
      );
      return row;
    })
    .immediate();
  if (!item) return false;
  try {
    const results = await send(
      {
        channel: "sms",
        provider: item.provider,
        sender: item.sender,
        message: item.message,
        notification: true,
      },
      [item.phone],
    );
    const reference = results.find((r) => r.phone === item.phone)?.providerId;
    run(
      "UPDATE sms_notifications SET status=?,provider_id=?,error=?,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'",
      reference ? "accepted" : "unknown",
      reference || null,
      reference
        ? null
        : "Gateway acceptance was not confirmed. Check before resending.",
      item.id,
    );
  } catch (error) {
    const certain = error instanceof ProviderError && !error.uncertain;
    run(
      "UPDATE sms_notifications SET status=?,error=?,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'",
      certain ? "failed" : "unknown",
      error instanceof ProviderError
        ? error.message
        : "Gateway result is uncertain. Check before resending.",
      item.id,
    );
  }
  return true;
}
