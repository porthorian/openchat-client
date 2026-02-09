export const IPCChannels = {
  AppVersion: "app:version",
  RuntimeInfo: "app:runtime-info"
} as const;

export type RuntimeInfo = {
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
};
