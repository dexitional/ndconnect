module.exports = {
  apps: [
    {
      name: "ndc-web",
      cwd: __dirname,
      script: "scripts/start.mjs",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", PORT: "3100" },
      max_memory_restart: "750M",
      kill_timeout: 35000,
    },
    {
      name: "ndc-worker",
      cwd: __dirname,
      script: "scripts/worker.ts",
      node_args: "--import tsx",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      kill_timeout: 35000,
    },
  ],
};
