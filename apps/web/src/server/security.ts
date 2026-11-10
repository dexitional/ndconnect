import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { db, one, run, type Row } from "@ndc/db";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const publicUser = (u: Row) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email,
  role: u.role,
  allowance: u.allowance,
});
export function session(c: Context, userId: string) {
  const value = token();
  run(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    hash(value),
    userId,
    Date.now() + 7 * 86400000,
  );
  setCookie(c, "ndc_session", value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 604800,
  });
}
export function currentUser(c: Context) {
  const value = getCookie(c, "ndc_session");
  return value
    ? one(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.status=?",
        hash(value),
        Date.now(),
        "active",
      )
    : undefined;
}
export function rateLimit(key: string, limit: number, windowMs: number) {
  return db
    .transaction(() => {
      const now = Date.now();
      run(
        "INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END",
        key,
        now + windowMs,
        now,
        now,
      );
      return (
        one("SELECT count FROM rate_limits WHERE key=?", key)!.count <= limit
      );
    })
    .immediate();
}
export function canonical(value: any): string {
  function sort(v: any): any {
    return Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  }
  return JSON.stringify(sort(value)).replace(
    /[^\x00-\x7f]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
export function verifyWebhook(
  payload: unknown,
  timestamp: string,
  signatures: string,
  secret: string,
) {
  if (
    !secret ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${canonical(payload)}`)
    .digest();
  return signatures.split(",").some((s) => {
    const hex = s.trim().replace(/^v1=/, "");
    if (!/^v1=/.test(s.trim()) || !/^[a-f0-9]{64}$/i.test(hex)) return false;
    return timingSafeEqual(expected, Buffer.from(hex, "hex"));
  });
}
