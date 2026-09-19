import type { ServerCapabilities, ServerCapabilitiesResponse } from "@renderer/types/capabilities";
import { normalizeServerCapabilities } from "@renderer/types/capabilities";
import { tokenForUIDAndBackend } from "./verifiedSessionClient";

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
  subscribe_receive_policy?: {
    max_video_tracks: number;
    max_audio_tracks: number;
  };
};

export type SignalEnvelope = {
  type: string;
  request_id?: string;
  channel_id?: string;
  payload?: Record<string, unknown>;
};

export class RTCRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RTCRequestError";
  }
}

export async function fetchServerCapabilities(backendUrl: string, signal?: AbortSignal): Promise<ServerCapabilities> {
  const base = backendUrl.replace(/\/$/, "");
  const candidates = [`${base}/v1/client/capabilities`, `${base}/client/capabilities`];

  let lastError: Error | null = null;
  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, { signal });
      if (!response.ok) {
        throw new RTCRequestError(`Capability probe failed (${response.status})`, response.status);
      }
      const payload = (await response.json()) as ServerCapabilitiesResponse;
      return normalizeServerCapabilities(payload);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof RTCRequestError && error.status !== 404 && error.status !== 405) throw error;
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
  signal?: AbortSignal;
}): Promise<JoinTicketResponse> {
  const base = params.backendUrl.replace(/\/$/, "");
  const endpoint = `${base}/v1/rtc/channels/${encodeURIComponent(params.channelId)}/join-ticket`;
  const token = tokenForUIDAndBackend(params.userUID, params.backendUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    signal: params.signal,
    headers: {
      "Content-Type": "application/json",
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : { "X-OpenChat-User-UID": params.userUID, "X-OpenChat-Device-ID": params.deviceID })
    },
    body: JSON.stringify({
      server_id: params.serverID
    })
  });
  if (!response.ok) {
    throw new RTCRequestError(`Join ticket request failed (${response.status})`, response.status);
  }
  return (await response.json()) as JoinTicketResponse;
}

export function sendSignal(socket: WebSocket, envelope: SignalEnvelope): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(envelope));
}
