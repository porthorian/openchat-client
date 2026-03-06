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
    const normalized: ServerProfile[] = [];
    rawServers.forEach((entry) => {
      if (typeof entry !== "object" || entry === null) return;
      const candidate = entry as Partial<ServerProfile>;
      if (
        typeof candidate.serverId !== "string" ||
        typeof candidate.displayName !== "string" ||
        typeof candidate.backendUrl !== "string" ||
        typeof candidate.iconText !== "string" ||
        (candidate.trustState !== "verified" && candidate.trustState !== "unverified") ||
        (candidate.identityHandshakeStrategy !== "challenge_signature" && candidate.identityHandshakeStrategy !== "token_proof") ||
        (candidate.userIdentifierPolicy !== "server_scoped" &&
          candidate.userIdentifierPolicy !== "global" &&
          candidate.userIdentifierPolicy !== "either")
      ) {
        return;
      }
      normalized.push({
        ...candidate,
        serverId: candidate.serverId,
        displayName: candidate.displayName,
        description: typeof candidate.description === "string" ? candidate.description : "",
        bannerPreset: typeof candidate.bannerPreset === "string" ? candidate.bannerPreset : "",
        backendUrl: candidate.backendUrl,
        iconText: candidate.iconText,
        trustState: candidate.trustState,
        identityHandshakeStrategy: candidate.identityHandshakeStrategy,
        userIdentifierPolicy: candidate.userIdentifierPolicy
      });
    });
    return normalized;
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
    async hydrateFromBackend(
      backendUrl = DEFAULT_BACKEND_URL,
      auth?: { userUID: string; deviceID: string }
    ): Promise<void> {
      const servers = await fetchServerDirectory(backendUrl, auth);
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
    patchServerProfile(
      serverId: string,
      patch: Partial<Pick<ServerProfile, "displayName" | "description" | "bannerPreset" | "iconText">>
    ): boolean {
      const target = this.servers.find((server) => server.serverId === serverId);
      if (!target) return false;
      if (typeof patch.displayName === "string") target.displayName = patch.displayName;
      if (typeof patch.description === "string") target.description = patch.description;
      if (typeof patch.bannerPreset === "string") target.bannerPreset = patch.bannerPreset;
      if (typeof patch.iconText === "string" && patch.iconText.trim()) target.iconText = patch.iconText;
      this.persistToStorage();
      return true;
    },
    removeServer(serverId: string): boolean {
      const initialLength = this.servers.length;
      this.servers = this.servers.filter((item) => item.serverId !== serverId);
      const removed = this.servers.length < initialLength;
      if (removed) {
        this.persistToStorage();
      }
      return removed;
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
