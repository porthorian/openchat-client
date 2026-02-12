import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { RuntimeInfo } from "@shared/ipc";
import type { Channel, ChannelGroup } from "@renderer/types/chat";
import type { ServerProfile } from "@renderer/types/models";
import { DEFAULT_BACKEND_URL, fetchServerDirectory } from "@renderer/services/serverRegistryClient";
import { useAppUIStore, useCallStore, useChatStore, useIdentityStore, useServerRegistryStore, useSessionStore } from "@renderer/stores";

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

export function useWorkspaceShell() {
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

  function setAddServerBackendUrl(value: string): void {
    addServerForm.value.backendUrl = value;
  }

  function setAddServerId(value: string): void {
    addServerForm.value.serverId = value;
  }

  function setAddServerDisplayName(value: string): void {
    addServerForm.value.displayName = value;
  }

  const appShellClasses = computed(() => ({
    "is-macos": isMacOS
  }));

  const layoutClasses = computed(() => ({
    "is-members-collapsed": !appUI.membersPaneOpen
  }));

  const runtimeLabel = computed(() => {
    return runtime.value ? `${runtime.value.platform} / ${runtime.value.arch}` : "runtime pending";
  });

  const taskbarProps = computed(() => ({
    serverIconText: activeServer.value?.iconText ?? "OC",
    serverName: activeServer.value?.displayName ?? "OpenChat Client"
  }));

  const serverRailProps = computed(() => ({
    servers: registry.servers,
    activeServerId: appUI.activeServerId
  }));

  const channelPaneProps = computed(() => ({
    serverName: activeServer.value?.displayName ?? "Unknown Server",
    groups: filteredChannelGroups.value,
    activeChannelId: appUI.activeChannelId,
    activeVoiceChannelId: activeVoiceChannelId.value,
    activeVoiceChannelName: activeVoiceChannelName.value,
    callState: activeCallSession.value?.state ?? "idle",
    callParticipantCount: activeCallSession.value?.participants.length ?? 0,
    micMuted: activeCallSession.value?.micMuted ?? false,
    deafened: activeCallSession.value?.deafened ?? false,
    callErrorMessage: activeCallSession.value?.errorMessage ?? null,
    voiceParticipantsByChannel: activeVoiceParticipants.value,
    filterValue: appUI.channelFilter,
    currentUid: activeSession.value?.userUID ?? "uid_unbound",
    disclosureMessage: identity.disclosureMessage,
    uidMode: identity.uidMode,
    appVersion: appVersion.value,
    runtimeLabel: runtimeLabel.value,
    startupError: startupError.value
  }));

  const workspaceToolbarProps = computed(() => ({
    activeChannelName: activeChannelName.value,
    serverName: activeServer.value?.displayName ?? "Unknown Server",
    membersPaneOpen: appUI.membersPaneOpen
  }));

  const chatPaneProps = computed(() => ({
    channelId: activeChannelName.value,
    messages: activeMessages.value,
    isLoadingMessages: isLoadingMessages.value,
    isSendingMessage: isSendingMessage.value
  }));

  const membersPaneProps = computed(() => ({
    members: connectedMembers.value,
    title: membersPaneTitle.value,
    subtitle: membersPaneSubtitle.value,
    emptyMessage: membersPaneEmptyMessage.value,
    isOpen: appUI.membersPaneOpen
  }));

  const addServerDialogProps = computed(() => ({
    isOpen: isAddServerDialogOpen.value,
    backendUrl: addServerForm.value.backendUrl,
    serverId: addServerForm.value.serverId,
    displayName: addServerForm.value.displayName,
    errorMessage: addServerForm.value.errorMessage,
    isSubmitting: addServerForm.value.isSubmitting
  }));

  const serverRailListeners = {
    selectServer,
    addServer: openAddServerDialog
  };

  const channelPaneListeners = {
    selectChannel,
    selectVoiceChannel,
    updateFilter: setChannelFilter,
    toggleUidMode: cycleUIDMode,
    toggleMic,
    toggleDeafen,
    leaveVoiceChannel
  };

  const workspaceToolbarListeners = {
    toggleMembersPane
  };

  const chatPaneListeners = {
    sendMessage
  };

  const membersPaneListeners = {
    close: closeMembersPane
  };

  const addServerDialogListeners = {
    close: closeAddServerDialog,
    discover: discoverServersFromURL,
    addManually: addServerManually,
    "update:backendUrl": setAddServerBackendUrl,
    "update:serverId": setAddServerId,
    "update:displayName": setAddServerDisplayName
  };

  return {
    appShellClasses,
    layoutClasses,
    taskbarProps,
    serverRailProps,
    channelPaneProps,
    workspaceToolbarProps,
    chatPaneProps,
    membersPaneProps,
    addServerDialogProps,
    serverRailListeners,
    channelPaneListeners,
    workspaceToolbarListeners,
    chatPaneListeners,
    membersPaneListeners,
    addServerDialogListeners
  };
}
