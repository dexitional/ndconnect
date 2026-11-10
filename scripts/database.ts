import { db, root } from "@ndc/db";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
if (process.argv[2] === "backup") {
  const dir = resolve(root, "backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = resolve(
    dir,
    `ndcms-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
  );
  await db.backup(target);
  console.log("Consistent online backup created:", target);
} else {
  console.log(
    "Migrations applied. SQLite",
    db.prepare("SELECT sqlite_version() AS version").get(),
  );
}
db.pragma("optimize");
db.close();
