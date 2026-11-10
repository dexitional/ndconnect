import { db, one, run, audit } from "@ndc/db";
import { hash } from "bcryptjs";
import { normalizePhone } from "../apps/web/src/lib/shared";
const phone = normalizePhone(process.env.ADMIN_PHONE || "");
const password = process.env.ADMIN_PASSWORD || "";
if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72)
  throw new Error(
    "Set ADMIN_PASSWORD to at least 12 characters and no more than 72 UTF-8 bytes.",
  );
if (one("SELECT id FROM users WHERE phone=?", phone))
  throw new Error(
    "Account already exists. This command will not overwrite it.",
  );
const id = crypto.randomUUID();
run(
  "INSERT INTO users(id,name,phone,password_hash,role,verified,allowance) VALUES(?,?,?,?,'admin',1,100000)",
  id,
  process.env.ADMIN_NAME || "Administrator",
  phone,
  await hash(password, 12),
);
audit(id, "admin.bootstrapped", id);
console.log(
  "Administrator created. Sign in at /admin/login with the supplied credentials.",
);
db.close();
