import type { ServerProfile } from "@renderer/types/models";

export const DEFAULT_BACKEND_URL = (import.meta.env.VITE_OPENCHAT_BACKEND_URL as string | undefined)?.trim() || "http://localhost:8080";

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

export async function fetchServerDirectory(backendUrl = DEFAULT_BACKEND_URL): Promise<ServerProfile[]> {
  const endpoint = `${backendUrl.replace(/\/$/, "")}/v1/servers`;
  const response = await fetch(endpoint);
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
