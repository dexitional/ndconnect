import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.chdir(root);
process.env.NODE_ENV = "production";
process.env.APP_URL ||= "http://localhost:3100";
// Keep a direct local production preview on its configured origin. Deployments
// behind a reverse proxy can choose a different internal port explicitly.
process.env.PORT ||=
  process.env.NITRO_PORT || new URL(process.env.APP_URL).port || "3000";

await import(
  pathToFileURL(resolve(root, "apps/web/.output/server/index.mjs")).href
);
