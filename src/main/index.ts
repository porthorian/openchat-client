import { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPCChannels, type DesktopCaptureSource, type OpenGraphMetadata, type RuntimeInfo } from "../shared/ipc";
import { ClientUpdateService } from "./clientUpdateService";

const isMac = process.platform === "darwin";
const appName = "OpenChat Client";
const appID = "io.openchat.client";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let appIconPath: string | null = null;
const openGraphFetchTimeoutMS = 8000;
const openGraphHtmlSliceLimit = 512_000;
const openGraphHeadSliceLimit = 256_000;

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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const normalized = normalizeWhitespace(decodeHtmlEntities(value));
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function toHttpURL(value: string, base?: URL): URL | null {
  try {
    const parsed = base ? new URL(value, base) : new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
}

function readHeadMarkup(html: string): string {
  const limited = html.slice(0, openGraphHtmlSliceLimit);
  const lower = limited.toLowerCase();
  const headStart = lower.indexOf("<head");
  if (headStart === -1) {
    return limited.slice(0, openGraphHeadSliceLimit);
  }
  const headOpenEnd = limited.indexOf(">", headStart);
  if (headOpenEnd === -1) {
    return limited.slice(headStart, headStart + openGraphHeadSliceLimit);
  }
  const headClose = lower.indexOf("</head>", headOpenEnd + 1);
  if (headClose === -1) {
    return limited.slice(headOpenEnd + 1, headOpenEnd + 1 + openGraphHeadSliceLimit);
  }
  return limited.slice(headOpenEnd + 1, headClose);
}

function parseTagAttributes(tagMarkup: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(tagMarkup)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes[name] = value;
  }
  return attributes;
}

function readMetaMap(headMarkup: string): Record<string, string> {
  const values: Record<string, string> = {};
  const metaPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaPattern.exec(headMarkup)) !== null) {
    const attributes = parseTagAttributes(match[0]);
    const key = (attributes.property ?? attributes.name ?? "").trim().toLowerCase();
    if (!key) continue;
    const content = (attributes.content ?? "").trim();
    if (!content) continue;
    if (!values[key]) {
      values[key] = content;
    }
  }
  return values;
}

function readTitleTag(headMarkup: string): string | null {
  const titleMatch = headMarkup.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return null;
  return titleMatch[1];
}

function readFirstMetaValue(metaMap: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metaMap[key];
    if (!value) continue;
    return value;
  }
  return null;
}

function parseOpenGraphMetadata(html: string, resolvedURL: URL): OpenGraphMetadata | null {
  const headMarkup = readHeadMarkup(html);
  const metaMap = readMetaMap(headMarkup);

  const canonicalURL = toHttpURL(readFirstMetaValue(metaMap, ["og:url"]) ?? "", resolvedURL) ?? resolvedURL;
  const title = sanitizeText(readFirstMetaValue(metaMap, ["og:title", "twitter:title"]) ?? readTitleTag(headMarkup), 220);
  const description = sanitizeText(
    readFirstMetaValue(metaMap, ["og:description", "twitter:description", "description"]),
    420
  );
  const siteName = sanitizeText(readFirstMetaValue(metaMap, ["og:site_name", "application-name"]), 120);
  const imageCandidate = readFirstMetaValue(metaMap, ["og:image", "twitter:image", "twitter:image:src"]);
  const imageURL = imageCandidate ? toHttpURL(imageCandidate, canonicalURL)?.toString() ?? null : null;

  if (!title && !description && !siteName && !imageURL) {
    return null;
  }

  return {
    url: canonicalURL.toString(),
    title,
    description,
    siteName,
    imageUrl: imageURL
  };
}

async function scrapeOpenGraph(urlInput: string): Promise<OpenGraphMetadata | null> {
  const targetURL = toHttpURL(urlInput);
  if (!targetURL) return null;

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, openGraphFetchTimeoutMS);

  try {
    const response = await fetch(targetURL.toString(), {
      redirect: "follow",
      signal: abortController.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
      }
    });
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return null;
    }

    const html = await response.text();
    const resolvedURL = toHttpURL(response.url, targetURL) ?? targetURL;
    return parseOpenGraphMetadata(html, resolvedURL);
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
  ipcMain.handle(IPCChannels.RTCListDesktopSources, async (): Promise<DesktopCaptureSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: {
        width: 480,
        height: 270
      },
      fetchWindowIcons: true
    });
    return sources.map((source) => {
      const isWindowSource = source.id.startsWith("window:");
      return {
        id: source.id,
        name: source.name,
        kind: isWindowSource ? "window" : "screen",
        displayId: source.display_id || null,
        thumbnailDataUrl: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
        appIconDataUrl: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null
      };
    });
  });
  ipcMain.handle(IPCChannels.MetadataScrapeOpenGraph, (_event, url: string): Promise<OpenGraphMetadata | null> => {
    return scrapeOpenGraph(url);
  });
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
