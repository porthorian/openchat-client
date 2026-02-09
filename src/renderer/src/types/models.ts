export type UIDMode = "server_scoped" | "global";

export type ServerProfile = {
  serverId: string;
  displayName: string;
  backendUrl: string;
  iconText: string;
  trustState: "verified" | "unverified";
  identityHandshakeStrategy: "challenge_signature" | "token_proof";
  userIdentifierPolicy: "server_scoped" | "global" | "either";
};

export type SessionStatus = "disconnected" | "connecting" | "active" | "expired";
