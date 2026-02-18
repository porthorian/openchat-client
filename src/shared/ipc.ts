export const IPCChannels = {
  AppVersion: "app:version",
  RuntimeInfo: "app:runtime-info",
  ProjectLinks: "app:project-links",
  MetadataScrapeOpenGraph: "metadata:scrape-open-graph",
  RTCListDesktopSources: "rtc:list-desktop-sources",
  UpdateGetStatus: "app:update:get-status",
  UpdateCheckForUpdates: "app:update:check-for-updates",
  UpdateDownload: "app:update:download",
  UpdateQuitAndInstall: "app:update:quit-and-install",
  UpdateStatusChanged: "app:update:status-changed"
} as const;

export type DesktopCaptureSourceKind = "screen" | "window";

export type DesktopCaptureSource = {
  id: string;
  name: string;
  kind: DesktopCaptureSourceKind;
  displayId: string | null;
  thumbnailDataUrl: string | null;
  appIconDataUrl: string | null;
};

export type RuntimeInfo = {
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
};

export type ProjectLinks = {
  githubUrl: string;
  issuesUrl: string;
};

export type OpenGraphMetadata = {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
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
