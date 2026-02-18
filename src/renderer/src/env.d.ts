/// <reference types="vite/client" />

import type { ClientUpdateSnapshot, ProjectLinks, RuntimeInfo } from "@shared/ipc";

declare global {
  interface Window {
    openchat: {
      getAppVersion: () => Promise<string>;
      getRuntimeInfo: () => Promise<RuntimeInfo>;
      getProjectLinks: () => Promise<ProjectLinks>;
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
