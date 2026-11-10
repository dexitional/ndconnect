import { db } from "@ndc/db";
import { processOne, maintenance } from "../apps/web/src/server/queue";
import { refreshMnotifyReports } from "../apps/web/src/server/reports";
import { assertProvider } from "../apps/web/src/server/provider";
assertProvider();
let stop = false;
process.on("SIGINT", () => {
  stop = true;
});
process.on("SIGTERM", () => {
  stop = true;
});
let lastMaintenance = 0;
console.log("NDC campaign worker started.");
while (!stop) {
  try {
    if (Date.now() - lastMaintenance > 30000) {
      maintenance();
      await refreshMnotifyReports();
      lastMaintenance = Date.now();
    }
    if (!(await processOne())) await new Promise((r) => setTimeout(r, 1500));
  } catch (error) {
    console.error(
      "Worker cycle failed; queue preserved.",
      error instanceof Error ? error.message : "unknown",
    );
    await new Promise((r) => setTimeout(r, 5000));
  }
}
db.close();
