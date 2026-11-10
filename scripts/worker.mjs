// An explicit ESM entry prevents process managers from auto-selecting Bun for
// .ts files or requiring the worker's top-level await through a CommonJS wrapper.
await import("./worker.ts");
