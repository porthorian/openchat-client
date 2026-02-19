import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DesktopCaptureSource, RuntimeInfo } from "@shared/ipc";
import type { Channel, ChannelGroup } from "@renderer/types/chat";
import type { ServerCapabilities } from "@renderer/types/capabilities";
import type { ServerProfile } from "@renderer/types/models";
import type { SyncedUserProfile } from "@renderer/services/chatClient";
import type { CallVideoStream } from "@renderer/stores/call";
import {
  DEFAULT_BACKEND_URL,
  fetchServerDirectory,
  leaveServerMembership,
  ServerRegistryRequestError
} from "@renderer/services/serverRegistryClient";
import { fetchServerCapabilities } from "@renderer/services/rtcClient";
import { avatarPresetById } from "@renderer/utils/avatarPresets";
import {
  useAppUIStore,
  useCallStore,
  useChatStore,
  useClientUpdateStore,
  useIdentityStore,
  useServerRegistryStore,
  useSessionStore
} from "@renderer/stores";

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
  discoveredServers: ServerProfile[];
  selectedDiscoveredServerId: string;
  probeSummary: ServerJoinProbeSummary | null;
  probedCapabilities: ServerCapabilities | null;
};

type ServerJoinProbeSummary = {
  serverId: string;
  serverName: string;
  backendUrl: string;
  trustState: ServerProfile["trustState"];
  buildVersion: string | null;
  buildCommit: string | null;
  userUidPolicy: ServerCapabilities["userUidPolicy"];
  identityHandshakeMode: ServerProfile["identityHandshakeStrategy"];
  messagingEnabled: boolean;
  presenceEnabled: boolean;
  rtcEnabled: boolean;
  warningMessage: string | null;
  probedAt: string;
};

type ScreenSharePickerState = {
  isOpen: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  sources: DesktopCaptureSource[];
};

type CallStageParticipantCard = {
  participantId: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  avatarText: string;
  avatarBackground: string;
  avatarTextColor: string;
  avatarImageDataUrl: string | null;
};

export function useWorkspaceShell() {
  const appUI = useAppUIStore();
  const call = useCallStore();
  const chat = useChatStore();
  const clientUpdate = useClientUpdateStore();
  const identity = useIdentityStore();
  const registry = useServerRegistryStore();
  const session = useSessionStore();
  const isMacOS = /mac/i.test(window.navigator.userAgent);

  const runtime = ref<RuntimeInfo | null>(null);
  const appVersion = ref<string>("0.0.0");
  const isHydrating = ref(false);
  const startupError = ref<string | null>(null);
  const messageSendError = ref<string | null>(null);
  const isAddServerDialogOpen = ref(false);
  const addServerForm = ref<AddServerFormState>({
    backendUrl: DEFAULT_BACKEND_URL,
    serverId: "",
    displayName: "",
    errorMessage: null,
    isSubmitting: false,
    discoveredServers: [],
    selectedDiscoveredServerId: "",
    probeSummary: null,
    probedCapabilities: null
  });
  const screenSharePicker = ref<ScreenSharePickerState>({
    isOpen: false,
    isLoading: false,
    errorMessage: null,
    sources: []
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

  function profileForUID(userUID: string): SyncedUserProfile | null {
    if (!appUI.activeServerId) return null;
    return chat.profileForUser(appUI.activeServerId, userUID);
  }

  function displayNameForUID(userUID: string): string {
    const profile = profileForUID(userUID);
    if (profile?.displayName.trim()) {
      return profile.displayName.trim();
    }
    return toDisplayName(userUID);
  }

  function avatarForUID(userUID: string): {
    avatarText: string;
    avatarImageDataUrl: string | null;
    avatarBackground: string;
    avatarTextColor: string;
  } {
    const profile = profileForUID(userUID);
    const displayName = displayNameForUID(userUID);
    if (profile?.avatarMode === "uploaded" && profile.avatarUrl) {
      return {
        avatarText: displayName.slice(0, 1).toUpperCase(),
        avatarImageDataUrl: profile.avatarUrl,
        avatarBackground: toColorFromUID(userUID),
        avatarTextColor: "#ffffff"
      };
    }

    if (profile?.avatarMode === "generated" && profile.avatarPresetId) {
      const preset = avatarPresetById(profile.avatarPresetId);
      return {
        avatarText: displayName.slice(0, 1).toUpperCase(),
        avatarImageDataUrl: null,
        avatarBackground: preset.gradient,
        avatarTextColor: preset.accent
      };
    }

    return {
      avatarText: displayName.slice(0, 1).toUpperCase(),
      avatarImageDataUrl: null,
      avatarBackground: toColorFromUID(userUID),
      avatarTextColor: "#ffffff"
    };
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
  const activeRealtimeState = computed(() => chat.realtimeStateFor(appUI.activeServerId));
  const activeServerAudioPrefs = computed(() => call.audioPrefsByServer[appUI.activeServerId] ?? null);

  function orderChannelGroups(groups: ChannelGroup[]): ChannelGroup[] {
    const voiceGroups = groups.filter((group) => group.kind === "voice");
    const textGroups = groups.filter((group) => group.kind === "text");
    return [...voiceGroups, ...textGroups];
  }

  const rawChannelGroups = computed(() => chat.groupsFor(appUI.activeServerId));

  const filteredChannelGroups = computed(() => {
    const groups = orderChannelGroups(rawChannelGroups.value).map((group) => ({
      ...group,
      channels: group.channels.map((channel) => ({
        ...channel,
        unreadCount: channel.type === "text" ? chat.unreadCountForChannel(channel.id) : channel.unreadCount
      }))
    }));
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

  const activeProfilesByUID = computed(() => {
    return chat.profilesForServer(appUI.activeServerId);
  });

  const activeTypingUsers = computed<string[]>(() => {
    if (!appUI.activeChannelId) return [];
    const currentUID = activeSession.value?.userUID ?? "";
    const members = chat.typingForChannel(appUI.activeChannelId);
    const dedupedUIDs = new Set<string>();
    const names: string[] = [];
    members.forEach((member) => {
      const userUID = member.userUID.trim();
      if (!userUID || userUID === currentUID) return;
      if (dedupedUIDs.has(userUID)) return;
      dedupedUIDs.add(userUID);
      names.push(displayNameForUID(userUID));
    });
    return names;
  });

  const connectedMembers = computed(() => {
    if (!appUI.activeChannelId) return [];
    const members = chat.channelPresenceFor(appUI.activeChannelId);
    const currentUID = activeSession.value?.userUID.trim() ?? "";
    const localDisplayName = identity.profileDisplayName.trim() || "You";
    const localAvatarPreset = avatarPresetById(identity.avatarPresetId);
    return members.map((member) => ({
      id: member.clientId || `${member.userUID}:${member.deviceID}`,
      name: member.userUID === currentUID ? localDisplayName : displayNameForUID(member.userUID),
      status: "online" as const,
      avatarText:
        member.userUID === currentUID
          ? localDisplayName.slice(0, 1).toUpperCase()
          : avatarForUID(member.userUID).avatarText,
      avatarImageDataUrl:
        member.userUID === currentUID
          ? identity.avatarMode === "uploaded"
            ? identity.avatarImageDataUrl
            : null
          : avatarForUID(member.userUID).avatarImageDataUrl,
      avatarBackground:
        member.userUID === currentUID && identity.avatarMode === "generated"
          ? localAvatarPreset.gradient
          : avatarForUID(member.userUID).avatarBackground,
      avatarTextColor:
        member.userUID === currentUID && identity.avatarMode === "generated"
          ? localAvatarPreset.accent
          : avatarForUID(member.userUID).avatarTextColor
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

  const selectedChannel = computed(() => findChannelByID(rawChannelGroups.value, appUI.activeChannelId));
  const selectedVoiceChannelId = computed(() => (selectedChannel.value?.type === "voice" ? selectedChannel.value.id : null));
  const selectedVoiceChannelName = computed(() => {
    if (selectedChannel.value?.type !== "voice") return null;
    return selectedChannel.value.name;
  });
  const isSelectedVoiceChannelActiveCall = computed(() => {
    return Boolean(selectedVoiceChannelId.value && selectedVoiceChannelId.value === activeVoiceChannelId.value);
  });

  const activeVoiceParticipants = computed<Record<string, VoiceParticipant[]>>(() => {
    const byChannel: Record<string, VoiceParticipant[]> = {};
    if (!activeVoiceChannelId.value) return byChannel;
    const currentParticipants = call.participantsFor(appUI.activeServerId, activeVoiceChannelId.value);
    if (currentParticipants.length === 0) return byChannel;
    const localDisplayName = identity.profileDisplayName.trim() || "You";
    const localAvatarPreset = avatarPresetById(identity.avatarPresetId);
    byChannel[activeVoiceChannelId.value] = currentParticipants.map((participant) => ({
      id: participant.participantId,
      name: participant.isLocal ? localDisplayName : displayNameForUID(participant.userUID),
      avatarText:
        participant.isLocal ? localDisplayName.slice(0, 1).toUpperCase() : avatarForUID(participant.userUID).avatarText,
      avatarColor:
        participant.isLocal && identity.avatarMode === "generated"
          ? localAvatarPreset.gradient
          : avatarForUID(participant.userUID).avatarBackground,
      mood: toMoodFromUID(participant.userUID),
      badgeEmoji: participant.isLocal ? "🛰️" : "🎧"
    }));
    return byChannel;
  });

  const activeVoiceSpeakingParticipants = computed<Record<string, string[]>>(() => {
    const byChannel: Record<string, string[]> = {};
    if (!activeVoiceChannelId.value) return byChannel;
    const speakingIds = activeCallSession.value?.activeSpeakerParticipantIds ?? [];
    if (speakingIds.length === 0) return byChannel;
    byChannel[activeVoiceChannelId.value] = [...speakingIds];
    return byChannel;
  });

  const activeCallVideoStreams = computed<CallVideoStream[]>(() => {
    if (!activeVoiceChannelId.value) return [];
    return call.videoStreamsFor(appUI.activeServerId, activeVoiceChannelId.value);
  });

  const isCallStageVisible = computed(() => {
    if (!selectedVoiceChannelId.value) return false;
    return true;
  });

  const shouldShowCallStageVideo = computed(() => {
    if (!isSelectedVoiceChannelActiveCall.value) return false;
    const state = activeCallSession.value?.state ?? "idle";
    return state === "active" || state === "joining" || state === "reconnecting";
  });

  const activeCallParticipantCards = computed<CallStageParticipantCard[]>(() => {
    const participants = activeCallSession.value?.participants ?? [];
    if (participants.length === 0) return [];
    const localDisplayName = identity.profileDisplayName.trim() || "You";
    const localAvatarPreset = avatarPresetById(identity.avatarPresetId);
    const speakingSet = new Set(activeCallSession.value?.activeSpeakerParticipantIds ?? []);
    return participants.map((participant) => {
      const fallbackAvatar = avatarForUID(participant.userUID);
      const participantName = participant.isLocal ? localDisplayName : displayNameForUID(participant.userUID);
      return {
        participantId: participant.participantId,
        name: participantName,
        isLocal: participant.isLocal,
        isSpeaking: speakingSet.has(participant.participantId),
        avatarText: participantName.slice(0, 1).toUpperCase() || fallbackAvatar.avatarText,
        avatarBackground:
          participant.isLocal && identity.avatarMode === "generated" ? localAvatarPreset.gradient : fallbackAvatar.avatarBackground,
        avatarTextColor:
          participant.isLocal && identity.avatarMode === "generated" ? localAvatarPreset.accent : fallbackAvatar.avatarTextColor,
        avatarImageDataUrl:
          participant.isLocal && identity.avatarMode === "uploaded" ? identity.avatarImageDataUrl : fallbackAvatar.avatarImageDataUrl
      };
    });
  });

  const callStageHelperMessage = computed(() => {
    if (shouldShowCallStageVideo.value) {
      return "No video streams yet.";
    }
    if (activeVoiceChannelName.value && selectedVoiceChannelName.value && activeVoiceChannelName.value !== selectedVoiceChannelName.value) {
      return `You are connected in ${activeVoiceChannelName.value}. Select that channel to view live video.`;
    }
    if (selectedVoiceChannelName.value) {
      return `Join ${selectedVoiceChannelName.value} to view live video and screen shares.`;
    }
    return "Select a voice channel.";
  });

  const localVoiceTransmitting = computed(() => {
    const session = activeCallSession.value;
    const localParticipantId = session?.localParticipantId ?? "";
    if (!localParticipantId) return false;
    return (session?.activeSpeakerParticipantIds ?? []).includes(localParticipantId);
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

  const toolbarConnectionState = computed(() => {
    const state = activeRealtimeState.value;
    if (state.connected) {
      return {
        label: "Live",
        tone: "live" as const,
        detail: "Realtime connected"
      };
    }
    if (state.reconnecting) {
      return {
        label: "Reconnecting",
        tone: "degraded" as const,
        detail: state.errorMessage ?? `Reconnect attempt ${state.reconnectAttempt}`
      };
    }
    return {
      label: "Offline",
      tone: "offline" as const,
      detail: state.errorMessage ?? "Realtime offline"
    };
  });

  const unreadByServer = computed<Record<string, number>>(() => {
    const summary: Record<string, number> = {};
    registry.servers.forEach((server) => {
      const unreadCount = chat.unreadCountForServer(server.serverId);
      if (unreadCount > 0) {
        summary[server.serverId] = unreadCount;
      }
    });
    return summary;
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
      try {
        const capabilities = await fetchServerCapabilities(server.backendUrl);
        registry.setCapabilities(server.serverId, capabilities);
      } catch (_error) {
        // Keep previously-cached capabilities when probe fails.
      }
      if (server.capabilities?.profile && !server.capabilities.profile.enabled) {
        chat.setProfileSyncAvailability(serverId, false);
      }
      await chat.syncLocalProfile({
        serverId,
        backendUrl: server.backendUrl,
        userUID: activeUser,
        deviceID: localDeviceID.value,
        displayName: identity.profileDisplayName,
        avatarMode: identity.avatarMode,
        avatarPresetId: identity.avatarPresetId,
        avatarImageDataUrl: identity.avatarImageDataUrl
      });

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
          serverId,
          backendUrl: server.backendUrl,
          channelId: targetChannelID,
          userUID: activeUser,
          deviceID: localDeviceID.value
        });
        chat.subscribeToChannel(serverId, targetChannelID);
        chat.markChannelRead(targetChannelID);
      }
    } finally {
      isHydrating.value = false;
    }
  }

  function isServerUnreachableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("network request failed") ||
      message.includes("load failed")
    );
  }

  async function removeServerFromClient(serverId: string, reasonMessage: string): Promise<void> {
    const wasActiveServer = appUI.activeServerId === serverId;
    chat.clearServerData(serverId);
    call.clearServerState(serverId);
    session.clearSession(serverId);
    appUI.clearServerContext(serverId);
    registry.removeServer(serverId);

    if (registry.servers.length === 0) {
      appUI.setActiveServer("");
      startupError.value = reasonMessage;
      return;
    }

    if (!wasActiveServer) {
      startupError.value = reasonMessage;
      return;
    }

    const fallbackServerID = registry.servers[0].serverId;
    appUI.setActiveServer(fallbackServerID);
    startupError.value = reasonMessage;
    await hydrateServerWithReachabilityHandling(fallbackServerID);
  }

  async function hydrateServerWithReachabilityHandling(serverId: string): Promise<void> {
    const targetServer = registry.byId(serverId);
    if (!targetServer) return;
    try {
      await hydrateServer(serverId);
      startupError.value = null;
    } catch (error) {
      if (!isServerUnreachableError(error)) {
        throw error;
      }
      await removeServerFromClient(
        serverId,
        `Removed unreachable server ${targetServer.displayName}. Add it again once reachable.`
      );
    }
  }

  onMounted(async () => {
    identity.initializeIdentity();
    chat.hydrateNotificationPreferences();
    registry.hydrateFromStorage();
    void call.refreshInputDevices();
    void call.refreshOutputDevices();

    try {
      await clientUpdate.initialize();
    } catch (error) {
      startupError.value = `Client update bridge unavailable: ${(error as Error).message}`;
    }

    try {
      appVersion.value = await window.openchat.getAppVersion();
      runtime.value = await window.openchat.getRuntimeInfo();
    } catch (error) {
      startupError.value = `Desktop runtime bridge unavailable: ${(error as Error).message}`;
    }

    try {
      if (registry.servers.length === 0) {
        await registry.hydrateFromBackend(DEFAULT_BACKEND_URL, {
          userUID: directoryRequesterUID(DEFAULT_BACKEND_URL),
          deviceID: localDeviceID.value
        });
      }
      if (registry.servers.length === 0) {
        startupError.value = "No servers available from backend.";
        return;
      }

      const initialServerID = registry.byId(appUI.activeServerId)?.serverId ?? registry.servers[0].serverId;
      if (initialServerID !== appUI.activeServerId) {
        appUI.setActiveServer(initialServerID);
      }
      startupError.value = null;
      await hydrateServerWithReachabilityHandling(initialServerID);
    } catch (error) {
      const connectError = (error as Error).message;
      startupError.value = startupError.value ? `${startupError.value} | ${connectError}` : connectError;
    }
  });

  onBeforeUnmount(() => {
    closeScreenSharePicker();
    call.disconnectAll();
    chat.disconnectAllRealtime();
  });

  watch(
    () => ({
      serverId: appUI.activeServerId,
      backendUrl: activeServer.value?.backendUrl ?? "",
      userUID: activeSession.value?.userUID ?? "",
      deviceID: localDeviceID.value,
      participantUIDs: (activeCallSession.value?.participants ?? []).map((participant) => participant.userUID).join("|")
    }),
    (value) => {
      if (!value.serverId || !value.backendUrl || !value.userUID) return;
      const participantUIDs = (activeCallSession.value?.participants ?? []).map((participant) => participant.userUID);
      if (participantUIDs.length === 0) return;
      void chat.ensureProfilesForUIDs({
        serverId: value.serverId,
        backendUrl: value.backendUrl,
        userUID: value.userUID,
        deviceID: value.deviceID,
        targetUserUIDs: participantUIDs
      });
    },
    { immediate: true }
  );

  watch(
    () => `${appUI.activeServerId}:${appUI.activeChannelId}`,
    () => {
      messageSendError.value = null;
    }
  );

  async function selectServer(serverId: string): Promise<void> {
    if (serverId === appUI.activeServerId) {
      return;
    }
    closeScreenSharePicker();
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
    await hydrateServerWithReachabilityHandling(serverId);
  }

  async function leaveServer(serverId: string): Promise<void> {
    const leavingServer = registry.byId(serverId);
    if (!leavingServer) return;

    const leavingSession = session.sessionsByServer[serverId];
    const userUID = leavingSession?.userUID || identity.getUIDForServer(serverId);

    try {
      await leaveServerMembership({
        backendUrl: leavingServer.backendUrl,
        serverId,
        userUID,
        deviceID: localDeviceID.value
      });
    } catch (error) {
      if (isServerUnreachableError(error)) {
        await removeServerFromClient(serverId, `Removed unreachable server ${leavingServer.displayName}.`);
        return;
      }
      if (error instanceof ServerRegistryRequestError && error.status === 404) {
        await removeServerFromClient(serverId, `Removed missing server ${leavingServer.displayName}.`);
        return;
      }
      startupError.value = `Failed to leave server ${leavingServer.displayName}: ${(error as Error).message}`;
      return;
    }

    await removeServerFromClient(serverId, "Left server.");
  }

  async function selectChannel(channelId: string): Promise<void> {
    const server = activeServer.value;
    const currentUID = activeSession.value?.userUID;
    if (!server) return;
    if (!currentUID) return;
    if (appUI.activeChannelId && appUI.activeChannelId !== channelId) {
      chat.unsubscribeFromChannel(appUI.activeServerId, appUI.activeChannelId);
    }
    appUI.setActiveChannel(channelId);
    await chat.loadMessages({
      serverId: appUI.activeServerId,
      backendUrl: server.backendUrl,
      channelId,
      userUID: currentUID,
      deviceID: localDeviceID.value
    });
    chat.subscribeToChannel(appUI.activeServerId, channelId);
    chat.markChannelRead(channelId);
  }

  function selectVoiceChannel(channelId: string): void {
    const server = activeServer.value;
    const activeUser = activeSession.value?.userUID;
    if (!server || !activeUser) return;
    if (appUI.activeChannelId && appUI.activeChannelId !== channelId) {
      chat.unsubscribeFromChannel(appUI.activeServerId, appUI.activeChannelId);
    }
    appUI.setActiveChannel(channelId);
    if (activeVoiceChannelId.value === channelId) {
      return;
    }
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
    void hydrateServerWithReachabilityHandling(appUI.activeServerId);
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

  function toggleCamera(): void {
    void call.toggleCamera(appUI.activeServerId);
  }

  function closeScreenSharePicker(): void {
    screenSharePicker.value = {
      isOpen: false,
      isLoading: false,
      errorMessage: null,
      sources: []
    };
  }

  async function openScreenSharePicker(): Promise<void> {
    const screenShareBridge = window.openchat.rtc?.listDesktopCaptureSources;
    if (!screenShareBridge) {
      void call.toggleScreenShare(appUI.activeServerId);
      return;
    }

    screenSharePicker.value = {
      isOpen: true,
      isLoading: true,
      errorMessage: null,
      sources: []
    };
    try {
      const sources = await screenShareBridge();
      screenSharePicker.value = {
        isOpen: true,
        isLoading: false,
        errorMessage: null,
        sources
      };
    } catch (error) {
      screenSharePicker.value = {
        isOpen: true,
        isLoading: false,
        errorMessage: `Failed to list screen-share sources: ${(error as Error).message}`,
        sources: []
      };
    }
  }

  async function toggleScreenShare(): Promise<void> {
    const active = activeCallSession.value;
    if (active?.screenShareEnabled) {
      await call.toggleScreenShare(appUI.activeServerId);
      closeScreenSharePicker();
      return;
    }
    await openScreenSharePicker();
  }

  function selectScreenShareSource(sourceId: string): void {
    const normalizedSourceID = sourceId.trim();
    if (!normalizedSourceID) return;
    closeScreenSharePicker();
    void call.toggleScreenShare(appUI.activeServerId, {
      sourceId: normalizedSourceID
    });
  }

  function leaveVoiceChannel(): void {
    if (!activeVoiceChannelId.value) return;
    closeScreenSharePicker();
    call.leaveChannel(appUI.activeServerId, activeVoiceChannelId.value);
  }

  function openOutputOptions(): void {
    void call.refreshOutputDevices();
  }

  function openInputOptions(): void {
    void call.refreshInputDevices();
  }

  function selectInputDevice(deviceId: string): void {
    void call.selectInputDevice(deviceId);
  }

  function updateInputVolume(volume: number): void {
    call.setInputVolume(volume);
  }

  function selectOutputDevice(deviceId: string): void {
    void call.selectOutputDevice(deviceId);
  }

  function updateOutputVolume(volume: number): void {
    call.setOutputVolume(volume);
  }

  async function sendMessage(payload: { body: string; attachments: File[] }): Promise<void> {
    const server = activeServer.value;
    const currentUID = activeSession.value?.userUID;
    if (!server || !currentUID || !appUI.activeChannelId) return;
    messageSendError.value = null;
    try {
      await chat.sendMessage({
        backendUrl: server.backendUrl,
        channelId: appUI.activeChannelId,
        body: payload.body,
        attachments: payload.attachments,
        userUID: currentUID,
        deviceID: localDeviceID.value,
        maxMessageBytes: server.capabilities?.limits.maxMessageBytes ?? null,
        maxUploadBytes: server.capabilities?.limits.maxUploadBytes ?? null
      });
      chat.markChannelRead(appUI.activeChannelId);
    } catch (error) {
      if (error instanceof Error) {
        messageSendError.value = error.message;
        return;
      }
      messageSendError.value = "Failed to send message.";
    }
  }

  function setTypingActivity(isTyping: boolean): void {
    const serverId = appUI.activeServerId;
    const channelId = appUI.activeChannelId;
    if (!serverId || !channelId) return;
    chat.sendTyping(serverId, channelId, isTyping);
  }

  function markChannelsRead(channelIds: string[]): void {
    chat.markChannelsRead(channelIds);
  }

  async function triggerTaskbarUpdateAction(): Promise<void> {
    try {
      if (clientUpdate.status === "available") {
        clientUpdate.openUpdateProgressModal();
        await clientUpdate.downloadUpdate();
        return;
      }

      if (clientUpdate.status === "downloaded") {
        clientUpdate.openUpdateProgressModal();
        return;
      }

      if (clientUpdate.status === "error") {
        clientUpdate.openUpdateProgressModal();
        return;
      }

      if (clientUpdate.status === "downloading") {
        clientUpdate.openUpdateProgressModal();
      }
    } catch (error) {
      startupError.value = `Update action failed: ${(error as Error).message}`;
    }
  }

  async function checkForUpdatesAgain(): Promise<void> {
    try {
      await clientUpdate.checkForUpdates();
    } catch (error) {
      startupError.value = `Update check failed: ${(error as Error).message}`;
    }
  }

  function openVersionInfoModal(): void {
    clientUpdate.openVersionInfoModal();
  }

  function closeVersionInfoModal(): void {
    clientUpdate.closeVersionInfoModal();
  }

  function closeUpdateProgressModal(): void {
    clientUpdate.closeUpdateProgressModal();
  }

  async function retryUpdateDownload(): Promise<void> {
    try {
      clientUpdate.openUpdateProgressModal();
      await clientUpdate.checkForUpdates();
      if (clientUpdate.status === "available") {
        await clientUpdate.downloadUpdate();
      }
    } catch (error) {
      startupError.value = `Update retry failed: ${(error as Error).message}`;
    }
  }

  async function installDownloadedUpdate(): Promise<void> {
    try {
      await clientUpdate.quitAndInstall();
    } catch (error) {
      startupError.value = `Install failed: ${(error as Error).message}`;
    }
  }

  function dismissUpdaterNotice(): void {
    clientUpdate.dismissUpdaterNotice();
  }

  function toIconText(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return "SV";
    return normalized.slice(0, 2);
  }

  function normalizeBackendURL(value: string): string {
    return value.trim().replace(/\/$/, "");
  }

  function directoryRequesterUID(backendUrl: string): string {
    const scopeKey = normalizeBackendURL(backendUrl) || "server_directory";
    return identity.getUIDForServer(`directory:${scopeKey}`);
  }

  function isLikelyLocalhost(url: URL): boolean {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }

  function resolveTrustWarning(backendUrl: string, capabilities: ServerCapabilities): string | null {
    let parsedURL: URL;
    try {
      parsedURL = new URL(backendUrl);
    } catch (_error) {
      return "Backend URL is invalid.";
    }

    const insecureScheme = parsedURL.protocol !== "https:";
    const localhost = isLikelyLocalhost(parsedURL);

    if (capabilities.security.httpsRequired && insecureScheme && !localhost) {
      return "Server requires HTTPS. Update the backend URL to an HTTPS endpoint.";
    }

    if (insecureScheme && !localhost) {
      return "Connection is not HTTPS. Network operators and server admins may inspect traffic metadata.";
    }

    return null;
  }

  function toHandshakeStrategy(capabilities: ServerCapabilities): ServerProfile["identityHandshakeStrategy"] {
    if (capabilities.identityHandshakeModes.includes("challenge_signature")) {
      return "challenge_signature";
    }
    return "token_proof";
  }

  async function probeServerBackend(
    backendUrl: string,
    trustState: ServerProfile["trustState"]
  ): Promise<{ summary: ServerJoinProbeSummary; capabilities: ServerCapabilities }> {
    const capabilities = await fetchServerCapabilities(backendUrl);
    return {
      summary: {
      serverId: capabilities.serverId,
      serverName: capabilities.serverName,
      backendUrl,
      trustState,
      buildVersion: capabilities.buildVersion,
      buildCommit: capabilities.buildCommit,
      userUidPolicy: capabilities.userUidPolicy,
      identityHandshakeMode: toHandshakeStrategy(capabilities),
      messagingEnabled: capabilities.features.messaging,
      presenceEnabled: capabilities.features.presence,
      rtcEnabled: capabilities.rtc !== null,
      warningMessage: resolveTrustWarning(backendUrl, capabilities),
      probedAt: new Date().toISOString()
      },
      capabilities
    };
  }

  function selectedDiscoveredServer(): ServerProfile | null {
    const selectedId = addServerForm.value.selectedDiscoveredServerId;
    if (!selectedId) return null;
    return addServerForm.value.discoveredServers.find((server) => server.serverId === selectedId) ?? null;
  }

  function selectDiscoveredServer(serverId: string): void {
    const selected = addServerForm.value.discoveredServers.find((server) => server.serverId === serverId);
    if (!selected) return;
    addServerForm.value.selectedDiscoveredServerId = selected.serverId;
    addServerForm.value.serverId = selected.serverId;
    addServerForm.value.displayName = selected.displayName;
    addServerForm.value.probeSummary = null;
    addServerForm.value.probedCapabilities = null;
    addServerForm.value.errorMessage = null;
  }

  async function probeAddServerTarget(manageSubmitting = true): Promise<ServerJoinProbeSummary | null> {
    const backendUrl = normalizeBackendURL(addServerForm.value.backendUrl);
    if (!backendUrl) {
      addServerForm.value.errorMessage = "Backend URL is required.";
      return null;
    }

    const discovered = selectedDiscoveredServer();
    const trustState = discovered?.trustState ?? "unverified";
    if (manageSubmitting) {
      addServerForm.value.isSubmitting = true;
    }
    addServerForm.value.errorMessage = null;
    try {
      const result = await probeServerBackend(backendUrl, trustState);
      const summary = result.summary;
      addServerForm.value.probeSummary = summary;
      addServerForm.value.probedCapabilities = result.capabilities;
      const selectedServerId = addServerForm.value.selectedDiscoveredServerId;
      if (selectedServerId) {
        addServerForm.value.discoveredServers = addServerForm.value.discoveredServers.map((server) =>
          server.serverId === selectedServerId ? { ...server, capabilities: result.capabilities } : server
        );
      }
      if (!addServerForm.value.serverId.trim()) {
        addServerForm.value.serverId = summary.serverId;
      }
      if (!addServerForm.value.displayName.trim()) {
        addServerForm.value.displayName = summary.serverName;
      }
      return summary;
    } catch (error) {
      addServerForm.value.errorMessage = (error as Error).message;
      addServerForm.value.probeSummary = null;
      addServerForm.value.probedCapabilities = null;
      return null;
    } finally {
      if (manageSubmitting) {
        addServerForm.value.isSubmitting = false;
      }
    }
  }

  function resetAddServerForm(): void {
    addServerForm.value = {
      backendUrl: DEFAULT_BACKEND_URL,
      serverId: "",
      displayName: "",
      errorMessage: null,
      isSubmitting: false,
      discoveredServers: [],
      selectedDiscoveredServerId: "",
      probeSummary: null,
      probedCapabilities: null
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
    const backendUrl = normalizeBackendURL(addServerForm.value.backendUrl);
    if (!backendUrl) {
      addServerForm.value.errorMessage = "Backend URL is required.";
      return;
    }

    addServerForm.value.isSubmitting = true;
    addServerForm.value.errorMessage = null;
    try {
      const discovered = await fetchServerDirectory(backendUrl, {
        userUID: directoryRequesterUID(backendUrl),
        deviceID: localDeviceID.value
      });
      if (discovered.length === 0) {
        addServerForm.value.errorMessage = `No servers available at ${backendUrl}/v1/servers`;
        addServerForm.value.discoveredServers = [];
        addServerForm.value.selectedDiscoveredServerId = "";
        addServerForm.value.probedCapabilities = null;
        return;
      }

      addServerForm.value.discoveredServers = discovered.map((server) => {
        const existing = registry.byId(server.serverId);
        if (!existing?.capabilities) return server;
        return {
          ...server,
          capabilities: existing.capabilities
        };
      });
      selectDiscoveredServer(discovered[0].serverId);
      await probeAddServerTarget();
    } catch (directoryError) {
      addServerForm.value.discoveredServers = [];
      addServerForm.value.selectedDiscoveredServerId = "";
      addServerForm.value.probedCapabilities = null;
      addServerForm.value.errorMessage = (directoryError as Error).message;
    } finally {
      addServerForm.value.isSubmitting = false;
    }
  }

  async function addServerManually(): Promise<void> {
    const backendUrl = normalizeBackendURL(addServerForm.value.backendUrl);
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

    addServerForm.value.isSubmitting = true;
    addServerForm.value.errorMessage = null;
    try {
      let probe = addServerForm.value.probeSummary;
      let capabilities = addServerForm.value.probedCapabilities;
      if (!probe || probe.backendUrl !== backendUrl || probe.serverId !== serverId) {
        probe = await probeAddServerTarget(false);
        capabilities = addServerForm.value.probedCapabilities;
      }
      if (!probe || !capabilities) {
        return;
      }

      const discovered = selectedDiscoveredServer();
      const profile: ServerProfile = {
        serverId,
        displayName: displayName || serverId,
        backendUrl,
        iconText: discovered?.iconText ?? toIconText(displayName || serverId),
        trustState: discovered?.trustState ?? probe.trustState,
        identityHandshakeStrategy: probe.identityHandshakeMode,
        userIdentifierPolicy: probe.userUidPolicy
      };

      const added = registry.addServer(profile);
      if (!added) {
        addServerForm.value.errorMessage = `Server already added: ${serverId}`;
        return;
      }

      registry.setCapabilities(profile.serverId, capabilities);

      appUI.setActiveServer(profile.serverId);
      startupError.value = probe.warningMessage;
      isAddServerDialogOpen.value = false;
      await hydrateServerWithReachabilityHandling(profile.serverId);
    } catch (error) {
      addServerForm.value.errorMessage = (error as Error).message;
    } finally {
      addServerForm.value.isSubmitting = false;
    }
  }

  function setAddServerBackendUrl(value: string): void {
    addServerForm.value.backendUrl = value;
    addServerForm.value.discoveredServers = [];
    addServerForm.value.selectedDiscoveredServerId = "";
    addServerForm.value.probeSummary = null;
    addServerForm.value.probedCapabilities = null;
    addServerForm.value.errorMessage = null;
  }

  function setAddServerId(value: string): void {
    addServerForm.value.serverId = value;
    if (addServerForm.value.selectedDiscoveredServerId && addServerForm.value.selectedDiscoveredServerId !== value) {
      addServerForm.value.selectedDiscoveredServerId = "";
    }
    addServerForm.value.probeSummary = null;
    addServerForm.value.probedCapabilities = null;
    addServerForm.value.errorMessage = null;
  }

  function setAddServerDisplayName(value: string): void {
    addServerForm.value.displayName = value;
    addServerForm.value.errorMessage = null;
  }

  async function probeServerJoinTarget(): Promise<void> {
    await probeAddServerTarget();
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

  const updateButtonLabel = computed(() => {
    if (clientUpdate.status === "available") {
      return clientUpdate.latestVersion
        ? `Download update ${clientUpdate.latestVersion}`
        : "Download available update";
    }
    if (clientUpdate.status === "downloading") {
      return "Downloading update";
    }
    if (clientUpdate.status === "downloaded") {
      return "Install downloaded update";
    }
    if (clientUpdate.status === "error") {
      return "Retry update check";
    }
    return "Check for updates";
  });

  const updateButtonTitle = computed(() => {
    if (clientUpdate.status === "available") {
      return clientUpdate.latestVersion
        ? `Update ${clientUpdate.latestVersion} is available`
        : "An update is available";
    }
    if (clientUpdate.status === "downloading") {
      if (clientUpdate.progressPercent === null) {
        return "Downloading update...";
      }
      return `Downloading update... ${Math.round(clientUpdate.progressPercent)}%`;
    }
    if (clientUpdate.status === "downloaded") {
      return "Update downloaded. Click to install.";
    }
    if (clientUpdate.status === "error") {
      return clientUpdate.errorMessage ?? "Update failed. Click to retry.";
    }
    return "Check for updates";
  });

  const updateStatusLabel = computed(() => {
    if (clientUpdate.status === "idle") return "Idle";
    if (clientUpdate.status === "checking") return "Checking for updates";
    if (clientUpdate.status === "available") return "Update available";
    if (clientUpdate.status === "downloading") return "Downloading update";
    if (clientUpdate.status === "downloaded") return "Ready to install";
    return "Error";
  });

  const lastCheckedAtLabel = computed(() => {
    if (!clientUpdate.lastCheckedAt) return "Not checked yet";
    const parsed = new Date(clientUpdate.lastCheckedAt);
    if (Number.isNaN(parsed.getTime())) return clientUpdate.lastCheckedAt;
    return parsed.toLocaleString();
  });

  const taskbarProps = computed(() => ({
    serverIconText: activeServer.value?.iconText ?? "OC",
    serverName: activeServer.value?.displayName ?? "OpenChat Client",
    clientBuildVersion: appVersion.value,
    clientRuntimeLabel: runtimeLabel.value,
    showUpdateButton: clientUpdate.shouldShowTaskbarDownloadButton,
    updateButtonLabel: updateButtonLabel.value,
    updateButtonTitle: updateButtonTitle.value,
    updateButtonTone: clientUpdate.status === "error" ? ("error" as const) : ("default" as const),
    updateButtonDisabled: clientUpdate.status === "checking"
  }));

  const updateProgressModalStatus = computed<"downloading" | "downloaded" | "error">(() => {
    if (clientUpdate.status === "downloaded") return "downloaded";
    if (clientUpdate.status === "error") return "error";
    return "downloading";
  });

  const updateProgressModalProps = computed(() => ({
    isOpen: clientUpdate.isUpdateProgressModalOpen,
    status: updateProgressModalStatus.value,
    latestVersion: clientUpdate.latestVersion,
    progressPercent: clientUpdate.progressPercent,
    errorMessage: clientUpdate.errorMessage
  }));

  const versionInfoModalProps = computed(() => ({
    isOpen: clientUpdate.isVersionInfoModalOpen && clientUpdate.status !== "downloading",
    currentVersion: clientUpdate.currentVersion || appVersion.value,
    runtimeLabel: runtimeLabel.value,
    updateStatusLabel: updateStatusLabel.value,
    latestVersion: clientUpdate.latestVersion,
    lastCheckedAtLabel: lastCheckedAtLabel.value,
    githubUrl: clientUpdate.projectLinks.githubUrl,
    issuesUrl: clientUpdate.projectLinks.issuesUrl
  }));

  const updateNoticeBannerProps = computed(() => ({
    isVisible: clientUpdate.shouldShowUpdaterNotice,
    message: clientUpdate.updaterUnavailableReason ?? "Automatic updater is unavailable."
  }));

  const serverRailProps = computed(() => ({
    servers: registry.servers,
    activeServerId: appUI.activeServerId,
    unreadByServer: unreadByServer.value,
    mutedByServer: registry.servers.reduce<Record<string, boolean>>((summary, server) => {
      summary[server.serverId] = chat.serverMutedFor(server.serverId);
      return summary;
    }, {})
  }));

  const channelPaneProps = computed(() => ({
    serverName: activeServer.value?.displayName ?? "Unknown Server",
    serverBuildVersion: activeServer.value?.capabilities?.buildVersion ?? null,
    serverBuildCommit: activeServer.value?.capabilities?.buildCommit ?? null,
    groups: filteredChannelGroups.value,
    activeChannelId: appUI.activeChannelId,
    activeVoiceChannelId: activeVoiceChannelId.value,
    voiceParticipantsByChannel: activeVoiceParticipants.value,
    voiceSpeakingParticipantIdsByChannel: activeVoiceSpeakingParticipants.value,
    filterValue: appUI.channelFilter
  }));

  const userDockProps = computed(() => ({
    serverName: activeServer.value?.displayName ?? "Unknown Server",
    activeVoiceChannelName: activeVoiceChannelName.value,
    callState: activeCallSession.value?.state ?? "idle",
    callParticipantCount: activeCallSession.value?.participants.length ?? 0,
    callErrorMessage: activeCallSession.value?.errorMessage ?? null,
    cameraEnabled: activeCallSession.value?.cameraEnabled ?? false,
    screenShareEnabled: activeCallSession.value?.screenShareEnabled ?? false,
    canSendVideo: activeCallSession.value?.canSendVideo ?? true,
    canShareScreen: activeCallSession.value?.canShareScreen ?? true,
    cameraErrorMessage: activeCallSession.value?.cameraErrorMessage ?? null,
    screenShareErrorMessage: activeCallSession.value?.screenShareErrorMessage ?? null,
    localVoiceTransmitting: localVoiceTransmitting.value,
    micMuted: activeCallSession.value?.micMuted ?? activeServerAudioPrefs.value?.micMuted ?? false,
    deafened: activeCallSession.value?.deafened ?? activeServerAudioPrefs.value?.deafened ?? false,
    inputDevices: call.inputDevices,
    selectedInputDeviceId: call.selectedInputDeviceId,
    inputVolume: call.inputVolume,
    inputDeviceError: call.inputDeviceError,
    outputDevices: call.outputDevices,
    selectedOutputDeviceId: call.selectedOutputDeviceId,
    outputSelectionSupported: call.outputSelectionSupported,
    outputVolume: call.outputVolume,
    outputDeviceError: call.outputDeviceError,
    currentUid: activeSession.value?.userUID ?? "uid_unbound",
    profileDisplayName: identity.profileDisplayName,
    profileAvatarMode: identity.avatarMode,
    profileAvatarPresetId: identity.avatarPresetId,
    profileAvatarImageDataUrl: identity.avatarImageDataUrl,
    uidMode: identity.uidMode,
    disclosureMessage: identity.disclosureMessage,
    startupError: startupError.value
  }));

  const callStageProps = computed(() => ({
    serverName: activeServer.value?.displayName ?? "Unknown Server",
    selectedVoiceChannelName: selectedVoiceChannelName.value,
    connectedVoiceChannelName: activeVoiceChannelName.value,
    showLiveVideo: shouldShowCallStageVideo.value,
    helperMessage: callStageHelperMessage.value,
    callState: shouldShowCallStageVideo.value ? (activeCallSession.value?.state ?? "idle") : "idle",
    callParticipantCount: shouldShowCallStageVideo.value ? (activeCallSession.value?.participants.length ?? 0) : 0,
    activeSpeakerParticipantIds: shouldShowCallStageVideo.value ? (activeCallSession.value?.activeSpeakerParticipantIds ?? []) : [],
    participants: shouldShowCallStageVideo.value ? activeCallParticipantCards.value : [],
    videoStreams: shouldShowCallStageVideo.value ? activeCallVideoStreams.value : []
  }));

  const screenSharePickerProps = computed(() => ({
    isOpen: screenSharePicker.value.isOpen,
    isLoading: screenSharePicker.value.isLoading,
    errorMessage: screenSharePicker.value.errorMessage,
    targetChannelName: activeVoiceChannelName.value,
    sources: screenSharePicker.value.sources
  }));

  const workspaceToolbarProps = computed(() => ({
    activeChannelName: activeChannelName.value,
    serverName: activeServer.value?.displayName ?? "Unknown Server",
    membersPaneOpen: appUI.membersPaneOpen,
    connectionLabel: toolbarConnectionState.value.label,
    connectionTone: toolbarConnectionState.value.tone,
    connectionDetail: toolbarConnectionState.value.detail
  }));

  const chatPaneProps = computed(() => ({
    channelId: activeChannelName.value,
    messages: activeMessages.value,
    isLoadingMessages: isLoadingMessages.value,
    isSendingMessage: isSendingMessage.value,
    attachmentsEnabled: activeServer.value?.capabilities?.features.attachments ?? true,
    sendErrorMessage: messageSendError.value,
    maxMessageBytes: activeServer.value?.capabilities?.limits.maxMessageBytes ?? null,
    maxUploadBytes: activeServer.value?.capabilities?.limits.maxUploadBytes ?? 10 * 1024 * 1024,
    typingUsers: activeTypingUsers.value,
    currentUserUID: activeSession.value?.userUID ?? "",
    localProfileDisplayName: identity.profileDisplayName,
    localProfileAvatarMode: identity.avatarMode,
    localProfileAvatarPresetId: identity.avatarPresetId,
    localProfileAvatarImageDataUrl: identity.avatarImageDataUrl,
    remoteProfilesByUID: activeProfilesByUID.value
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
    isSubmitting: addServerForm.value.isSubmitting,
    discoveredServers: addServerForm.value.discoveredServers.map((server) => ({
      serverId: server.serverId,
      displayName: server.displayName,
      trustState: server.trustState,
      buildVersion: server.capabilities?.buildVersion ?? null,
      buildCommit: server.capabilities?.buildCommit ?? null
    })),
    selectedDiscoveredServerId: addServerForm.value.selectedDiscoveredServerId,
    probeSummary: addServerForm.value.probeSummary
  }));

  const serverRailListeners = {
    selectServer,
    addServer: openAddServerDialog,
    toggleServerMuted: (serverId: string) => {
      chat.toggleServerMuted(serverId);
    },
    leaveServer
  };

  const channelPaneListeners = {
    selectChannel,
    selectVoiceChannel,
    updateFilter: setChannelFilter,
    markChannelsRead
  };

  const userDockListeners = {
    toggleUidMode: cycleUIDMode,
    toggleMic,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    leaveVoiceChannel,
    openInputOptions,
    selectInputDevice,
    updateInputVolume,
    openOutputOptions,
    selectOutputDevice,
    updateOutputVolume
  };

  const workspaceToolbarListeners = {
    toggleMembersPane
  };

  const chatPaneListeners = {
    sendMessage,
    typingActivity: setTypingActivity
  };

  const membersPaneListeners = {
    close: closeMembersPane
  };

  const addServerDialogListeners = {
    close: closeAddServerDialog,
    discover: discoverServersFromURL,
    probe: probeServerJoinTarget,
    addManually: addServerManually,
    selectDiscoveredServer,
    "update:backendUrl": setAddServerBackendUrl,
    "update:serverId": setAddServerId,
    "update:displayName": setAddServerDisplayName
  };

  const screenSharePickerListeners = {
    close: closeScreenSharePicker,
    selectSource: selectScreenShareSource
  };

  const taskbarListeners = {
    updateAction: triggerTaskbarUpdateAction,
    showClientInfo: openVersionInfoModal
  };

  const versionInfoModalListeners = {
    close: closeVersionInfoModal,
    checkAgain: checkForUpdatesAgain
  };

  const updateProgressModalListeners = {
    close: closeUpdateProgressModal,
    retry: retryUpdateDownload,
    install: installDownloadedUpdate
  };

  const updateNoticeBannerListeners = {
    dismiss: dismissUpdaterNotice
  };

  return {
    appShellClasses,
    layoutClasses,
    taskbarProps,
    updateProgressModalProps,
    versionInfoModalProps,
    updateNoticeBannerProps,
    serverRailProps,
    channelPaneProps,
    workspaceToolbarProps,
    callStageVisible: isCallStageVisible,
    callStageProps,
    screenSharePickerProps,
    chatPaneProps,
    userDockProps,
    membersPaneProps,
    addServerDialogProps,
    taskbarListeners,
    versionInfoModalListeners,
    updateProgressModalListeners,
    updateNoticeBannerListeners,
    serverRailListeners,
    channelPaneListeners,
    userDockListeners,
    workspaceToolbarListeners,
    chatPaneListeners,
    membersPaneListeners,
    addServerDialogListeners,
    screenSharePickerListeners
  };
}
