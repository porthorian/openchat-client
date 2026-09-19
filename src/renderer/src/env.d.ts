/// <reference types="vite/client" />

import type { ClientUpdateSnapshot, DesktopCaptureSource, OpenGraphMetadata, ProjectLinks, RuntimeInfo, StoredVerifiedSession } from "@shared/ipc";

interface ImportMetaEnv {
  readonly VITE_OPENCHAT_BACKEND_URL?: string;
  readonly VITE_OPENCHAT_RTC_DEBUG?: string;
}

declare global {
  interface Window {
    openchat: {
      getAppVersion: () => Promise<string>;
      getRuntimeInfo: () => Promise<RuntimeInfo>;
      getProjectLinks: () => Promise<ProjectLinks>;
      metadata: {
        scrapeOpenGraph: (url: string) => Promise<OpenGraphMetadata | null>;
      };
      rtc: {
        listDesktopCaptureSources: () => Promise<DesktopCaptureSource[]>;
      };
      identity: {
        publicKey: () => Promise<string>;
        signChallenge: (payload: string) => Promise<string>;
        storeSession: (session: StoredVerifiedSession) => Promise<void>;
        loadSession: (serverId: string) => Promise<StoredVerifiedSession | null>;
        clearSession: (serverId: string) => Promise<void>;
      };
      updates: {
        getStatus: () => Promise<ClientUpdateSnapshot>;
        checkForUpdates: () => Promise<ClientUpdateSnapshot>;
        downloadUpdate: () => Promise<ClientUpdateSnapshot>;
        quitAndInstall: () => Promise<ClientUpdateSnapshot>;
        onStatusChanged: (listener: (snapshot: ClientUpdateSnapshot) => void) => () => void;
      };
    };
  }
}

export {};
