import { all, run } from "@ndc/db";
import { isMock, mnotifyRequest, providerConfigured } from "./provider";
import { normalizePhone } from "../lib/shared";

const statuses: Record<string, string> = {
  DELIVERED: "delivered",
  RECEIVED: "delivered",
  ANSWERED: "delivered",
  UNDELIVERED: "failed",
  FAILED: "failed",
  REJECTED: "failed",
  EXPIRED: "failed",
  MISSED: "failed",
  BUSY: "failed",
  "NO ANSWER": "failed",
};
// Read-only provider calls; never resend while reconciling delivery reports.
export async function refreshMnotifyReports() {
  if (isMock() || !providerConfigured("mnotify")) return;
  const batches = all(
    `
    SELECT d.campaign_id,d.provider_id,c.channel FROM deliveries d
    JOIN campaigns c ON c.id=d.campaign_id
    WHERE c.provider='mnotify' AND d.provider_id IS NOT NULL
      AND d.status IN ('accepted','unknown') AND d.report_checked_at<?
      AND d.updated_at>datetime('now','-7 days')
    GROUP BY d.campaign_id,d.provider_id
    ORDER BY min(d.report_checked_at) LIMIT 5`,
    Date.now() - 60000,
  );
  await Promise.all(
    batches.map(async (batch) => {
      run(
        "UPDATE deliveries SET report_checked_at=? WHERE campaign_id=? AND provider_id=?",
        Date.now(),
        batch.campaign_id,
        batch.provider_id,
      );
      try {
        const data = await mnotifyRequest(
          `/${batch.channel === "voice" ? "calls" : "campaign"}/${encodeURIComponent(batch.provider_id)}`,
        );
        for (const row of Array.isArray(data.report) ? data.report : []) {
          if (!row) continue;
          // Voice reports use a per-call campaign_id which can differ from the
          // batch UUID. The authenticated /calls/:batch endpoint scopes these
          // rows; still match the exact local batch and normalized recipient.
          if (
            batch.channel !== "voice" &&
            String(row.campaign_id) !== batch.provider_id
          )
            continue;
          const status = statuses[String(row.status).toUpperCase()];
          if (!status) continue;
          let phone: string;
          try {
            phone = normalizePhone(String(row.recipient));
          } catch {
            continue;
          }
          run(
            `UPDATE deliveries SET status=?,error=NULL,updated_at=CURRENT_TIMESTAMP
          WHERE campaign_id=? AND provider_id=? AND phone=? AND status IN ('accepted','unknown')`,
            status,
            batch.campaign_id,
            batch.provider_id,
            phone,
          );
        }
      } catch {
        // Preserve previous status on report outages. Timestamp bounds retries.
      }
    }),
  );
}
