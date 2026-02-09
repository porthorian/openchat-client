/// <reference types="vite/client" />

import type { RuntimeInfo } from "@shared/ipc";

declare global {
  interface Window {
    openchat: {
      getAppVersion: () => Promise<string>;
      getRuntimeInfo: () => Promise<RuntimeInfo>;
    };
  }
}

export {};
