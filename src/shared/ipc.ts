export const IPCChannels = {
  AppVersion: "app:version",
  RuntimeInfo: "app:runtime-info",
  ProjectLinks: "app:project-links",
  UpdateGetStatus: "app:update:get-status",
  UpdateCheckForUpdates: "app:update:check-for-updates",
  UpdateDownload: "app:update:download",
  UpdateQuitAndInstall: "app:update:quit-and-install",
  UpdateStatusChanged: "app:update:status-changed"
} as const;

export type RuntimeInfo = {
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
};

export type ProjectLinks = {
  githubUrl: string;
  issuesUrl: string;
};

export type ClientUpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";

export type ClientUpdateSnapshot = {
  status: ClientUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotesUrl: string | null;
  downloadUrl: string | null;
  progressPercent: number | null;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  updaterAvailable: boolean;
  updaterUnavailableReason: string | null;
};
