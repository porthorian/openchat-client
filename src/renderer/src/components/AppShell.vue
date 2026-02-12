<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mdiAccountMultiple,
  mdiArrowLeft,
  mdiArrowRight,
  mdiDownload,
  mdiMagnify,
  mdiMessageTextOutline,
  mdiBellOutline,
  mdiPinOutline
} from "@mdi/js";
import type { RuntimeInfo } from "@shared/ipc";
import type { Channel, ChannelGroup } from "@renderer/types/chat";
import type { ServerProfile } from "@renderer/types/models";
import { DEFAULT_BACKEND_URL, fetchServerDirectory } from "@renderer/services/serverRegistryClient";
import { useAppUIStore, useCallStore, useChatStore, useIdentityStore, useServerRegistryStore, useSessionStore } from "@renderer/stores";
import AppIcon from "./AppIcon.vue";
import ServerRail from "./ServerRail.vue";
import ChannelPane from "./ChannelPane.vue";
import ChatPane from "./ChatPane.vue";
import MembersPane from "./MembersPane.vue";

type VoiceMood = "chilling" | "gaming" | "studying" | "brb" | "watching stuff";

type VoiceParticipant = {
  id: string;
  name: string;
  avatarText: string;
  avatarColor: string;
  mood: VoiceMood;
  badgeEmoji?: string;
};

type AddServerFormState = {
  backendUrl: string;
  serverId: string;
  displayName: string;
  errorMessage: string | null;
  isSubmitting: boolean;
};

const appUI = useAppUIStore();
const call = useCallStore();
const chat = useChatStore();
const identity = useIdentityStore();
const registry = useServerRegistryStore();
const session = useSessionStore();
const isMacOS = /mac/i.test(window.navigator.userAgent);

const runtime = ref<RuntimeInfo | null>(null);
const appVersion = ref<string>("0.0.0");
const isHydrating = ref(false);
const startupError = ref<string | null>(null);
const isAddServerDialogOpen = ref(false);
const addServerForm = ref<AddServerFormState>({
  backendUrl: DEFAULT_BACKEND_URL,
  serverId: "",
  displayName: "",
  errorMessage: null,
  isSubmitting: false
});

const moodCatalog: VoiceMood[] = ["chilling", "gaming", "studying", "brb", "watching stuff"];

function toColorFromUID(uid: string): string {
  let hash = 0;
  for (let index = 0; index < uid.length; index += 1) {
    hash = (hash << 5) - hash + uid.charCodeAt(index);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 62%)`;
}

function toMoodFromUID(uid: string): VoiceMood {
  let hash = 0;
  for (let index = 0; index < uid.length; index += 1) {
    hash = (hash << 5) - hash + uid.charCodeAt(index);
    hash |= 0;
  }
  return moodCatalog[Math.abs(hash) % moodCatalog.length];
}

function toDisplayName(uid: string): string {
  if (uid.length <= 12) return uid;
  return `${uid.slice(0, 8)}…${uid.slice(-4)}`;
}

function findChannelByID(groups: ChannelGroup[], channelID: string): Channel | null {
  for (const group of groups) {
    const match = group.channels.find((channel) => channel.id === channelID);
    if (match) return match;
  }
  return null;
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

const activeVoiceChannelId = computed(() => call.activeChannelFor(appUI.activeServerId));
const localDeviceID = computed(() => {
  if (identity.rootIdentityId) {
    return `desktop_${identity.rootIdentityId.slice(-8)}`;
  }
  return "desktop_local";
});

const activeServer = computed(() => registry.byId(appUI.activeServerId));
const activeSession = computed(() => session.sessionsByServer[appUI.activeServerId]);

function orderChannelGroups(groups: ChannelGroup[]): ChannelGroup[] {
  const voiceGroups = groups.filter((group) => group.kind === "voice");
  const textGroups = groups.filter((group) => group.kind === "text");
  return [...voiceGroups, ...textGroups];
}

const rawChannelGroups = computed(() => chat.groupsFor(appUI.activeServerId));

const filteredChannelGroups = computed(() => {
  const groups = orderChannelGroups(rawChannelGroups.value);
  const filter = appUI.channelFilter.trim().toLowerCase();
  if (!filter) return groups;
  return groups
    .map((group) => ({
      ...group,
      channels: group.channels.filter((channel) => channel.name.toLowerCase().includes(filter))
    }))
    .filter((group) => group.channels.length > 0);
});

const activeMessages = computed(() => {
  return chat.messagesFor(appUI.activeChannelId);
});

const connectedMembers = computed(() => {
  if (!appUI.activeChannelId) return [];
  const members = chat.channelPresenceFor(appUI.activeChannelId);
  return members.map((member) => ({
    id: member.clientId || `${member.userUID}:${member.deviceID}`,
    name: toDisplayName(member.userUID),
    status: "online" as const
  }));
});

const membersPaneTitle = computed(() => {
  return "Online";
});

const membersPaneSubtitle = computed(() => {
  if (!appUI.activeChannelId) return "No active channel";
  return `#${activeChannelName.value}`;
});

const membersPaneEmptyMessage = computed(() => {
  if (!appUI.activeChannelId) return "Select a text channel to see active users.";
  return "No users currently active in this text channel.";
});

const activeCallSession = computed(() => {
  if (!activeVoiceChannelId.value) return null;
  return call.sessionFor(appUI.activeServerId, activeVoiceChannelId.value);
});

const activeVoiceParticipants = computed<Record<string, VoiceParticipant[]>>(() => {
  const byChannel: Record<string, VoiceParticipant[]> = {};
  if (!activeVoiceChannelId.value) return byChannel;
  const currentParticipants = call.participantsFor(appUI.activeServerId, activeVoiceChannelId.value);
  if (currentParticipants.length === 0) return byChannel;
  byChannel[activeVoiceChannelId.value] = currentParticipants.map((participant) => ({
    id: participant.participantId,
    name: toDisplayName(participant.userUID),
    avatarText: participant.userUID.slice(0, 1).toUpperCase(),
    avatarColor: toColorFromUID(participant.userUID),
    mood: toMoodFromUID(participant.userUID),
    badgeEmoji: participant.isLocal ? "🛰️" : "🎧"
  }));
  return byChannel;
});

const activeChannelName = computed(() => {
  const match = findChannelByID(rawChannelGroups.value, appUI.activeChannelId);
  if (!match) return "unknown";
  return match.name;
});

const activeVoiceChannelName = computed(() => {
  if (!activeVoiceChannelId.value) return null;
  const match = findChannelByID(rawChannelGroups.value, activeVoiceChannelId.value);
  return match?.name ?? activeVoiceChannelId.value;
});

const isLoadingMessages = computed(() => {
  return chat.isMessagesLoading(appUI.activeChannelId) || isHydrating.value;
});

const isSendingMessage = computed(() => {
  return chat.isSendingInChannel(appUI.activeChannelId);
});

async function hydrateServer(serverId: string): Promise<void> {
  const server = registry.byId(serverId);
  if (!server) return;

  const currentSession = session.sessionsByServer[serverId];
  const projectedUID = identity.getUIDForServer(serverId);
  if (!currentSession || currentSession.userUID !== projectedUID) {
    session.setSession(serverId, {
      status: currentSession?.status ?? "active",
      userUID: projectedUID,
      lastBoundAt: new Date().toISOString()
    });
  }
  const activeUser = session.sessionsByServer[serverId]?.userUID;
  if (!activeUser) return;

  isHydrating.value = true;
  try {
    const firstChannelID = await chat.loadServerData({
      serverId,
      backendUrl: server.backendUrl,
      userUID: activeUser,
      deviceID: localDeviceID.value
    });

    const currentChannel = findChannelByID(chat.groupsFor(serverId), appUI.activeChannelId);
    let targetChannelID = appUI.activeChannelId;
    if (!currentChannel || currentChannel.type !== "text") {
      targetChannelID = firstChannelID ?? firstTextChannel(chat.groupsFor(serverId))?.id ?? "";
      if (targetChannelID) {
        appUI.setActiveChannel(targetChannelID);
      }
    }

    if (targetChannelID) {
      await chat.loadMessages({
        backendUrl: server.backendUrl,
        channelId: targetChannelID
      });
      chat.subscribeToChannel(serverId, targetChannelID);
    }
  } finally {
    isHydrating.value = false;
  }
}

onMounted(async () => {
  identity.initializeIdentity();
  try {
    appVersion.value = await window.openchat.getAppVersion();
    runtime.value = await window.openchat.getRuntimeInfo();
  } catch (error) {
    startupError.value = `Desktop runtime bridge unavailable: ${(error as Error).message}`;
  }

  try {
    await registry.hydrateFromBackend();
    if (registry.servers.length === 0) {
      startupError.value = "No servers available from backend.";
      return;
    }

    const initialServerID = registry.byId(appUI.activeServerId)?.serverId ?? registry.servers[0].serverId;
    if (initialServerID !== appUI.activeServerId) {
      appUI.setActiveServer(initialServerID);
    }
    startupError.value = null;
    await hydrateServer(initialServerID);
  } catch (error) {
    const connectError = (error as Error).message;
    startupError.value = startupError.value ? `${startupError.value} | ${connectError}` : connectError;
  }
});

onBeforeUnmount(() => {
  call.disconnectAll();
  chat.disconnectAllRealtime();
});

async function selectServer(serverId: string): Promise<void> {
  const currentActiveVoice = activeVoiceChannelId.value;
  if (currentActiveVoice) {
    call.leaveChannel(appUI.activeServerId, currentActiveVoice);
  }
  const previousServerID = appUI.activeServerId;
  const previousChannelID = appUI.activeChannelId;
  if (previousChannelID) {
    chat.unsubscribeFromChannel(previousServerID, previousChannelID);
  }
  appUI.setActiveServer(serverId);
  await hydrateServer(serverId);
}

async function selectChannel(channelId: string): Promise<void> {
  const server = activeServer.value;
  if (!server) return;
  if (appUI.activeChannelId && appUI.activeChannelId !== channelId) {
    chat.unsubscribeFromChannel(appUI.activeServerId, appUI.activeChannelId);
  }
  appUI.setActiveChannel(channelId);
  await chat.loadMessages({
    backendUrl: server.backendUrl,
    channelId
  });
  chat.subscribeToChannel(appUI.activeServerId, channelId);
}

function selectVoiceChannel(channelId: string): void {
  const server = activeServer.value;
  const activeUser = activeSession.value?.userUID;
  if (!server || !activeUser) return;
  void call.toggleVoiceChannel({
    serverId: appUI.activeServerId,
    channelId,
    backendUrl: server.backendUrl,
    userUID: activeUser,
    deviceID: localDeviceID.value
  });
}

function setChannelFilter(value: string): void {
  appUI.setChannelFilter(value);
}

function cycleUIDMode(): void {
  identity.setUIDMode(identity.uidMode === "server_scoped" ? "global" : "server_scoped");
  registry.servers.forEach((server) => {
    const existing = session.sessionsByServer[server.serverId];
    session.setSession(server.serverId, {
      status: existing?.status ?? "active",
      userUID: identity.getUIDForServer(server.serverId),
      lastBoundAt: new Date().toISOString()
    });
  });
  chat.disconnectAllRealtime();
  void hydrateServer(appUI.activeServerId);
}

function toggleMembersPane(): void {
  appUI.toggleMembersPane();
}

function closeMembersPane(): void {
  appUI.setMembersPaneOpen(false);
}

function toggleMic(): void {
  call.toggleMic(appUI.activeServerId);
}

function toggleDeafen(): void {
  call.toggleDeafen(appUI.activeServerId);
}

function leaveVoiceChannel(): void {
  if (!activeVoiceChannelId.value) return;
  call.leaveChannel(appUI.activeServerId, activeVoiceChannelId.value);
}

async function sendMessage(body: string): Promise<void> {
  const server = activeServer.value;
  const currentUID = activeSession.value?.userUID;
  if (!server || !currentUID || !appUI.activeChannelId) return;
  await chat.sendMessage({
    backendUrl: server.backendUrl,
    channelId: appUI.activeChannelId,
    body,
    userUID: currentUID,
    deviceID: localDeviceID.value
  });
}

function toIconText(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "SV";
  return normalized.slice(0, 2);
}

function resetAddServerForm(): void {
  addServerForm.value = {
    backendUrl: DEFAULT_BACKEND_URL,
    serverId: "",
    displayName: "",
    errorMessage: null,
    isSubmitting: false
  };
}

function openAddServerDialog(): void {
  resetAddServerForm();
  isAddServerDialogOpen.value = true;
}

function closeAddServerDialog(): void {
  if (addServerForm.value.isSubmitting) return;
  isAddServerDialogOpen.value = false;
}

async function discoverServersFromURL(): Promise<void> {
  const backendUrl = addServerForm.value.backendUrl.trim().replace(/\/$/, "");
  if (!backendUrl) {
    addServerForm.value.errorMessage = "Backend URL is required.";
    return;
  }

  addServerForm.value.isSubmitting = true;
  addServerForm.value.errorMessage = null;
  try {
    const discovered = await fetchServerDirectory(backendUrl);
    if (discovered.length === 0) {
      addServerForm.value.errorMessage = `No servers available at ${backendUrl}/v1/servers`;
      return;
    }

    let addedCount = 0;
    discovered.forEach((profile) => {
      if (registry.addServer(profile)) {
        addedCount += 1;
      }
    });

    const first = discovered[0];
    appUI.setActiveServer(first.serverId);
    startupError.value = addedCount === 0 ? `Server already added: ${first.displayName}` : null;
    isAddServerDialogOpen.value = false;
    await hydrateServer(first.serverId);
  } catch (directoryError) {
    addServerForm.value.errorMessage = (directoryError as Error).message;
  } finally {
    addServerForm.value.isSubmitting = false;
  }
}

async function addServerManually(): Promise<void> {
  const backendUrl = addServerForm.value.backendUrl.trim().replace(/\/$/, "");
  const serverId = addServerForm.value.serverId.trim();
  const displayName = addServerForm.value.displayName.trim();

  if (!backendUrl) {
    addServerForm.value.errorMessage = "Backend URL is required.";
    return;
  }
  if (!serverId) {
    addServerForm.value.errorMessage = "Server ID is required.";
    return;
  }

  const profile: ServerProfile = {
    serverId,
    displayName: displayName || serverId,
    backendUrl,
    iconText: toIconText(displayName || serverId),
    trustState: "unverified",
    identityHandshakeStrategy: "challenge_signature",
    userIdentifierPolicy: "server_scoped"
  };

  const added = registry.addServer(profile);
  if (!added) {
    addServerForm.value.errorMessage = `Server already added: ${serverId}`;
    return;
  }

  appUI.setActiveServer(profile.serverId);
  startupError.value = null;
  isAddServerDialogOpen.value = false;
  await hydrateServer(profile.serverId);
}
</script>

<template>
  <div class="app-shell" :class="{ 'is-macos': isMacOS }">
    <header class="taskbar">
      <div class="taskbar-left">
        <button type="button" class="taskbar-btn" aria-label="Back">
          <AppIcon :path="mdiArrowLeft" :size="16" />
        </button>
        <button type="button" class="taskbar-btn" aria-label="Forward">
          <AppIcon :path="mdiArrowRight" :size="16" />
        </button>
      </div>

      <div class="taskbar-center">
        <span class="taskbar-guild-pill">{{ activeServer?.iconText ?? "OC" }}</span>
        <strong>{{ activeServer?.displayName ?? "OpenChat Client" }}</strong>
      </div>

      <div class="taskbar-right">
        <button type="button" class="taskbar-btn" aria-label="Notifications">
          <AppIcon :path="mdiBellOutline" :size="16" />
        </button>
        <button type="button" class="taskbar-btn is-download" aria-label="Download">
            <AppIcon :path="mdiDownload" :size="16" />
        </button>
      </div>
    </header>

    <section class="layout" :class="{ 'is-members-collapsed': !appUI.membersPaneOpen }">
      <ServerRail
        :servers="registry.servers"
        :active-server-id="appUI.activeServerId"
        @select-server="selectServer"
        @add-server="openAddServerDialog"
      />

      <ChannelPane
        :server-name="activeServer?.displayName ?? 'Unknown Server'"
        :groups="filteredChannelGroups"
        :active-channel-id="appUI.activeChannelId"
        :active-voice-channel-id="activeVoiceChannelId"
        :active-voice-channel-name="activeVoiceChannelName"
        :call-state="activeCallSession?.state ?? 'idle'"
        :call-participant-count="activeCallSession?.participants.length ?? 0"
        :mic-muted="activeCallSession?.micMuted ?? false"
        :deafened="activeCallSession?.deafened ?? false"
        :call-error-message="activeCallSession?.errorMessage ?? null"
        :voice-participants-by-channel="activeVoiceParticipants"
        :filter-value="appUI.channelFilter"
        :current-uid="activeSession?.userUID ?? 'uid_unbound'"
        :disclosure-message="identity.disclosureMessage"
        :uid-mode="identity.uidMode"
        :app-version="appVersion"
        :runtime-label="runtime ? `${runtime.platform} / ${runtime.arch}` : 'runtime pending'"
        :startup-error="startupError"
        @select-channel="selectChannel"
        @select-voice-channel="selectVoiceChannel"
        @update-filter="setChannelFilter"
        @toggle-uid-mode="cycleUIDMode"
        @toggle-mic="toggleMic"
        @toggle-deafen="toggleDeafen"
        @leave-voice-channel="leaveVoiceChannel"
      />

      <header class="workspace-toolbar">
        <div class="chat-toolbar-left">
          <h2># {{ activeChannelName }}</h2>
          <span class="toolbar-divider" />
          <small>{{ activeServer?.displayName ?? "Unknown Server" }}</small>
        </div>
        <div class="chat-toolbar-right">
          <button type="button" class="toolbar-icon">
            <AppIcon :path="mdiPinOutline" :size="18" />
          </button>
          <button type="button" class="toolbar-icon">
            <AppIcon :path="mdiMessageTextOutline" :size="18" />
          </button>
          <button
            type="button"
            class="toolbar-icon"
            :class="{ 'is-active': appUI.membersPaneOpen }"
            @click="toggleMembersPane"
          >
            <AppIcon :path="mdiAccountMultiple" :size="18" />
          </button>
          <label class="toolbar-search-wrap">
            <AppIcon :path="mdiMagnify" :size="16" />
            <input
              type="text"
              class="toolbar-search"
              :placeholder="`Search ${activeServer?.displayName ?? 'Server'}`"
            />
          </label>
        </div>
      </header>

      <ChatPane
        class="chat-pane-slot"
        :channel-id="activeChannelName"
        :messages="activeMessages"
        :is-loading-messages="isLoadingMessages"
        :is-sending-message="isSendingMessage"
        @send-message="sendMessage"
      />

      <MembersPane
        class="members-pane-slot"
        :members="connectedMembers"
        :title="membersPaneTitle"
        :subtitle="membersPaneSubtitle"
        :empty-message="membersPaneEmptyMessage"
        :is-open="appUI.membersPaneOpen"
        @close="closeMembersPane"
      />

    </section>

    <div
      v-if="isAddServerDialogOpen"
      class="modal-backdrop"
      role="presentation"
      @click.self="closeAddServerDialog"
    >
      <section class="server-modal" role="dialog" aria-modal="true" aria-label="Add server">
        <header>
          <h3>Add Server</h3>
          <button type="button" class="server-modal-close" @click="closeAddServerDialog">Close</button>
        </header>

        <label class="server-modal-field">
          <span>Backend URL</span>
          <input v-model="addServerForm.backendUrl" type="text" placeholder="http://localhost:8080" />
        </label>

        <div class="server-modal-actions">
          <button
            type="button"
            class="server-modal-btn is-primary"
            :disabled="addServerForm.isSubmitting"
            @click="discoverServersFromURL"
          >
            {{ addServerForm.isSubmitting ? "Discovering..." : "Discover From Backend" }}
          </button>
        </div>

        <p v-if="addServerForm.errorMessage" class="server-modal-error">{{ addServerForm.errorMessage }}</p>

        <div class="server-modal-divider" />

        <p class="server-modal-label">Manual Add</p>
        <label class="server-modal-field">
          <span>Server ID</span>
          <input v-model="addServerForm.serverId" type="text" placeholder="srv_demo" />
        </label>
        <label class="server-modal-field">
          <span>Display Name</span>
          <input v-model="addServerForm.displayName" type="text" placeholder="Demo Server" />
        </label>

        <div class="server-modal-actions">
          <button
            type="button"
            class="server-modal-btn"
            :disabled="addServerForm.isSubmitting"
            @click="addServerManually"
          >
            Add Manually
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
