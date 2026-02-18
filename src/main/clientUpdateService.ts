import { app, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import type { ClientUpdateSnapshot, ProjectLinks } from "../shared/ipc";

type UpdaterInfo = {
  version?: string | null;
};

type UpdaterCheckResult = {
  updateInfo?: UpdaterInfo | null;
} | null;

type UpdaterProgressInfo = {
  percent?: number | null;
};

type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease?: boolean;
  forceDevUpdateConfig?: boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  checkForUpdates: () => Promise<UpdaterCheckResult>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

const STARTUP_CHECK_MIN_DELAY_MS = 30_000;
const STARTUP_CHECK_MAX_DELAY_MS = 60_000;
const PERIODIC_CHECK_BASE_DELAY_MS = 4 * 60 * 60 * 1000;
const PERIODIC_CHECK_JITTER_MS = 2 * 60 * 60 * 1000;

const DEV_UPDATES_ENV = "OPENCHAT_UPDATER_ALLOW_DEV";
const defaultGithubURL = "https://github.com/porthorian/openchat-client";

function resolveProjectLinks(): ProjectLinks {
  const githubUrl = process.env.OPENCHAT_PROJECT_GITHUB_URL?.trim() || defaultGithubURL;
  const issuesUrl = process.env.OPENCHAT_PROJECT_ISSUES_URL?.trim() || `${githubUrl.replace(/\/$/, "")}/issues`;
  return {
    githubUrl,
    issuesUrl
  };
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeVersion(value: string): number[] | null {
  const cleaned = value.trim().replace(/^v/i, "").split("-")[0];
  if (!cleaned) return null;
  const parts = cleaned.split(".");
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const normalized = parts.slice(0, 3).map((part) => Number(part));
  while (normalized.length < 3) {
    normalized.push(0);
  }
  return normalized;
}

function isNewerVersion(candidateVersion: string, currentVersion: string): boolean {
  const candidate = normalizeVersion(candidateVersion);
  const current = normalizeVersion(currentVersion);

  if (candidate && current) {
    for (let index = 0; index < 3; index += 1) {
      if (candidate[index] > current[index]) return true;
      if (candidate[index] < current[index]) return false;
    }
    return false;
  }

  // For non-semver local builds, avoid false positives.
  if (!current) return false;
  return candidateVersion.trim() !== currentVersion.trim();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown update error.";
}

function toReleaseNotesURL(githubUrl: string, version: string): string {
  const normalizedTag = version.startsWith("v") ? version : `v${version}`;
  return `${githubUrl.replace(/\/$/, "")}/releases/tag/${encodeURIComponent(normalizedTag)}`;
}

type UpdateServiceDependencies = {
  emitStatus: (snapshot: ClientUpdateSnapshot) => void;
};

export class ClientUpdateService {
  private readonly emitStatus: UpdateServiceDependencies["emitStatus"];

  private readonly projectLinks: ProjectLinks;

  private state: ClientUpdateSnapshot;

  private periodicTimer: NodeJS.Timeout | null = null;

  private startupTimer: NodeJS.Timeout | null = null;

  private activeCheck: Promise<ClientUpdateSnapshot> | null = null;

  private activeDownload: Promise<ClientUpdateSnapshot> | null = null;

  private activeWindow: BrowserWindow | null = null;

  private updater: UpdaterLike | null = null;

  private updaterConfigured = false;

  private updaterUnavailableReason: string | null = null;

  constructor({ emitStatus }: UpdateServiceDependencies) {
    this.emitStatus = emitStatus;
    this.projectLinks = resolveProjectLinks();
    this.state = {
      status: "idle",
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseNotesUrl: null,
      downloadUrl: null,
      progressPercent: null,
      lastCheckedAt: null,
      errorMessage: null,
      updaterAvailable: true,
      updaterUnavailableReason: null
    };
  }

  attachWindow(window: BrowserWindow): void {
    this.activeWindow = window;
    this.syncWindowProgress();
  }

  getProjectLinks(): ProjectLinks {
    return { ...this.projectLinks };
  }

  getStatus(): ClientUpdateSnapshot {
    return { ...this.state };
  }

  start(): void {
    if (!this.ensureUpdater()) {
      this.updateState({
        status: "idle",
        latestVersion: null,
        releaseNotesUrl: null,
        downloadUrl: null,
        progressPercent: null,
        errorMessage: null,
        updaterAvailable: false,
        updaterUnavailableReason: this.updaterUnavailableReason ?? "Automatic updater is unavailable."
      });
      if (this.updaterUnavailableReason) {
        console.warn("[openchat/main] updater unavailable", this.updaterUnavailableReason);
      }
      return;
    }

    this.updateState({
      updaterAvailable: true,
      updaterUnavailableReason: null
    });
    this.scheduleStartupCheck();
    this.scheduleNextPeriodicCheck();
  }

  stop(): void {
    if (this.periodicTimer) {
      clearTimeout(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.activeWindow && !this.activeWindow.isDestroyed()) {
      this.activeWindow.setProgressBar(-1);
    }
    this.activeWindow = null;
  }

  async checkForUpdates(): Promise<ClientUpdateSnapshot> {
    if (this.state.status === "downloading") {
      return this.getStatus();
    }
    if (this.activeCheck) {
      return this.activeCheck;
    }

    this.activeCheck = this.performCheck().finally(() => {
      this.activeCheck = null;
    });
    return this.activeCheck;
  }

  async downloadUpdate(): Promise<ClientUpdateSnapshot> {
    if (this.activeDownload) {
      return this.activeDownload;
    }
    if (this.state.status !== "available") {
      return this.getStatus();
    }

    this.activeDownload = this.performDownload().finally(() => {
      this.activeDownload = null;
    });
    return this.activeDownload;
  }

  async quitAndInstall(): Promise<ClientUpdateSnapshot> {
    if (this.state.status !== "downloaded") {
      return this.getStatus();
    }
    if (!this.ensureUpdater() || !this.updater) {
      this.updateState({
        status: "error",
        errorMessage: this.updaterUnavailableReason ?? "Automatic updater is unavailable.",
        updaterAvailable: false,
        updaterUnavailableReason: this.updaterUnavailableReason ?? "Automatic updater is unavailable."
      });
      return this.getStatus();
    }

    try {
      if (process.platform === "win32") {
        this.updater.quitAndInstall(true, true);
      } else {
        this.updater.quitAndInstall();
      }
    } catch (error) {
      this.updateState({
        status: "error",
        errorMessage: `Failed to install update: ${toErrorMessage(error)}`,
        updaterAvailable: true,
        updaterUnavailableReason: null
      });
    }

    return this.getStatus();
  }

  private ensureUpdater(): boolean {
    if (this.updaterConfigured) {
      return this.updater !== null;
    }
    this.updaterConfigured = true;

    const allowDevUpdates = process.env[DEV_UPDATES_ENV] === "1";
    if (!app.isPackaged && !allowDevUpdates) {
      this.updaterUnavailableReason = `Automatic updates are disabled in development builds. Set ${DEV_UPDATES_ENV}=1 to override.`;
      return false;
    }

    try {
      const require = createRequire(import.meta.url);
      const moduleExports = require("electron-updater") as { autoUpdater?: UpdaterLike };
      if (!moduleExports.autoUpdater) {
        throw new Error("autoUpdater export not found.");
      }

      this.updater = moduleExports.autoUpdater;
      this.updaterUnavailableReason = null;
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = false;
      if ("allowPrerelease" in this.updater) {
        this.updater.allowPrerelease = false;
      }
      if (!app.isPackaged && allowDevUpdates && "forceDevUpdateConfig" in this.updater) {
        this.updater.forceDevUpdateConfig = true;
      }

      this.bindUpdaterEvents();
      return true;
    } catch (error) {
      this.updater = null;
      this.updaterUnavailableReason = `Failed to initialize electron-updater: ${toErrorMessage(error)}`;
      return false;
    }
  }

  private bindUpdaterEvents(): void {
    if (!this.updater) return;

    this.updater.on("download-progress", (...args: unknown[]) => {
      const progress = (args[0] ?? {}) as UpdaterProgressInfo;
      if (this.state.status !== "downloading" && this.state.status !== "available") {
        return;
      }
      const percent = typeof progress.percent === "number" ? clampProgress(progress.percent) : null;
      this.updateState({
        status: "downloading",
        progressPercent: percent,
        updaterAvailable: true,
        updaterUnavailableReason: null
      });
    });

    this.updater.on("update-downloaded", () => {
      this.updateState({
        status: "downloaded",
        progressPercent: 100,
        errorMessage: null,
        updaterAvailable: true,
        updaterUnavailableReason: null
      });
    });

    this.updater.on("error", (...args: unknown[]) => {
      const error = args[0];
      if (this.state.status !== "checking" && this.state.status !== "downloading") {
        return;
      }
      this.updateState({
        status: "error",
        progressPercent: null,
        errorMessage: `Updater error: ${toErrorMessage(error)}`,
        updaterAvailable: true,
        updaterUnavailableReason: null
      });
    });
  }

  private updateState(patch: Partial<ClientUpdateSnapshot>): void {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: app.getVersion()
    };
    this.syncWindowProgress();
    this.emitStatus(this.getStatus());
  }

  private syncWindowProgress(): void {
    if (!this.activeWindow || this.activeWindow.isDestroyed()) return;
    if (this.state.status !== "downloading") {
      this.activeWindow.setProgressBar(-1);
      return;
    }
    if (this.state.progressPercent === null) {
      // 2 shows indeterminate progress on supported platforms.
      this.activeWindow.setProgressBar(2);
      return;
    }
    this.activeWindow.setProgressBar(clampProgress(this.state.progressPercent) / 100);
  }

  private scheduleStartupCheck(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
    }
    const delayMs = randomBetween(STARTUP_CHECK_MIN_DELAY_MS, STARTUP_CHECK_MAX_DELAY_MS);
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.checkForUpdates();
    }, delayMs);
  }

  private scheduleNextPeriodicCheck(): void {
    if (this.periodicTimer) {
      clearTimeout(this.periodicTimer);
    }
    const delayMs = PERIODIC_CHECK_BASE_DELAY_MS + randomBetween(0, PERIODIC_CHECK_JITTER_MS);
    this.periodicTimer = setTimeout(() => {
      this.periodicTimer = null;
      void this.checkForUpdates().finally(() => {
        this.scheduleNextPeriodicCheck();
      });
    }, delayMs);
  }

  private async performCheck(): Promise<ClientUpdateSnapshot> {
    const checkedAt = new Date().toISOString();
    if (!this.ensureUpdater() || !this.updater) {
      const isDevDisabled = !app.isPackaged && process.env[DEV_UPDATES_ENV] !== "1";
      this.updateState({
        status: "idle",
        latestVersion: null,
        releaseNotesUrl: null,
        downloadUrl: null,
        progressPercent: null,
        lastCheckedAt: checkedAt,
        errorMessage: isDevDisabled ? null : (this.updaterUnavailableReason ?? "Automatic updater is unavailable."),
        updaterAvailable: false,
        updaterUnavailableReason: this.updaterUnavailableReason ?? "Automatic updater is unavailable."
      });
      return this.getStatus();
    }

    this.updateState({
      status: "checking",
      errorMessage: null,
      progressPercent: null,
      updaterAvailable: true,
      updaterUnavailableReason: null
    });

    try {
      const result = await this.updater.checkForUpdates();
      const candidateVersion =
        typeof result?.updateInfo?.version === "string" ? result.updateInfo.version.trim() : "";

      if (!candidateVersion || !isNewerVersion(candidateVersion, app.getVersion())) {
        this.updateState({
          status: "idle",
          latestVersion: null,
          releaseNotesUrl: null,
          downloadUrl: null,
          progressPercent: null,
          lastCheckedAt: checkedAt,
          errorMessage: null,
          updaterAvailable: true,
          updaterUnavailableReason: null
        });
        return this.getStatus();
      }

      this.updateState({
        status: "available",
        latestVersion: candidateVersion,
        releaseNotesUrl: toReleaseNotesURL(this.projectLinks.githubUrl, candidateVersion),
        downloadUrl: null,
        progressPercent: null,
        lastCheckedAt: checkedAt,
        errorMessage: null,
        updaterAvailable: true,
        updaterUnavailableReason: null
      });
    } catch (error) {
      this.updateState({
        status: "error",
        latestVersion: null,
        releaseNotesUrl: null,
        downloadUrl: null,
        lastCheckedAt: checkedAt,
        progressPercent: null,
        errorMessage: `Update check failed: ${toErrorMessage(error)}`,
        updaterAvailable: true,
        updaterUnavailableReason: null
      });
    }

    return this.getStatus();
  }

  private async performDownload(): Promise<ClientUpdateSnapshot> {
    if (!this.ensureUpdater() || !this.updater) {
      this.updateState({
        status: "error",
        progressPercent: null,
        errorMessage: this.updaterUnavailableReason ?? "Automatic updater is unavailable.",
        updaterAvailable: false,
        updaterUnavailableReason: this.updaterUnavailableReason ?? "Automatic updater is unavailable."
      });
      return this.getStatus();
    }

    this.updateState({
      status: "downloading",
      progressPercent: 0,
      errorMessage: null,
      updaterAvailable: true,
      updaterUnavailableReason: null
    });

    try {
      await this.updater.downloadUpdate();
      if (this.state.status === "downloading") {
        this.updateState({
          status: "downloaded",
          progressPercent: 100,
          errorMessage: null,
          updaterAvailable: true,
          updaterUnavailableReason: null
        });
      }
    } catch (error) {
      this.updateState({
        status: "error",
        progressPercent: null,
        errorMessage: `Update download failed: ${toErrorMessage(error)}`,
        updaterAvailable: true,
        updaterUnavailableReason: null
      });
    }

    return this.getStatus();
  }
}
