import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
config({ path: "../../.env", quiet: true });
// Isolate caches from IDE previews that may run under a different OS account.
const cache = resolve(".cache", `runtime-${process.getuid?.() ?? "default"}`);
mkdirSync(cache, { recursive: true });
export default defineConfig({
  cacheDir: resolve(cache, "vite"),
  plugins: [
    nitro({
      preset: "node-server",
      rootDir: cache,
      buildDir: resolve(cache, "nitro"),
      output: {
        dir: resolve(".output"),
        serverDir: resolve(".output/server"),
        publicDir: resolve(".output/public"),
      },
    }),
    tailwindcss(),
    tanstackStart(),
    react(),
  ],
  server: { port: 3100 },
  ssr: { external: ["better-sqlite3"] },
});
