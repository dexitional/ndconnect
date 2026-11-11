import { db, one, all, run, audit, type Row } from "@ndc/db";
import { replayReceipts } from "./webhooks";
import { checkCampaignSender } from "./senders";
import { refundRecipients } from "./credits";
import {
  sendBatch,
  ProviderError,
  readVoiceRecording,
  isMock,
} from "./provider";
export type SendFunction = typeof sendBatch;
export async function processOne(
  send: SendFunction = sendBatch,
  campaignId?: string,
) {
  const campaign: Row | undefined = db
    .transaction(() => {
      // A lost worker may have submitted its in-flight batch. Never automatically resend it.
      const stale = all(
        "SELECT id FROM campaigns WHERE status='processing' AND lease_until<?" +
          (campaignId ? " AND id=?" : ""),
        Date.now(),
        ...(campaignId ? [campaignId] : []),
      );
      for (const c of stale) {
        run(
          "UPDATE deliveries SET status='unknown',error='Worker interrupted; reconcile with the provider before resending.' WHERE campaign_id=? AND status='sending'",
          c.id,
        );
        run(
          "UPDATE campaigns SET status='attention',error='Worker interrupted. Review recipient results.',lease_until=NULL,lease_token=NULL WHERE id=?",
          c.id,
        );
      }
      const c = one(
        "SELECT * FROM campaigns WHERE status IN ('queued','scheduled') AND (scheduled_at IS NULL OR scheduled_at<=?)" +
          (campaignId ? " AND id=?" : "") +
          " ORDER BY queued_at LIMIT 1",
        Date.now(),
        ...(campaignId ? [campaignId] : []),
      );
      if (!c) return undefined;
      const leaseToken = crypto.randomUUID();
      run(
        "UPDATE campaigns SET status='processing',lease_until=?,lease_token=? WHERE id=?",
        Date.now() + 120000,
        leaseToken,
        c.id,
      );
      return { ...c, lease_token: leaseToken };
    })
    .immediate();
  if (!campaign) return false;
  try {
    const audio = campaign.audio_id
      ? one("SELECT * FROM audio_files WHERE id=?", campaign.audio_id)
      : undefined;
    // Check local files before marking any recipients as submitted. Keep a readable
    // recording for this claim so a file permission failure is safe to resume.
    if (campaign.channel === "voice" && !isMock()) {
      const bytes = await readVoiceRecording(audio);
      audio!.bytes = bytes;
    }
    for (;;) {
      const batch = db
        .transaction(() => {
          // An old process must not continue a campaign after another claim or cancellation.
          if (
            !one(
              "SELECT id FROM campaigns WHERE id=? AND lease_token=? AND status='processing'",
              campaign.id,
              campaign.lease_token,
            )
          )
            return null;
          try {
            checkCampaignSender(campaign);
          } catch {
            throw new ProviderError(
              "Sender ID approval is no longer valid. Contact your administrator.",
            );
          }
          const user = one(
            "SELECT status FROM users WHERE id=?",
            campaign.owner_id,
          );
          const ids: string[] = JSON.parse(campaign.list_ids);
          const blocked = ids.some((listId) => {
            const l = one(
              "SELECT l.*,u.status AS owner_status FROM lists l JOIN users u ON u.id=l.owner_id WHERE l.id=?",
              listId,
            );
            return (
              !l ||
              l.owner_status !== "active" ||
              (l.owner_id !== campaign.owner_id &&
                (l.visibility !== "shared" || l.status !== "approved"))
            );
          });
          if (user?.status !== "active" || blocked)
            throw new ProviderError(
              "Sending stopped because account or list access changed.",
            );
          const excluded = all(
            "UPDATE deliveries SET status='cancelled',error='Recipient opted out before dispatch.' WHERE campaign_id=? AND status='pending' AND phone IN (SELECT phone FROM suppressions) RETURNING credit_source",
            campaign.id,
          );
          refundRecipients(campaign, excluded);
          const rows = all(
            "SELECT * FROM deliveries WHERE campaign_id=? AND status='pending' LIMIT 100",
            campaign.id,
          );
          for (const row of rows)
            run("UPDATE deliveries SET status='sending' WHERE id=?", row.id);
          run(
            "UPDATE campaigns SET lease_until=? WHERE id=?",
            Date.now() + 120000,
            campaign.id,
          );
          return rows;
        })
        .immediate();
      if (batch === null) return true;
      if (!batch.length) break;
      try {
        const results = await send(
          campaign,
          batch.map((r) => r.phone),
          audio,
        );
        db.transaction(() => {
          for (const row of batch) {
            const result = results.find((r) => r.phone === row.phone);
            run(
              "UPDATE deliveries SET status=?,provider_id=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'",
              result?.providerId ? "accepted" : "unknown",
              result?.providerId || null,
              result?.providerId
                ? null
                : "Gateway did not return a recipient reference. Reconcile before resending.",
              row.id,
            );
          }
          replayReceipts();
        }).immediate();
      } catch (error) {
        const uncertain = !(error instanceof ProviderError) || error.uncertain;
        db.transaction(() => {
          for (const row of batch)
            run(
              "UPDATE deliveries SET status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'",
              uncertain ? "unknown" : "failed",
              error instanceof ProviderError
                ? error.message
                : "Gateway result is uncertain. Reconcile before resending.",
              row.id,
            );
        }).immediate();
        throw error;
      }
    }
    const problem = one(
      "SELECT count(*) AS n FROM deliveries WHERE campaign_id=? AND status IN ('failed','unknown')",
      campaign.id,
    )!.n;
    run(
      "UPDATE campaigns SET status=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?",
      problem ? "attention" : "completed",
      campaign.id,
      campaign.lease_token,
    );
    audit(campaign.owner_id, "campaign.processed", campaign.id);
  } catch (error) {
    run(
      "UPDATE campaigns SET status='attention',lease_until=NULL,lease_token=NULL,error=? WHERE id=? AND lease_token=?",
      error instanceof ProviderError
        ? error.message
        : "Dispatch interrupted; review delivery report.",
      campaign.id,
      campaign.lease_token,
    );
  }
  return true;
}
export function maintenance() {
  db.transaction(() => {
    run("DELETE FROM sessions WHERE expires_at<?", Date.now());
    run("DELETE FROM rate_limits WHERE reset_at<?", Date.now());
    run("DELETE FROM otp_requests WHERE requested_at<?", Date.now() - 86400000);
    run(
      "DELETE FROM webhook_events WHERE created_at<?",
      Date.now() - 30 * 86400000,
    );
    run("DELETE FROM audit_log WHERE action='worker.heartbeat'");
    audit(null, "worker.heartbeat", "worker", new Date().toISOString());
  }).immediate();
  replayReceipts();
  db.pragma("optimize");
}
