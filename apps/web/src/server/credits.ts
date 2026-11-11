import { run, type Row } from "@ndc/db";
import { HTTPException } from "hono/http-exception";
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

// Every new attempt reserves only the channel's balance. Legacy reservations
// retain their original source so cancellation cannot move credits across balances.
export function reserveCredits(campaign: Row, recipients: number) {
  const voice = campaign.channel === "voice";
  const units = recipients * (voice ? 1 : smsParts(campaign.message).parts);
  const column = voice ? "voice_credits" : "allowance";
  if (
    !run(
      `UPDATE users SET ${column}=${column}-? WHERE id=? AND ${column}>=?`,
      units,
      campaign.owner_id,
      units,
    ).changes
  )
    throw new HTTPException(400, {
      message: `This campaign needs ${units} ${voice ? "voice" : "SMS"} credits. Buy credits for this channel before sending.`,
    });
  return voice ? "voice" : "allowance";
}
