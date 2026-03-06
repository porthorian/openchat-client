import type { ServerProfile } from "@renderer/types/models";

const viteBackendURL = (
  (import.meta as { env?: { VITE_OPENCHAT_BACKEND_URL?: string } }).env?.VITE_OPENCHAT_BACKEND_URL ?? ""
).trim();

export const DEFAULT_BACKEND_URL = viteBackendURL || "https://chat.pennylabs.com";

export class ServerRegistryRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ServerRegistryRequestError";
    this.status = status;
  }
}

type ServerDirectoryResponse = {
  servers?: Array<{
    server_id: string;
    display_name: string;
    description?: string;
    banner_preset?: string;
    icon_text: string;
    trust_state: "verified" | "unverified";
    identity_handshake_strategy: "challenge_signature" | "token_proof";
    user_identifier_policy: "server_scoped" | "global" | "either";
  }>;
};

type CreatedServerResponsePayload = {
  server?: {
    server_id?: string;
    display_name?: string;
    description?: string;
    banner_preset?: string;
    icon_text?: string;
    trust_state?: "verified" | "unverified";
    identity_handshake_strategy?: "challenge_signature" | "token_proof";
    user_identifier_policy?: "server_scoped" | "global" | "either";
  };
  created_by_uid?: string;
  created_at?: string;
  ownership_claim?: {
    token?: string;
    expires_at?: string;
  };
};

type OwnershipClaimResponsePayload = {
  server_id?: string;
  owner_user_uid?: string;
  claimed_at?: string;
};

export type CreatedServerResult = {
  profile: ServerProfile;
  createdByUID: string;
  createdAt: string;
  ownershipClaimToken: string;
  ownershipClaimExpiresAt: string;
};

export type OwnershipClaimResult = {
  serverId: string;
  ownerUserUID: string;
  claimedAt: string;
};

function authHeaders(userUID: string, deviceID: string): Record<string, string> {
  return {
    "X-OpenChat-User-UID": userUID,
    "X-OpenChat-Device-ID": deviceID
  };
}

export async function fetchServerDirectory(
  backendUrl = DEFAULT_BACKEND_URL,
  auth?: { userUID: string; deviceID: string }
): Promise<ServerProfile[]> {
  const endpoint = `${backendUrl.replace(/\/$/, "")}/v1/servers`;
  const response = await fetch(
    endpoint,
    auth
      ? {
          headers: authHeaders(auth.userUID, auth.deviceID)
        }
      : undefined
  );
  if (!response.ok) {
    throw new Error(`Failed to load server directory from ${endpoint} (${response.status})`);
  }
  const payload = (await response.json()) as ServerDirectoryResponse;
  return (payload.servers ?? []).map((server) => ({
    serverId: server.server_id,
    displayName: server.display_name,
    description: typeof server.description === "string" ? server.description : "",
    bannerPreset: typeof server.banner_preset === "string" ? server.banner_preset : "",
    backendUrl,
    iconText: server.icon_text,
    trustState: server.trust_state,
    identityHandshakeStrategy: server.identity_handshake_strategy,
    userIdentifierPolicy: server.user_identifier_policy
  }));
}

export async function leaveServerMembership(params: {
  backendUrl: string;
  serverId: string;
  userUID: string;
  deviceID: string;
}): Promise<void> {
  const endpoint = `${params.backendUrl.replace(/\/$/, "")}/v1/servers/${encodeURIComponent(params.serverId)}/membership`;
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: authHeaders(params.userUID, params.deviceID)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ServerRegistryRequestError(response.status, `Failed to leave server (${response.status}): ${text || endpoint}`);
  }
}

export async function createServer(params: {
  backendUrl: string;
  displayName: string;
  description?: string;
  bannerPreset?: string;
  userUID: string;
  deviceID: string;
}): Promise<CreatedServerResult> {
  const endpoint = `${params.backendUrl.replace(/\/$/, "")}/v1/servers`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...authHeaders(params.userUID, params.deviceID),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      display_name: params.displayName,
      description: params.description ?? "",
      banner_preset: params.bannerPreset ?? "ocean"
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ServerRegistryRequestError(response.status, `Failed to create server (${response.status}): ${text || endpoint}`);
  }

  const payload = (await response.json()) as CreatedServerResponsePayload;
  const server = payload.server;
  const serverID = String(server?.server_id ?? "").trim();
  const displayName = String(server?.display_name ?? "").trim();
  if (!serverID || !displayName) {
    throw new Error("Failed to create server: backend returned an invalid server payload.");
  }
  const claimToken = String(payload.ownership_claim?.token ?? "").trim();
  const claimExpiresAt = String(payload.ownership_claim?.expires_at ?? "").trim();
  if (!claimToken || !claimExpiresAt) {
    throw new Error("Failed to create server: backend did not issue an ownership claim token.");
  }

  return {
    profile: {
      serverId: serverID,
      displayName,
      description: typeof server?.description === "string" ? server.description : "",
      bannerPreset: typeof server?.banner_preset === "string" ? server.banner_preset : "ocean",
      backendUrl: params.backendUrl,
      iconText: typeof server?.icon_text === "string" ? server.icon_text : displayName.slice(0, 2).toUpperCase(),
      trustState: server?.trust_state === "verified" ? "verified" : "unverified",
      identityHandshakeStrategy: server?.identity_handshake_strategy === "token_proof" ? "token_proof" : "challenge_signature",
      userIdentifierPolicy:
        server?.user_identifier_policy === "global" || server?.user_identifier_policy === "either"
          ? server.user_identifier_policy
          : "server_scoped"
    },
    createdByUID: String(payload.created_by_uid ?? params.userUID),
    createdAt: String(payload.created_at ?? new Date().toISOString()),
    ownershipClaimToken: claimToken,
    ownershipClaimExpiresAt: claimExpiresAt
  };
}

export async function claimServerOwnership(params: {
  backendUrl: string;
  serverId: string;
  claimToken: string;
  userUID: string;
  deviceID: string;
}): Promise<OwnershipClaimResult> {
  const endpoint = `${params.backendUrl.replace(/\/$/, "")}/v1/servers/${encodeURIComponent(params.serverId)}/ownership:claim`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...authHeaders(params.userUID, params.deviceID),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      claim_token: params.claimToken
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ServerRegistryRequestError(
      response.status,
      `Failed to claim server ownership (${response.status}): ${text || endpoint}`
    );
  }

  const payload = (await response.json()) as OwnershipClaimResponsePayload;
  const serverID = String(payload.server_id ?? params.serverId).trim();
  const ownerUID = String(payload.owner_user_uid ?? params.userUID).trim();
  const claimedAt = String(payload.claimed_at ?? new Date().toISOString()).trim();
  if (!serverID || !ownerUID || !claimedAt) {
    throw new Error("Failed to claim server ownership: backend returned an invalid payload.");
  }
  return {
    serverId: serverID,
    ownerUserUID: ownerUID,
    claimedAt
  };
}
