import path from "node:path";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@renderer": path.resolve("src/renderer/src"), "@shared": path.resolve("src/shared") } },
  test: { environment: "jsdom", include: ["tests/components/**/*.test.ts"] }
});
