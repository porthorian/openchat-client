import type { ServerProfile } from "@renderer/types/models";

export const DEFAULT_BACKEND_URL = (import.meta.env.VITE_OPENCHAT_BACKEND_URL as string | undefined)?.trim() || "https://openchat.marone.us";

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
    icon_text: string;
    trust_state: "verified" | "unverified";
    identity_handshake_strategy: "challenge_signature" | "token_proof";
    user_identifier_policy: "server_scoped" | "global" | "either";
  }>;
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
