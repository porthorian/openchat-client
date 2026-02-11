import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPCChannels, type RuntimeInfo } from "../shared/ipc";

const isMac = process.platform === "darwin";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, "../preload/index.cjs"),
    path.join(__dirname, "../preload/index.js"),
    path.join(__dirname, "../preload/index.mjs"),
    path.join(process.cwd(), "out/preload/index.cjs"),
    path.join(process.cwd(), "out/preload/index.js"),
    path.join(process.cwd(), "out/preload/index.mjs")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to the most likely development artifact and log for diagnosis.
  // This keeps app boot deterministic while still surfacing path issues.
  const fallback = candidates[0];
  console.error("[openchat/main] preload script not found", {
    cwd: process.cwd(),
    dirname: __dirname,
    candidates
  });
  return fallback;
}

function createMainWindow(): BrowserWindow {
  const preloadPath = resolvePreloadPath();
  console.info("[openchat/main] using preload", preloadPath);

  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#10141c",
    title: "OpenChat Client",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, navigationURL) => {
    const devURL = process.env.ELECTRON_RENDERER_URL;
    const isAllowedDevNavigation = Boolean(devURL && navigationURL.startsWith(devURL));
    const isAllowedFileNavigation = navigationURL.startsWith("file://");

    if (!isAllowedDevNavigation && !isAllowedFileNavigation) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function registerIPCHandlers(): void {
  ipcMain.handle(IPCChannels.AppVersion, () => app.getVersion());
  ipcMain.handle(IPCChannels.RuntimeInfo, (): RuntimeInfo => {
    return {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron
    };
  });
}

app.whenReady().then(() => {
  registerIPCHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});
