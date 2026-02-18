import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPCChannels, type RuntimeInfo } from "../shared/ipc";
import { ClientUpdateService } from "./clientUpdateService";

const isMac = process.platform === "darwin";
const appName = "OpenChat Client";
const appID = "io.openchat.client";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let appIconPath: string | null = null;

app.setName(appName);
if (process.platform === "win32") {
  app.setAppUserModelId(appID);
}

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

function resolveAppIconPath(): string | null {
  const candidates = [
    path.join(process.cwd(), "logo.png"),
    path.join(app.getAppPath(), "logo.png"),
    path.join(__dirname, "../../logo.png"),
    path.join(__dirname, "../../../logo.png"),
    path.join(process.resourcesPath, "logo.png")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  console.warn("[openchat/main] app icon not found", {
    cwd: process.cwd(),
    appPath: app.getAppPath(),
    dirname: __dirname,
    candidates
  });
  return null;
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
    title: appName,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    icon: appIconPath ?? undefined,
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

function registerIPCHandlers(updateService: ClientUpdateService): void {
  ipcMain.handle(IPCChannels.AppVersion, () => app.getVersion());
  ipcMain.handle(IPCChannels.RuntimeInfo, (): RuntimeInfo => {
    return {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron
    };
  });
  ipcMain.handle(IPCChannels.ProjectLinks, () => updateService.getProjectLinks());
  ipcMain.handle(IPCChannels.UpdateGetStatus, () => updateService.getStatus());
  ipcMain.handle(IPCChannels.UpdateCheckForUpdates, () => updateService.checkForUpdates());
  ipcMain.handle(IPCChannels.UpdateDownload, () => updateService.downloadUpdate());
  ipcMain.handle(IPCChannels.UpdateQuitAndInstall, () => updateService.quitAndInstall());
}

app.whenReady().then(() => {
  appIconPath = resolveAppIconPath();
  if (isMac && appIconPath) {
    const icon = nativeImage.createFromPath(appIconPath);
    if (!icon.isEmpty()) {
      app.dock?.setIcon(icon);
    }
  }

  const updateService = new ClientUpdateService({
    emitStatus: (snapshot) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPCChannels.UpdateStatusChanged, snapshot);
        }
      });
    }
  });

  registerIPCHandlers(updateService);
  const mainWindow = createMainWindow();
  updateService.attachWindow(mainWindow);
  updateService.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = createMainWindow();
      updateService.attachWindow(window);
    }
  });

  app.on("before-quit", () => {
    updateService.stop();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});
