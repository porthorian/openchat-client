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
  reconnecting: boolean;
  reconnectAttempt: number;
  lastConnectedAt: string | null;
  errorMessage: string | null;
};

type ChatStoreState = {
  groupsByServer: Record<string, ChannelGroup[]>;
  membersByServer: Record<string, MemberItem[]>;
  presenceByChannel: Record<string, ChannelPresenceMember[]>;
  typingByChannel: Record<string, ChannelPresenceMember[]>;
  messagesByChannel: Record<string, ChatMessage[]>;
  loadingByServer: Record<string, boolean>;
  loadingMessagesByChannel: Record<string, boolean>;
  sendingByChannel: Record<string, boolean>;
  realtimeByServer: Record<string, ServerRealtimeState>;
  subscribedChannelByServer: Record<string, string | null>;
  unreadByChannel: Record<string, number>;
  currentUserUIDByServer: Record<string, string>;
};

const socketsByServer = new Map<string, WebSocket>();
const intentionallyClosedSockets = new Set<string>();
const reconnectTimersByServer = new Map<string, ReturnType<typeof setTimeout>>();
const typingTimersByMember = new Map<string, ReturnType<typeof setTimeout>>();
const realtimeConnectParamsByServer = new Map<string, { serverId: string; backendUrl: string; userUID: string; deviceID: string }>();
const reconnectBackoffMS = [1000, 2000, 5000, 10000, 15000];
const typingExpiryMS = 6000;

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

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

function messageMentionsUID(body: string, userUID: string): boolean {
  const normalizedBody = body.toLowerCase();
  const normalizedUID = userUID.trim().toLowerCase();
  if (!normalizedUID) return false;
  return normalizedBody.includes(`@${normalizedUID}`) || normalizedBody.includes(normalizedUID);
}

function clearReconnectTimer(serverId: string): void {
  const timer = reconnectTimersByServer.get(serverId);
  if (!timer) return;
  clearTimeout(timer);
  reconnectTimersByServer.delete(serverId);
}

function typingMemberTimerKey(channelId: string, member: ChannelPresenceMember): string {
  return `${channelId}|${presenceMemberKey(member)}`;
}

export const useChatStore = defineStore("chat", {
  state: (): ChatStoreState => ({
    groupsByServer: {},
    membersByServer: {},
    presenceByChannel: {},
    typingByChannel: {},
    messagesByChannel: {},
    loadingByServer: {},
    loadingMessagesByChannel: {},
    sendingByChannel: {},
    realtimeByServer: {},
    subscribedChannelByServer: {},
    unreadByChannel: {},
    currentUserUIDByServer: {}
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
    typingForChannel:
      (state) =>
      (channelId: string): ChannelPresenceMember[] => {
        return state.typingByChannel[channelId] ?? [];
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
      },
    unreadCountForChannel:
      (state) =>
      (channelId: string): number => {
        return state.unreadByChannel[channelId] ?? 0;
      },
    unreadCountForServer:
      (state) =>
      (serverId: string): number => {
        const groups = state.groupsByServer[serverId] ?? [];
        let total = 0;
        groups.forEach((group) => {
          group.channels.forEach((channel) => {
            if (channel.type !== "text") return;
            total += state.unreadByChannel[channel.id] ?? 0;
          });
        });
        return total;
      },
    realtimeStateFor:
      (state) =>
      (serverId: string): ServerRealtimeState => {
        return (
          state.realtimeByServer[serverId] ?? {
            connected: false,
            reconnecting: false,
            reconnectAttempt: 0,
            lastConnectedAt: null,
            errorMessage: null
          }
        );
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
        groups.forEach((group) => {
          group.channels.forEach((channel) => {
            if (channel.type !== "text") return;
            const currentUnread = this.unreadByChannel[channel.id] ?? 0;
            this.unreadByChannel[channel.id] = channel.unreadCount ?? currentUnread;
          });
        });
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

      this.ensureRealtimeState(params.serverId);
      clearReconnectTimer(params.serverId);
      this.currentUserUIDByServer[params.serverId] = params.userUID;
      realtimeConnectParamsByServer.set(params.serverId, params);
      const url = getRealtimeURL(params.backendUrl, params.userUID, params.deviceID);
      const socket = new WebSocket(url);
      socketsByServer.set(params.serverId, socket);
      intentionallyClosedSockets.delete(params.serverId);

      socket.addEventListener("open", () => {
        this.ensureRealtimeState(params.serverId);
        this.realtimeByServer[params.serverId].connected = true;
        this.realtimeByServer[params.serverId].reconnecting = false;
        this.realtimeByServer[params.serverId].reconnectAttempt = 0;
        this.realtimeByServer[params.serverId].lastConnectedAt = new Date().toISOString();
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
          this.scheduleRealtimeReconnect(params.serverId);
        } else {
          this.realtimeByServer[params.serverId].reconnecting = false;
          this.realtimeByServer[params.serverId].reconnectAttempt = 0;
          this.realtimeByServer[params.serverId].errorMessage = null;
          intentionallyClosedSockets.delete(params.serverId);
        }
        socketsByServer.delete(params.serverId);
      });

      socket.addEventListener("error", () => {
        this.ensureRealtimeState(params.serverId);
        this.realtimeByServer[params.serverId].errorMessage = "Realtime transport error. Waiting to reconnect.";
      });
    },
    subscribeToChannel(serverId: string, channelId: string): void {
      this.subscribedChannelByServer[serverId] = channelId;
      this.presenceByChannel[channelId] = [];
      this.clearTypingForChannel(channelId);
      this.markChannelRead(channelId);
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
      this.clearTypingForChannel(channelId);
      const socket = socketsByServer.get(serverId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendRealtime(socket, {
        type: "chat.unsubscribe",
        request_id: `unsub_${Date.now()}`,
        payload: { channel_id: channelId }
      });
    },
    sendTyping(serverId: string, channelId: string, isTyping: boolean): void {
      if (!channelId) return;
      const socket = socketsByServer.get(serverId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendRealtime(socket, {
        type: "chat.typing.update",
        request_id: `typing_${Date.now()}`,
        payload: {
          channel_id: channelId,
          is_typing: isTyping
        }
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
        const subscribedChannel = this.subscribedChannelByServer[serverId];
        const channelIsActive = subscribedChannel === message.channelId;
        const windowVisible = isDocumentVisible();
        if (!channelIsActive || !windowVisible) {
          this.incrementUnread(message.channelId);
        } else {
          this.markChannelRead(message.channelId);
        }
        void this.notifyIncomingMessage(serverId, message, channelIsActive);
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
        this.syncTypingMembersWithPresence(channelID, members);
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
        this.removeTypingMember(channelID, member);
        return;
      }
      if (envelope.type === "chat.typing.updated") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        const member = normalizePresenceMember(payload.member);
        if (!channelID || !member) return;
        const isTyping = Boolean(payload.is_typing);
        const currentUID = this.currentUserUIDByServer[serverId] ?? "";
        if (currentUID && member.userUID === currentUID) return;
        if (isTyping) {
          this.upsertTypingMember(channelID, member);
          this.scheduleTypingExpiry(channelID, member);
        } else {
          this.removeTypingMember(channelID, member);
        }
        return;
      }
      if (envelope.type === "chat.error") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        this.ensureRealtimeState(serverId);
        this.realtimeByServer[serverId].errorMessage = String(payload.message ?? "Realtime error");
      }
    },
    upsertTypingMember(channelId: string, member: ChannelPresenceMember): void {
      const existing = this.typingByChannel[channelId] ?? [];
      const key = presenceMemberKey(member);
      const next = existing.filter((item) => presenceMemberKey(item) !== key);
      next.push(member);
      this.typingByChannel[channelId] = next;
    },
    removeTypingMember(channelId: string, member: ChannelPresenceMember): void {
      const existing = this.typingByChannel[channelId] ?? [];
      if (existing.length === 0) return;
      const key = presenceMemberKey(member);
      this.typingByChannel[channelId] = existing.filter((item) => presenceMemberKey(item) !== key);
      this.clearTypingTimer(channelId, member);
    },
    scheduleTypingExpiry(channelId: string, member: ChannelPresenceMember): void {
      this.clearTypingTimer(channelId, member);
      const timerKey = typingMemberTimerKey(channelId, member);
      const timer = setTimeout(() => {
        typingTimersByMember.delete(timerKey);
        this.removeTypingMember(channelId, member);
      }, typingExpiryMS);
      typingTimersByMember.set(timerKey, timer);
    },
    clearTypingTimer(channelId: string, member: ChannelPresenceMember): void {
      const timerKey = typingMemberTimerKey(channelId, member);
      const timer = typingTimersByMember.get(timerKey);
      if (!timer) return;
      clearTimeout(timer);
      typingTimersByMember.delete(timerKey);
    },
    clearTypingForChannel(channelId: string): void {
      delete this.typingByChannel[channelId];
      const prefix = `${channelId}|`;
      for (const [timerKey, timer] of typingTimersByMember.entries()) {
        if (!timerKey.startsWith(prefix)) continue;
        clearTimeout(timer);
        typingTimersByMember.delete(timerKey);
      }
    },
    clearTypingForServer(serverId: string): void {
      const groups = this.groupsByServer[serverId] ?? [];
      groups.forEach((group) => {
        group.channels.forEach((channel) => {
          this.clearTypingForChannel(channel.id);
        });
      });
    },
    syncTypingMembersWithPresence(channelId: string, members: ChannelPresenceMember[]): void {
      const presenceKeys = new Set(members.map((member) => presenceMemberKey(member)));
      const typingMembers = this.typingByChannel[channelId] ?? [];
      const nextTypingMembers = typingMembers.filter((member) => presenceKeys.has(presenceMemberKey(member)));
      if (nextTypingMembers.length === typingMembers.length) {
        return;
      }
      this.typingByChannel[channelId] = nextTypingMembers;
      typingMembers.forEach((member) => {
        if (presenceKeys.has(presenceMemberKey(member))) return;
        this.clearTypingTimer(channelId, member);
      });
    },
    markChannelRead(channelId: string): void {
      this.unreadByChannel[channelId] = 0;
    },
    markChannelsRead(channelIds: string[]): void {
      channelIds.forEach((channelId) => {
        this.markChannelRead(channelId);
      });
    },
    incrementUnread(channelId: string): void {
      this.unreadByChannel[channelId] = (this.unreadByChannel[channelId] ?? 0) + 1;
    },
    findChannelName(serverId: string, channelId: string): string {
      const groups = this.groupsByServer[serverId] ?? [];
      for (const group of groups) {
        const match = group.channels.find((channel) => channel.id === channelId);
        if (match) return match.name;
      }
      return channelId;
    },
    scheduleRealtimeReconnect(serverId: string): void {
      this.ensureRealtimeState(serverId);
      const params = realtimeConnectParamsByServer.get(serverId);
      if (!params) {
        this.realtimeByServer[serverId].reconnecting = false;
        this.realtimeByServer[serverId].errorMessage = "Realtime disconnected.";
        return;
      }
      clearReconnectTimer(serverId);
      const nextAttempt = this.realtimeByServer[serverId].reconnectAttempt + 1;
      this.realtimeByServer[serverId].reconnectAttempt = nextAttempt;
      this.realtimeByServer[serverId].reconnecting = true;
      const delay = reconnectBackoffMS[Math.min(nextAttempt - 1, reconnectBackoffMS.length - 1)];
      const seconds = Math.ceil(delay / 1000);
      this.realtimeByServer[serverId].errorMessage = `Realtime disconnected. Reconnecting in ${seconds}s...`;

      const timer = setTimeout(() => {
        reconnectTimersByServer.delete(serverId);
        void this.connectRealtime(params);
      }, delay);
      reconnectTimersByServer.set(serverId, timer);
    },
    async notifyIncomingMessage(serverId: string, message: ChatMessage, channelIsActive: boolean): Promise<void> {
      if (typeof window === "undefined" || typeof Notification === "undefined") return;
      const currentUID = this.currentUserUIDByServer[serverId] ?? "";
      if (currentUID && message.authorUID === currentUID) return;

      const windowVisible = isDocumentVisible();
      const isMention = messageMentionsUID(message.body, currentUID);
      if (windowVisible && channelIsActive && !isMention) return;

      if (Notification.permission === "denied") return;
      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
      }

      const channelName = this.findChannelName(serverId, message.channelId);
      const title = `${message.authorUID} in #${channelName}`;
      const body = message.body.length > 120 ? `${message.body.slice(0, 117)}...` : message.body;
      const notification = new Notification(title, {
        body,
        tag: `openchat:${serverId}:${message.channelId}`,
        silent: true
      });
      notification.onclick = () => {
        if (typeof window !== "undefined") {
          window.focus();
        }
      };
    },
    disconnectServerRealtime(serverId: string): void {
      const socket = socketsByServer.get(serverId);
      clearReconnectTimer(serverId);
      if (socket) {
        intentionallyClosedSockets.add(serverId);
        socket.close();
        socketsByServer.delete(serverId);
      }
      this.ensureRealtimeState(serverId);
      this.realtimeByServer[serverId].connected = false;
      this.realtimeByServer[serverId].reconnecting = false;
      this.realtimeByServer[serverId].reconnectAttempt = 0;
      this.realtimeByServer[serverId].errorMessage = null;
      this.clearPresenceForServer(serverId);
      this.clearTypingForServer(serverId);
      realtimeConnectParamsByServer.delete(serverId);
    },
    disconnectAllRealtime(): void {
      [...socketsByServer.keys()].forEach((serverId) => {
        this.disconnectServerRealtime(serverId);
      });
      this.presenceByChannel = {};
      this.typingByChannel = {};
      typingTimersByMember.forEach((timer) => {
        clearTimeout(timer);
      });
      typingTimersByMember.clear();
      reconnectTimersByServer.forEach((timer) => {
        clearTimeout(timer);
      });
      reconnectTimersByServer.clear();
      realtimeConnectParamsByServer.clear();
    },
    ensureRealtimeState(serverId: string): void {
      if (!this.realtimeByServer[serverId]) {
        this.realtimeByServer[serverId] = {
          connected: false,
          reconnecting: false,
          reconnectAttempt: 0,
          lastConnectedAt: null,
          errorMessage: null
        };
      }
    },
    clearPresenceForServer(serverId: string): void {
      const groups = this.groupsByServer[serverId] ?? [];
      groups.forEach((group) => {
        group.channels.forEach((channel) => {
          delete this.presenceByChannel[channel.id];
          this.clearTypingForChannel(channel.id);
        });
      });
    }
  }
});
