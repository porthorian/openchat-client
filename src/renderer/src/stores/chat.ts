import { defineStore } from "pinia";
import {
  createMessage,
  fetchChannelGroups,
  fetchMembers,
  fetchMessages,
  getRealtimeURL,
  sendRealtime,
  type RealtimeEnvelope
} from "@renderer/services/chatClient";
import type { Channel, ChannelGroup, ChannelPresenceMember, ChatMessage, MemberItem } from "@renderer/types/chat";

type ServerRealtimeState = {
  connected: boolean;
  errorMessage: string | null;
};

type ChatStoreState = {
  groupsByServer: Record<string, ChannelGroup[]>;
  membersByServer: Record<string, MemberItem[]>;
  presenceByChannel: Record<string, ChannelPresenceMember[]>;
  messagesByChannel: Record<string, ChatMessage[]>;
  loadingByServer: Record<string, boolean>;
  loadingMessagesByChannel: Record<string, boolean>;
  sendingByChannel: Record<string, boolean>;
  realtimeByServer: Record<string, ServerRealtimeState>;
  subscribedChannelByServer: Record<string, string | null>;
};

const socketsByServer = new Map<string, WebSocket>();
const intentionallyClosedSockets = new Set<string>();

function parseEnvelope(rawMessage: string): RealtimeEnvelope | null {
  try {
    return JSON.parse(rawMessage) as RealtimeEnvelope;
  } catch (_error) {
    return null;
  }
}

function hasMessage(messages: ChatMessage[], messageID: string): boolean {
  return messages.some((item) => item.id === messageID);
}

function normalizeIncomingMessage(payload: Record<string, unknown>): ChatMessage | null {
  const messagePayload = payload.message as Record<string, unknown> | undefined;
  if (!messagePayload) return null;
  const id = String(messagePayload.id ?? "");
  const channelID = String(messagePayload.channel_id ?? "");
  if (!id || !channelID) return null;
  return {
    id,
    channelId: channelID,
    authorUID: String(messagePayload.author_uid ?? "uid_unknown"),
    body: String(messagePayload.body ?? ""),
    createdAt: String(messagePayload.created_at ?? new Date().toISOString())
  };
}

function normalizePresenceMember(input: unknown): ChannelPresenceMember | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const userUID = String(payload.user_uid ?? "").trim();
  if (!userUID) return null;
  return {
    clientId: String(payload.client_id ?? "").trim(),
    userUID,
    deviceID: String(payload.device_id ?? "").trim()
  };
}

function presenceMemberKey(member: ChannelPresenceMember): string {
  if (member.clientId) return `client:${member.clientId}`;
  const userUID = member.userUID || "uid_unknown";
  const deviceID = member.deviceID || "device_unknown";
  return `user:${userUID}|device:${deviceID}`;
}

function firstTextChannel(groups: ChannelGroup[]): Channel | null {
  for (const group of groups) {
    for (const channel of group.channels) {
      if (channel.type === "text") {
        return channel;
      }
    }
  }
  return null;
}

export const useChatStore = defineStore("chat", {
  state: (): ChatStoreState => ({
    groupsByServer: {},
    membersByServer: {},
    presenceByChannel: {},
    messagesByChannel: {},
    loadingByServer: {},
    loadingMessagesByChannel: {},
    sendingByChannel: {},
    realtimeByServer: {},
    subscribedChannelByServer: {}
  }),
  getters: {
    groupsFor:
      (state) =>
      (serverId: string): ChannelGroup[] => {
        return state.groupsByServer[serverId] ?? [];
      },
    membersFor:
      (state) =>
      (serverId: string): MemberItem[] => {
        return state.membersByServer[serverId] ?? [];
      },
    channelPresenceFor:
      (state) =>
      (channelId: string): ChannelPresenceMember[] => {
        return state.presenceByChannel[channelId] ?? [];
      },
    messagesFor:
      (state) =>
      (channelId: string): ChatMessage[] => {
        return state.messagesByChannel[channelId] ?? [];
      },
    isServerLoading:
      (state) =>
      (serverId: string): boolean => {
        return state.loadingByServer[serverId] ?? false;
      },
    isMessagesLoading:
      (state) =>
      (channelId: string): boolean => {
        return state.loadingMessagesByChannel[channelId] ?? false;
      },
    isSendingInChannel:
      (state) =>
      (channelId: string): boolean => {
        return state.sendingByChannel[channelId] ?? false;
      },
    subscribedChannelFor:
      (state) =>
      (serverId: string): string | null => {
        return state.subscribedChannelByServer[serverId] ?? null;
      }
  },
  actions: {
    async loadServerData(params: {
      serverId: string;
      backendUrl: string;
      userUID: string;
      deviceID: string;
    }): Promise<string | null> {
      this.loadingByServer[params.serverId] = true;
      this.ensureRealtimeState(params.serverId);
      try {
        const [groups, members] = await Promise.all([
          fetchChannelGroups(params.backendUrl, params.serverId),
          fetchMembers(params.backendUrl, params.serverId)
        ]);
        this.groupsByServer[params.serverId] = groups;
        this.membersByServer[params.serverId] = members;
        await this.connectRealtime(params);
        return firstTextChannel(groups)?.id ?? null;
      } finally {
        this.loadingByServer[params.serverId] = false;
      }
    },
    async loadMessages(params: { backendUrl: string; channelId: string }): Promise<void> {
      if (!params.channelId) return;
      this.loadingMessagesByChannel[params.channelId] = true;
      try {
        const messages = await fetchMessages(params.backendUrl, params.channelId, 150);
        this.messagesByChannel[params.channelId] = messages;
      } finally {
        this.loadingMessagesByChannel[params.channelId] = false;
      }
    },
    async sendMessage(params: {
      backendUrl: string;
      channelId: string;
      body: string;
      userUID: string;
      deviceID: string;
    }): Promise<void> {
      this.sendingByChannel[params.channelId] = true;
      try {
        const message = await createMessage(params);
        const existing = this.messagesByChannel[message.channelId] ?? [];
        if (!hasMessage(existing, message.id)) {
          this.messagesByChannel[message.channelId] = [...existing, message];
        }
      } finally {
        this.sendingByChannel[params.channelId] = false;
      }
    },
    async connectRealtime(params: {
      serverId: string;
      backendUrl: string;
      userUID: string;
      deviceID: string;
    }): Promise<void> {
      const existingSocket = socketsByServer.get(params.serverId);
      if (existingSocket && (existingSocket.readyState === WebSocket.OPEN || existingSocket.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const url = getRealtimeURL(params.backendUrl, params.userUID, params.deviceID);
      const socket = new WebSocket(url);
      socketsByServer.set(params.serverId, socket);
      intentionallyClosedSockets.delete(params.serverId);

      socket.addEventListener("open", () => {
        this.ensureRealtimeState(params.serverId);
        this.realtimeByServer[params.serverId].connected = true;
        this.realtimeByServer[params.serverId].errorMessage = null;
        const subscribedChannel = this.subscribedChannelByServer[params.serverId];
        if (subscribedChannel) {
          sendRealtime(socket, {
            type: "chat.subscribe",
            request_id: `sub_${Date.now()}`,
            payload: { channel_id: subscribedChannel }
          });
        }
      });

      socket.addEventListener("message", (event: MessageEvent<string>) => {
        const envelope = parseEnvelope(event.data);
        if (!envelope) return;
        this.handleRealtimeEnvelope(params.serverId, envelope);
      });

      socket.addEventListener("close", () => {
        this.ensureRealtimeState(params.serverId);
        this.realtimeByServer[params.serverId].connected = false;
        if (!intentionallyClosedSockets.has(params.serverId)) {
          this.realtimeByServer[params.serverId].errorMessage = "Realtime connection closed.";
        } else {
          this.realtimeByServer[params.serverId].errorMessage = null;
          intentionallyClosedSockets.delete(params.serverId);
        }
        socketsByServer.delete(params.serverId);
      });

      socket.addEventListener("error", () => {
        this.ensureRealtimeState(params.serverId);
        this.realtimeByServer[params.serverId].errorMessage = "Realtime transport error.";
      });
    },
    subscribeToChannel(serverId: string, channelId: string): void {
      this.subscribedChannelByServer[serverId] = channelId;
      this.presenceByChannel[channelId] = [];
      const socket = socketsByServer.get(serverId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendRealtime(socket, {
        type: "chat.subscribe",
        request_id: `sub_${Date.now()}`,
        payload: { channel_id: channelId }
      });
    },
    unsubscribeFromChannel(serverId: string, channelId: string): void {
      const activeSubscribed = this.subscribedChannelByServer[serverId];
      if (activeSubscribed === channelId) {
        this.subscribedChannelByServer[serverId] = null;
      }
      this.presenceByChannel[channelId] = [];
      const socket = socketsByServer.get(serverId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendRealtime(socket, {
        type: "chat.unsubscribe",
        request_id: `unsub_${Date.now()}`,
        payload: { channel_id: channelId }
      });
    },
    handleRealtimeEnvelope(serverId: string, envelope: RealtimeEnvelope): void {
      if (envelope.type === "chat.message.created") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const message = normalizeIncomingMessage(payload);
        if (!message) return;
        const existing = this.messagesByChannel[message.channelId] ?? [];
        if (hasMessage(existing, message.id)) return;
        this.messagesByChannel[message.channelId] = [...existing, message];
        return;
      }
      if (envelope.type === "chat.presence.snapshot") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        if (!channelID) return;
        const members = Array.isArray(payload.members)
          ? payload.members
              .map((item) => normalizePresenceMember(item))
              .filter((item): item is ChannelPresenceMember => item !== null)
          : [];
        this.presenceByChannel[channelID] = members;
        return;
      }
      if (envelope.type === "chat.presence.joined") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        const member = normalizePresenceMember(payload.member);
        if (!channelID || !member) return;
        const existing = this.presenceByChannel[channelID] ?? [];
        const key = presenceMemberKey(member);
        if (existing.some((item) => presenceMemberKey(item) === key)) return;
        this.presenceByChannel[channelID] = [...existing, member];
        return;
      }
      if (envelope.type === "chat.presence.left") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        const member = normalizePresenceMember(payload.member);
        if (!channelID || !member) return;
        const existing = this.presenceByChannel[channelID] ?? [];
        const leavingKey = presenceMemberKey(member);
        this.presenceByChannel[channelID] = existing.filter((item) => presenceMemberKey(item) !== leavingKey);
        return;
      }
      if (envelope.type === "chat.error") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        this.ensureRealtimeState(serverId);
        this.realtimeByServer[serverId].errorMessage = String(payload.message ?? "Realtime error");
      }
    },
    disconnectServerRealtime(serverId: string): void {
      const socket = socketsByServer.get(serverId);
      if (!socket) return;
      intentionallyClosedSockets.add(serverId);
      socket.close();
      socketsByServer.delete(serverId);
      this.clearPresenceForServer(serverId);
    },
    disconnectAllRealtime(): void {
      [...socketsByServer.keys()].forEach((serverId) => {
        this.disconnectServerRealtime(serverId);
      });
      this.presenceByChannel = {};
    },
    ensureRealtimeState(serverId: string): void {
      if (!this.realtimeByServer[serverId]) {
        this.realtimeByServer[serverId] = {
          connected: false,
          errorMessage: null
        };
      }
    },
    clearPresenceForServer(serverId: string): void {
      const groups = this.groupsByServer[serverId] ?? [];
      groups.forEach((group) => {
        group.channels.forEach((channel) => {
          delete this.presenceByChannel[channel.id];
        });
      });
    }
  }
});
