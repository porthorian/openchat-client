import type { ServerCapabilities } from "@renderer/types/capabilities";

export type UIDMode = "server_scoped" | "global";

export type ServerProfile = {
  serverId: string;
  displayName: string;
  backendUrl: string;
  iconText: string;
  trustState: "verified" | "unverified";
  identityHandshakeStrategy: "challenge_signature" | "token_proof";
  userIdentifierPolicy: "server_scoped" | "global" | "either";
  capabilities?: ServerCapabilities;
  capabilitiesFetchedAt?: string;
};

export type SessionStatus = "disconnected" | "connecting" | "active" | "expired";
