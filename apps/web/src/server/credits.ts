import { run, type Row } from "@ndc/db";
import { smsParts } from "../lib/shared";

// Refund each unsent recipient to the balance originally reserved for it.
export function refundRecipients(campaign: Row, recipients: Row[]) {
  const voice = recipients.filter(
    (row) => row.credit_source === "voice",
  ).length;
  const allowance =
    (recipients.length - voice) *
    (campaign.channel === "sms" ? smsParts(campaign.message).parts : 1);
  if (recipients.length)
    run(
      "UPDATE users SET voice_credits=voice_credits+?,allowance=allowance+? WHERE id=?",
      voice,
      allowance,
      campaign.owner_id,
    );
}
