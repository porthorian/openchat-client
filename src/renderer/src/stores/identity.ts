import { defineStore } from "pinia";
import { projectUID } from "@renderer/utils/uid";
import type { UIDMode } from "@renderer/types/models";

function createIdentityId(): string {
  const randomSegment = Math.random().toString(36).slice(2, 10);
  return `identity_${randomSegment}`;
}

export const useIdentityStore = defineStore("identity", {
  state: () => ({
    isInitialized: false,
    rootIdentityId: "",
    uidMode: "server_scoped" as UIDMode,
    disclosureAcknowledged: true
  }),
  getters: {
    disclosureMessage(state): string {
      return state.uidMode === "server_scoped"
        ? "This server sees only a server-scoped UID and proof."
        : "This server sees only a global UID and proof.";
    }
  },
  actions: {
    initializeIdentity(): void {
      if (this.isInitialized) return;
      this.rootIdentityId = createIdentityId();
      this.isInitialized = true;
    },
    getUIDForServer(serverId: string): string {
      if (!this.isInitialized) {
        this.initializeIdentity();
      }
      return projectUID(this.rootIdentityId, serverId, this.uidMode);
    },
    setUIDMode(mode: UIDMode): void {
      this.uidMode = mode;
    }
  }
});
