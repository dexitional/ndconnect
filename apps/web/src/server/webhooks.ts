import { all, one, run } from "@ndc/db";
import { normalizePhone } from "../lib/shared";
const statuses: Record<string, string> = {
  DELIVERED: "delivered",
  ANSWERED: "delivered",
  FAILED: "failed",
  UNDELIVERED: "failed",
  NOT_DELIVERED: "failed",
  PROHIBITED: "failed",
  EXPIRED: "failed",
  REJECTED: "failed",
  "NO ANSWER": "failed",
  BUSY: "failed",
};
// Keep early callbacks in an inbox until the provider's send response supplies its IDs.
// SMS receipts identify a unique sms_id; voice receipts identify campaign_id + recipient.
export function replayReceipts() {
  for (const event of all(
    "SELECT id,payload FROM webhook_events WHERE processed=0 AND payload IS NOT NULL ORDER BY created_at LIMIT 1000",
  )) {
    const payload = JSON.parse(event.payload);
    const rows = Array.isArray(payload.data) ? payload.data : [payload];
    let complete = true;
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const status = statuses[String(r.status).toUpperCase()];
      if (!status) continue;
      const providerId = r.sms_id || r.id || r.campaign_id;
      if (typeof providerId !== "string") continue;
      const recipient = r.recipient || r.number;
      let phone: string | undefined;
      if (recipient) {
        try {
          phone = normalizePhone(String(recipient));
        } catch {
          continue;
        }
      }
      // A voice campaign ID is shared by many recipients and must never update all of them.
      if (r.campaign_id && !phone) continue;
      const params = phone ? [providerId, phone] : [providerId];
      const where =
        "campaign_id IN (SELECT id FROM campaigns WHERE provider='arkesel') AND provider_id=?" +
        (phone ? " AND phone=?" : "");
      if (!one(`SELECT id FROM deliveries WHERE ${where} LIMIT 1`, ...params)) {
        complete = false;
        continue;
      }
      run(
        `UPDATE deliveries SET status=?,updated_at=CURRENT_TIMESTAMP WHERE ${where} AND status IN ('accepted','unknown','sending')`,
        status,
        ...params,
      );
    }
    if (complete)
      run("UPDATE webhook_events SET processed=1 WHERE id=?", event.id);
  }
}
