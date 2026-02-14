import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { RuntimeInfo } from "@shared/ipc";
import type { Channel, ChannelGroup } from "@renderer/types/chat";
import type { ServerCapabilities } from "@renderer/types/capabilities";
import type { ServerProfile } from "@renderer/types/models";
import { DEFAULT_BACKEND_URL, fetchServerDirectory } from "@renderer/services/serverRegistryClient";
import { fetchServerCapabilities } from "@renderer/services/rtcClient";
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
  userUidPolicy: ServerCapabilities["userUidPolicy"];
  identityHandshakeMode: ServerProfile["identityHandshakeStrategy"];
  messagingEnabled: boolean;
  presenceEnabled: boolean;
  rtcEnabled: boolean;
  warningMessage: string | null;
  probedAt: string;
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
    isSubmitting: false,
    discoveredServers: [],
    selectedDiscoveredServerId: "",
    probeSummary: null,
    probedCapabilities: null
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
  const activeRealtimeState = computed(() => chat.realtimeStateFor(appUI.activeServerId));

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
      names.push(toDisplayName(userUID));
    });
    return names;
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

  const activeVoiceSpeakingParticipants = computed<Record<string, string[]>>(() => {
    const byChannel: Record<string, string[]> = {};
    if (!activeVoiceChannelId.value) return byChannel;
    const speakingIds = activeCallSession.value?.activeSpeakerParticipantIds ?? [];
    if (speakingIds.length === 0) return byChannel;
    byChannel[activeVoiceChannelId.value] = [...speakingIds];
    return byChannel;
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
        chat.markChannelRead(targetChannelID);
      }
    } finally {
      isHydrating.value = false;
    }
  }

  onMounted(async () => {
    identity.initializeIdentity();
    registry.hydrateFromStorage();
    void call.refreshInputDevices();
    void call.refreshOutputDevices();
    try {
      appVersion.value = await window.openchat.getAppVersion();
      runtime.value = await window.openchat.getRuntimeInfo();
    } catch (error) {
      startupError.value = `Desktop runtime bridge unavailable: ${(error as Error).message}`;
    }

    try {
      if (registry.servers.length === 0) {
        await registry.hydrateFromBackend();
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
    chat.markChannelRead(channelId);
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
    chat.markChannelRead(appUI.activeChannelId);
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

  function toIconText(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return "SV";
    return normalized.slice(0, 2);
  }

  function normalizeBackendURL(value: string): string {
    return value.trim().replace(/\/$/, "");
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
      const discovered = await fetchServerDirectory(backendUrl);
      if (discovered.length === 0) {
        addServerForm.value.errorMessage = `No servers available at ${backendUrl}/v1/servers`;
        addServerForm.value.discoveredServers = [];
        addServerForm.value.selectedDiscoveredServerId = "";
        addServerForm.value.probedCapabilities = null;
        return;
      }

      addServerForm.value.discoveredServers = discovered;
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
      await hydrateServer(profile.serverId);
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

  const taskbarProps = computed(() => ({
    serverIconText: activeServer.value?.iconText ?? "OC",
    serverName: activeServer.value?.displayName ?? "OpenChat Client"
  }));

  const serverRailProps = computed(() => ({
    servers: registry.servers,
    activeServerId: appUI.activeServerId,
    unreadByServer: unreadByServer.value
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
    inputDevices: call.inputDevices,
    selectedInputDeviceId: call.selectedInputDeviceId,
    inputVolume: call.inputVolume,
    inputDeviceError: call.inputDeviceError,
    outputDevices: call.outputDevices,
    selectedOutputDeviceId: call.selectedOutputDeviceId,
    outputSelectionSupported: call.outputSelectionSupported,
    outputVolume: call.outputVolume,
    outputDeviceError: call.outputDeviceError,
    callErrorMessage: activeCallSession.value?.errorMessage ?? null,
    voiceParticipantsByChannel: activeVoiceParticipants.value,
    voiceSpeakingParticipantIdsByChannel: activeVoiceSpeakingParticipants.value,
    localVoiceTransmitting: localVoiceTransmitting.value,
    filterValue: appUI.channelFilter,
    currentUid: activeSession.value?.userUID ?? "uid_unbound",
    profileDisplayName: identity.profileDisplayName,
    profileAvatarMode: identity.avatarMode,
    profileAvatarPresetId: identity.avatarPresetId,
    profileAvatarImageDataUrl: identity.avatarImageDataUrl,
    disclosureMessage: identity.disclosureMessage,
    uidMode: identity.uidMode,
    appVersion: appVersion.value,
    runtimeLabel: runtimeLabel.value,
    startupError: startupError.value
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
    typingUsers: activeTypingUsers.value
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
    discoveredServers: addServerForm.value.discoveredServers,
    selectedDiscoveredServerId: addServerForm.value.selectedDiscoveredServerId,
    probeSummary: addServerForm.value.probeSummary
  }));

  const serverRailListeners = {
    selectServer,
    addServer: openAddServerDialog
  };

  const channelPaneListeners = {
    selectChannel,
    selectVoiceChannel,
    updateFilter: setChannelFilter,
    markChannelsRead,
    toggleUidMode: cycleUIDMode,
    toggleMic,
    toggleDeafen,
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
