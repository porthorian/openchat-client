import path from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "chunks/[name]-[hash].cjs"
        }
      }
    }
  },
  renderer: {
    plugins: [vue()],
    resolve: {
      alias: {
        "@renderer": path.resolve("src/renderer/src"),
        "@shared": path.resolve("src/shared")
      }
    }
  }
});
