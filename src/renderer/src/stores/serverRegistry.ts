import { defineStore } from "pinia";
import { DEFAULT_BACKEND_URL, fetchServerDirectory } from "@renderer/services/serverRegistryClient";
import type { ServerCapabilities } from "@renderer/types/capabilities";
import type { ServerProfile } from "@renderer/types/models";

const SERVER_REGISTRY_STORAGE_KEY = "openchat.server-registry.v1";

type PersistedServerRegistryState = {
  servers: ServerProfile[];
};

function parseStoredServers(raw: string | null): ServerProfile[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedServerRegistryState>;
    const rawServers = Array.isArray(parsed.servers) ? parsed.servers : [];
    return rawServers.filter((entry): entry is ServerProfile => {
      return (
        typeof entry.serverId === "string" &&
        typeof entry.displayName === "string" &&
        typeof entry.backendUrl === "string" &&
        typeof entry.iconText === "string" &&
        (entry.trustState === "verified" || entry.trustState === "unverified") &&
        (entry.identityHandshakeStrategy === "challenge_signature" || entry.identityHandshakeStrategy === "token_proof") &&
        (entry.userIdentifierPolicy === "server_scoped" ||
          entry.userIdentifierPolicy === "global" ||
          entry.userIdentifierPolicy === "either")
      );
    });
  } catch (_error) {
    return [];
  }
}

function writeStoredServers(servers: ServerProfile[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SERVER_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        servers
      } satisfies PersistedServerRegistryState)
    );
  } catch (_error) {
    // Server profile persistence is best-effort for now.
  }
}

export const useServerRegistryStore = defineStore("server-registry", {
  state: () => ({
    servers: [] as ServerProfile[],
    hasHydratedFromStorage: false
  }),
  getters: {
    byId: (state) => (serverId: string): ServerProfile | undefined => {
      return state.servers.find((server) => server.serverId === serverId);
    }
  },
  actions: {
    hydrateFromStorage(): void {
      if (this.hasHydratedFromStorage) return;
      if (typeof window === "undefined") {
        this.hasHydratedFromStorage = true;
        return;
      }
      const rawStored = window.localStorage.getItem(SERVER_REGISTRY_STORAGE_KEY);
      this.servers = parseStoredServers(rawStored);
      this.hasHydratedFromStorage = true;
    },
    persistToStorage(): void {
      writeStoredServers(this.servers);
    },
    async hydrateFromBackend(backendUrl = DEFAULT_BACKEND_URL): Promise<void> {
      const servers = await fetchServerDirectory(backendUrl);
      this.servers = servers;
      this.persistToStorage();
    },
    addServer(profile: ServerProfile): boolean {
      const exists = this.servers.some((item) => item.serverId === profile.serverId);
      if (!exists) {
        this.servers.push(profile);
        this.persistToStorage();
        return true;
      }
      return false;
    },
    setCapabilities(serverId: string, capabilities: ServerCapabilities): void {
      const target = this.servers.find((item) => item.serverId === serverId);
      if (!target) return;
      target.capabilities = capabilities;
      target.capabilitiesFetchedAt = new Date().toISOString();
      this.persistToStorage();
    }
  }
});
