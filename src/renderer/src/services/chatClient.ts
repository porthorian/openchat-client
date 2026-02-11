import type { ChannelGroup, ChatMessage, MemberItem } from "@renderer/types/chat";

export type RealtimeEnvelope = {
  type: string;
  request_id?: string;
  payload?: Record<string, unknown>;
};

export async function fetchChannelGroups(backendUrl: string, serverId: string): Promise<ChannelGroup[]> {
  const endpoint = `${backendUrl.replace(/\/$/, "")}/v1/servers/${encodeURIComponent(serverId)}/channels`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to load channels (${response.status})`);
  }
  const payload = (await response.json()) as { groups?: ChannelGroup[] };
  return payload.groups ?? [];
}

export async function fetchMembers(backendUrl: string, serverId: string): Promise<MemberItem[]> {
  const endpoint = `${backendUrl.replace(/\/$/, "")}/v1/servers/${encodeURIComponent(serverId)}/members`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to load members (${response.status})`);
  }
  const payload = (await response.json()) as { members?: MemberItem[] };
  return payload.members ?? [];
}

export async function fetchMessages(backendUrl: string, channelId: string, limit = 100): Promise<ChatMessage[]> {
  const endpoint = `${backendUrl.replace(/\/$/, "")}/v1/channels/${encodeURIComponent(channelId)}/messages?limit=${limit}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to load messages (${response.status})`);
  }
  const payload = (await response.json()) as {
    messages?: Array<{
      id: string;
      channel_id: string;
      author_uid: string;
      body: string;
      created_at: string;
    }>;
  };
  return (payload.messages ?? []).map((message) => ({
    id: message.id,
    channelId: message.channel_id,
    authorUID: message.author_uid,
    body: message.body,
    createdAt: message.created_at
  }));
}

export async function createMessage(params: {
  backendUrl: string;
  channelId: string;
  body: string;
  userUID: string;
  deviceID: string;
}): Promise<ChatMessage> {
  const endpoint = `${params.backendUrl.replace(/\/$/, "")}/v1/channels/${encodeURIComponent(params.channelId)}/messages`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenChat-User-UID": params.userUID,
      "X-OpenChat-Device-ID": params.deviceID
    },
    body: JSON.stringify({
      body: params.body
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send message (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as {
    message: {
      id: string;
      channel_id: string;
      author_uid: string;
      body: string;
      created_at: string;
    };
  };
  return {
    id: payload.message.id,
    channelId: payload.message.channel_id,
    authorUID: payload.message.author_uid,
    body: payload.message.body,
    createdAt: payload.message.created_at
  };
}

export function getRealtimeURL(backendUrl: string, userUID: string, deviceID: string): string {
  const base = new URL(backendUrl);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/v1/realtime";
  base.search = "";
  base.searchParams.set("user_uid", userUID);
  base.searchParams.set("device_id", deviceID);
  return base.toString();
}

export function sendRealtime(socket: WebSocket, envelope: RealtimeEnvelope): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(envelope));
}
