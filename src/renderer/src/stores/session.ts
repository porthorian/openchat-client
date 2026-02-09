import { defineStore } from "pinia";
import type { SessionStatus } from "@renderer/types/models";

type ServerSession = {
  status: SessionStatus;
  userUID: string;
  lastBoundAt: string | null;
};

type SessionState = {
  sessionsByServer: Record<string, ServerSession>;
};

const baseSession: ServerSession = {
  status: "active",
  userUID: "uid_pending",
  lastBoundAt: new Date().toISOString()
};

export const useSessionStore = defineStore("session", {
  state: (): SessionState => ({
    sessionsByServer: {
      srv_harbor: {
        ...baseSession,
        userUID: "uid_4f3a1bc2"
      },
      srv_arcade: {
        status: "connecting",
        userUID: "uid_pending",
        lastBoundAt: null
      }
    }
  }),
  actions: {
    setSession(serverId: string, payload: ServerSession): void {
      this.sessionsByServer[serverId] = payload;
    },
    setStatus(serverId: string, status: SessionStatus): void {
      const existing = this.sessionsByServer[serverId] ?? {
        ...baseSession
      };
      this.sessionsByServer[serverId] = {
        ...existing,
        status
      };
    }
  }
});
