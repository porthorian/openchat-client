import type { ServerCapabilities, ServerCapabilitiesResponse } from "@renderer/types/capabilities";
import { normalizeServerCapabilities } from "@renderer/types/capabilities";

export type JoinTicketResponse = {
  ticket: string;
  channel_id: string;
  server_id: string;
  user_uid: string;
  device_id: string;
  expires_at: string;
  signaling_url: string;
  ice_servers: Array<{
    urls: string[];
    username?: string;
    credential?: string;
    credential_type?: "none" | "static" | "ephemeral";
    expires_at?: string;
  }>;
  permissions: {
    speak: boolean;
    video: boolean;
    screenshare: boolean;
  };
};

export type SignalEnvelope = {
  type: string;
  request_id?: string;
  channel_id?: string;
  payload?: Record<string, unknown>;
};

export async function fetchServerCapabilities(backendUrl: string): Promise<ServerCapabilities> {
  const base = backendUrl.replace(/\/$/, "");
  const candidates = [`${base}/v1/client/capabilities`, `${base}/client/capabilities`];

  let lastError: Error | null = null;
  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Capability probe failed (${response.status})`);
      }
      const payload = (await response.json()) as ServerCapabilitiesResponse;
      return normalizeServerCapabilities(payload);
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError ?? new Error("Failed to fetch capabilities");
}

export async function requestJoinTicket(params: {
  backendUrl: string;
  channelId: string;
  userUID: string;
  deviceID: string;
  serverID: string;
}): Promise<JoinTicketResponse> {
  const base = params.backendUrl.replace(/\/$/, "");
  const endpoint = `${base}/v1/rtc/channels/${encodeURIComponent(params.channelId)}/join-ticket`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenChat-User-UID": params.userUID,
      "X-OpenChat-Device-ID": params.deviceID
    },
    body: JSON.stringify({
      server_id: params.serverID
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Join ticket request failed (${response.status}): ${text}`);
  }
  return (await response.json()) as JoinTicketResponse;
}

export function sendSignal(socket: WebSocket, envelope: SignalEnvelope): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(envelope));
}
