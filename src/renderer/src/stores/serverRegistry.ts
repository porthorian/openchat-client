import { defineStore } from "pinia";
import { DEFAULT_BACKEND_URL, fetchServerDirectory } from "@renderer/services/serverRegistryClient";
import type { ServerCapabilities } from "@renderer/types/capabilities";
import type { ServerProfile } from "@renderer/types/models";

export const useServerRegistryStore = defineStore("server-registry", {
  state: () => ({
    servers: [] as ServerProfile[]
  }),
  getters: {
    byId: (state) => (serverId: string): ServerProfile | undefined => {
      return state.servers.find((server) => server.serverId === serverId);
    }
  },
  actions: {
    async hydrateFromBackend(backendUrl = DEFAULT_BACKEND_URL): Promise<void> {
      const servers = await fetchServerDirectory(backendUrl);
      this.servers = servers;
    },
    addServer(profile: ServerProfile): boolean {
      const exists = this.servers.some((item) => item.serverId === profile.serverId);
      if (!exists) {
        this.servers.push(profile);
        return true;
      }
      return false;
    },
    setCapabilities(serverId: string, capabilities: ServerCapabilities): void {
      const target = this.servers.find((item) => item.serverId === serverId);
      if (!target) return;
      target.capabilities = capabilities;
      target.capabilitiesFetchedAt = new Date().toISOString();
    }
  }
});
