import "@ndc/db";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { uploadDir, one, run, type Row } from "@ndc/db";
import { normalizePhone } from "../lib/shared";
export type Provider = "arkesel" | "mnotify";
export function activeProvider(): Provider {
  return one("SELECT value FROM settings WHERE key='messaging_provider'")
    ?.value === "mnotify"
    ? "mnotify"
    : "arkesel";
}
export function providerConfigured(provider: Provider) {
  return Boolean(
    (provider === "mnotify"
      ? process.env.MNOTIFY_API_KEY
      : process.env.ARKESEL_API_KEY
    )?.trim(),
  );
}
export function providerSender(provider: Provider, channel = "sms") {
  if (channel === "voice")
    return provider === "arkesel"
      ? process.env.ARKESEL_VOICE_ID?.trim() || ""
      : "";
  return (
    (provider === "mnotify"
      ? process.env.MNOTIFY_SENDER_ID
      : process.env.ARKESEL_SENDER_ID
    )?.trim() || "NDC"
  );
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public uncertain = false,
  ) {
    super(message);
  }
}
export async function readVoiceRecording(audio?: Row): Promise<Buffer> {
  if (!audio) throw new ProviderError("Voice recording is missing.");
  if (Buffer.isBuffer(audio.bytes)) return audio.bytes;
  try {
    return await readFile(resolve(uploadDir, audio.id));
  } catch {
    throw new ProviderError(
      "The sending service cannot read the voice recording. Check upload file permissions and run the web server and worker under the same operating-system account. No call was submitted.",
    );
  }
}
export const isMock = () =>
  process.env.MOCK_PROVIDER === "true" && process.env.NODE_ENV !== "production";
export function assertProvider(provider: Provider = activeProvider()) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.MOCK_PROVIDER === "true"
  )
    throw new Error("Mock provider is forbidden in production.");
  if (!isMock() && !providerConfigured(provider))
    throw new ProviderError(
      "Messaging is not configured. Contact your administrator.",
    );
}
export async function providerRequest(path: string, body: object | FormData) {
  assertProvider("arkesel");
  let response: Response;
  try {
    response = await fetch("https://sms.arkesel.com" + path, {
      method: "POST",
      headers: {
        "api-key": process.env.ARKESEL_API_KEY!,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
  } catch {
    throw new ProviderError(
      "Gateway response was not received. Reconcile with Arkesel before resending.",
      true,
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new ProviderError(
      "Gateway returned an unreadable response. Reconcile before resending.",
      true,
    );
  }
  const success =
    path === "/api/otp/verify"
      ? String(data?.code) === "1100"
      : path === "/api/otp/generate"
        ? String(data?.code) === "1000"
        : data?.status === "success";
  if (!response.ok || !success) {
    const uncertain =
      response.status >= 500 ||
      (response.ok && data?.status !== "error" && data?.code == null);
    // Do not expose provider response bodies, which may contain account information.
    throw new ProviderError(
      response.status === 402
        ? "Arkesel balance is insufficient."
        : uncertain
          ? "Gateway status is uncertain. Reconcile with Arkesel before resending."
          : "Arkesel rejected the request. Check account configuration or verification code.",
      uncertain,
    );
  }
  return data;
}
export async function requestOtp(
  phone: string,
  provider: Provider = activeProvider(),
  requestedAt?: number,
) {
  assertProvider(provider);
  if (isMock()) return;
  if (provider === "mnotify") {
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const salt = randomUUID();
    const digest = createHash("sha256")
      .update(salt + code)
      .digest("hex");
    const saved = run(
      "UPDATE otp_requests SET code_hash=? WHERE phone=? AND requested_at=? AND provider='mnotify'",
      salt + ":" + digest,
      phone,
      requestedAt,
    );
    if (!saved.changes)
      throw new ProviderError("Request a new verification code.");
    const result = await mnotifyRequest("/sms/quick", {
      recipient: [phone.slice(1)],
      sender: providerSender(provider),
      message: `Your NDC Connect verification code is ${code}. Expires in 5 minutes.`,
      sms_type: "otp",
      is_schedule: false,
      schedule_date: "",
    });
    if (!mnotifyResults(result, [phone])[0]?.providerId)
      throw new ProviderError(
        "Verification message was not confirmed. Please try again later.",
        true,
      );
    return;
  }
  await providerRequest("/api/otp/generate", {
    expiry: 5,
    length: 6,
    medium: "sms",
    message:
      "Your NDC Connect verification code is %otp_code%. Expires in %expiry% minutes.",
    number: phone.slice(1),
    sender_id: process.env.ARKESEL_SENDER_ID || "NDC",
    type: "numeric",
  });
}
export async function verifyOtp(phone: string, code: string, attempt?: Row) {
  const provider = attempt?.provider || "arkesel";
  assertProvider(provider);
  if (isMock()) {
    if (code !== "123456")
      throw new ProviderError("Incorrect verification code.");
    return;
  }
  if (provider === "mnotify") {
    const [salt, digest] = String(attempt?.code_hash || "").split(":");
    const expected = Buffer.from(digest || "", "hex");
    const actual = createHash("sha256")
      .update(salt + code)
      .digest();
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new ProviderError("Incorrect verification code.");
    return;
  }
  await providerRequest("/api/otp/verify", { number: phone.slice(1), code });
}
export async function sendBatch(campaign: Row, phones: string[], audio?: Row) {
  const provider: Provider = campaign.provider || "arkesel";
  assertProvider(provider);
  if (isMock())
    return phones.map((phone) => ({
      phone,
      providerId: "mock-" + crypto.randomUUID(),
    }));
  if (provider === "mnotify") return sendMnotify(campaign, phones, audio);
  const callback =
    !campaign.notification && process.env.ARKESEL_WEBHOOK_SECRET
      ? `${process.env.APP_URL}/api/webhooks/arkesel`
      : undefined;
  let data: any;
  if (campaign.channel === "sms") {
    data = await providerRequest("/api/v2/sms/send", {
      sender: campaign.sender,
      message: campaign.message,
      recipients: phones.map((p) => p.slice(1)),
      ...(callback ? { callback_url: callback } : {}),
    });
    return phones.map((phone) => {
      const entry = Array.isArray(data.data)
        ? data.data.find(
            (r: any) => "+" + String(r.recipient).replace(/^\+/, "") === phone,
          )
        : undefined;
      return { phone, providerId: entry?.id ? String(entry.id) : null };
    });
  }
  if (!audio) throw new ProviderError("Voice recording is missing.");
  const form = new FormData();
  phones.forEach((p) => form.append("recipients[]", p.slice(1)));
  // Arkesel requires only recipients and voice_file; a custom voice_id is optional.
  const voiceId = campaign.sender?.trim();
  if (voiceId) form.append("voice_id", voiceId);
  form.append("retry", "false");
  if (callback) form.append("callback_url", callback);
  form.append(
    "voice_file",
    new Blob([new Uint8Array(await readVoiceRecording(audio))], {
      type: audio.mime,
    }),
    audio.filename,
  );
  data = await providerRequest("/api/v2/sms/voice/send", form);
  return phones.map((phone) => ({
    phone,
    providerId: data.data?.campaign_id ? String(data.data.campaign_id) : null,
  }));
}

// mNotify authenticates with a query parameter. Never log request URLs or raw responses.
export async function mnotifyRequest(path: string, body?: object | FormData) {
  assertProvider("mnotify");
  const url = new URL("https://api.mnotify.com/api" + path);
  url.searchParams.set("key", process.env.MNOTIFY_API_KEY!.trim());
  let response: Response;
  let data: any;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body !== undefined && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {},
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    data = await response.json();
  } catch {
    throw new ProviderError(
      "mNotify response was not received or could not be read. Reconcile before resending.",
      true,
    );
  }
  if (
    !response.ok ||
    data?.status !== "success" ||
    (body !== undefined && String(data?.code) !== "2000")
  ) {
    const uncertain =
      response.status >= 500 ||
      (response.ok &&
        !["error", "failed"].includes(data?.status) &&
        data?.code == null);
    throw new ProviderError(
      uncertain
        ? "mNotify status is uncertain. Reconcile before resending."
        : "mNotify rejected the request. Check your API key, approved sender ID, and account balance.",
      uncertain,
    );
  }
  return data;
}
function mnotifyResults(data: any, phones: string[]) {
  const summary = data?.summary;
  const accepted = new Set<string>();
  // A successful batch can exclude recipients; never infer acceptance from a batch ID alone.
  for (const phone of Array.isArray(summary?.numbers_sent)
    ? summary.numbers_sent
    : []) {
    try {
      accepted.add(normalizePhone(String(phone)));
    } catch {
      /* Ignore malformed references. */
    }
  }
  const reference =
    typeof summary?._id === "string" && summary._id ? summary._id : null;
  // Live voice responses can omit numbers_sent. Accept the entire batch only
  // when the provider explicitly confirms all requested contacts and zero rejects.
  const entireBatchAccepted =
    Number(summary?.total_sent) === phones.length &&
    Number(summary?.contacts) === phones.length &&
    summary?.total_rejected != null &&
    Number(summary.total_rejected) === 0 &&
    Number(summary?.international_dropped ?? 0) === 0;
  return phones.map((phone) => ({
    phone,
    providerId:
      reference && (accepted.has(phone) || entireBatchAccepted)
        ? reference
        : null,
  }));
}
async function sendMnotify(campaign: Row, phones: string[], audio?: Row) {
  if (campaign.channel === "sms") {
    const data = await mnotifyRequest("/sms/quick", {
      recipient: phones.map((p) => p.slice(1)),
      sender: campaign.sender,
      message: campaign.message,
      is_schedule: false,
      schedule_date: "",
    });
    return mnotifyResults(data, phones);
  }
  if (!audio) throw new ProviderError("Voice recording is missing.");
  const form = new FormData();
  phones.forEach((phone) => form.append("recipient[]", phone.slice(1)));
  form.append("campaign", campaign.name);
  form.append("is_schedule", "false");
  form.append("schedule_date", "");
  // mNotify's voice_id identifies a previously uploaded recording, NOT a caller ID.
  // Upload file alone; the documented API requires file OR voice_id.
  form.append(
    "file",
    new Blob([new Uint8Array(await readVoiceRecording(audio))], {
      type: audio.mime,
    }),
    audio.filename,
  );
  return mnotifyResults(await mnotifyRequest("/voice/quick", form), phones);
}
