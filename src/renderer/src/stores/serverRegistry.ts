import { defineStore } from "pinia";
import type { ServerProfile } from "@renderer/types/models";

const seedServers: ServerProfile[] = [
  {
    serverId: "srv_harbor",
    displayName: "Harbor Guild",
    backendUrl: "https://harbor.example.net",
    iconText: "HG",
    trustState: "verified",
    identityHandshakeStrategy: "challenge_signature",
    userIdentifierPolicy: "server_scoped"
  },
  {
    serverId: "srv_arcade",
    displayName: "Arcade Workshop",
    backendUrl: "https://arcade.example.net",
    iconText: "AW",
    trustState: "unverified",
    identityHandshakeStrategy: "token_proof",
    userIdentifierPolicy: "either"
  }
];

export const useServerRegistryStore = defineStore("server-registry", {
  state: () => ({
    servers: seedServers
  }),
  getters: {
    byId: (state) => (serverId: string): ServerProfile | undefined => {
      return state.servers.find((server) => server.serverId === serverId);
    }
  },
  actions: {
    addServer(profile: ServerProfile): void {
      const exists = this.servers.some((item) => item.serverId === profile.serverId);
      if (!exists) {
        this.servers.push(profile);
      }
    }
  }
});
