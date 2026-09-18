import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/electron",
  timeout: 30_000,
  workers: 1,
  use: { trace: "retain-on-failure" }
});
