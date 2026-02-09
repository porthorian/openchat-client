<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { RuntimeInfo } from "@shared/ipc";
import { useAppUIStore, useIdentityStore, useServerRegistryStore, useSessionStore } from "@renderer/stores";
import type { SessionStatus } from "@renderer/types/models";
import ServerRail from "./ServerRail.vue";
import ChannelPane from "./ChannelPane.vue";
import ChatPane from "./ChatPane.vue";

type Channel = {
  id: string;
  name: string;
  unreadCount: number;
};

type Message = {
  id: string;
  authorUID: string;
  body: string;
  sentAt: string;
};

const appUI = useAppUIStore();
const identity = useIdentityStore();
const registry = useServerRegistryStore();
const session = useSessionStore();

const runtime = ref<RuntimeInfo | null>(null);
const appVersion = ref<string>("0.0.0");

const channelsByServer: Record<string, Channel[]> = {
  srv_harbor: [
    { id: "ch_general", name: "general", unreadCount: 0 },
    { id: "ch_design", name: "design-review", unreadCount: 2 },
    { id: "ch_release", name: "release-ops", unreadCount: 0 }
  ],
  srv_arcade: [
    { id: "ch_general", name: "lobby", unreadCount: 1 },
    { id: "ch_tools", name: "tools", unreadCount: 4 },
    { id: "ch_ux", name: "ux-lab", unreadCount: 0 }
  ]
};

const messagesByChannel: Record<string, Message[]> = {
  ch_general: [
    {
      id: "msg_01",
      authorUID: "uid_21980f1c",
      body: "Server now advertises uid_only profile policy.",
      sentAt: "09:42"
    },
    {
      id: "msg_02",
      authorUID: "uid_23b65a11",
      body: "Updated join disclosure panel copy in the latest branch.",
      sentAt: "09:44"
    },
    {
      id: "msg_03",
      authorUID: "uid_97de1b44",
      body: "Ready for identity-mode review after lunch.",
      sentAt: "09:46"
    }
  ],
  ch_design: [
    {
      id: "msg_11",
      authorUID: "uid_5f7ac998",
      body: "Need clearer contrast for trust banners in unverified servers.",
      sentAt: "08:31"
    }
  ],
  ch_release: [
    {
      id: "msg_21",
      authorUID: "uid_3498bdc2",
      body: "Nightly package checks passed with zero disclosure regressions.",
      sentAt: "07:58"
    }
  ],
  ch_tools: [
    {
      id: "msg_31",
      authorUID: "uid_40aa13d0",
      body: "Pinia devtools integration is wired for local debugging.",
      sentAt: "10:02"
    }
  ],
  ch_ux: [
    {
      id: "msg_41",
      authorUID: "uid_9cc013af",
      body: "Prototype copy: 'Only UID + proof leaves this device.'",
      sentAt: "11:10"
    }
  ]
};

onMounted(async () => {
  identity.initializeIdentity();

  registry.servers.forEach((server) => {
    const projectedUID = identity.getUIDForServer(server.serverId);
    const existing = session.sessionsByServer[server.serverId];
    session.setSession(server.serverId, {
      status: existing?.status ?? "active",
      userUID: projectedUID,
      lastBoundAt: existing?.lastBoundAt ?? new Date().toISOString()
    });
  });

  appVersion.value = await window.openchat.getAppVersion();
  runtime.value = await window.openchat.getRuntimeInfo();
});

const activeServer = computed(() => registry.byId(appUI.activeServerId));
const activeSession = computed(() => session.sessionsByServer[appUI.activeServerId]);

const filteredChannels = computed(() => {
  const channels = channelsByServer[appUI.activeServerId] ?? [];
  const filter = appUI.channelFilter.trim().toLowerCase();
  if (!filter) return channels;
  return channels.filter((channel) => channel.name.toLowerCase().includes(filter));
});

const activeMessages = computed(() => {
  return messagesByChannel[appUI.activeChannelId] ?? [];
});

function selectServer(serverId: string): void {
  appUI.setActiveServer(serverId);
}

function selectChannel(channelId: string): void {
  appUI.setActiveChannel(channelId);
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
      lastBoundAt: existing?.lastBoundAt ?? new Date().toISOString()
    });
  });
}

function setSessionStatus(status: SessionStatus): void {
  session.setStatus(appUI.activeServerId, status);
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">OpenChat Client</p>
        <h1>Implementation Sandbox</h1>
      </div>
      <div class="runtime-pill">
        <span>v{{ appVersion }}</span>
        <span v-if="runtime">{{ runtime.platform }} / {{ runtime.arch }}</span>
      </div>
    </header>

    <section class="layout">
      <ServerRail
        :servers="registry.servers"
        :active-server-id="appUI.activeServerId"
        @select-server="selectServer"
      />

      <ChannelPane
        :server-name="activeServer?.displayName ?? 'Unknown Server'"
        :channels="filteredChannels"
        :active-channel-id="appUI.activeChannelId"
        :filter-value="appUI.channelFilter"
        @select-channel="selectChannel"
        @update-filter="setChannelFilter"
      />

      <ChatPane
        :server-name="activeServer?.displayName ?? 'Unknown Server'"
        :channel-id="appUI.activeChannelId"
        :messages="activeMessages"
        :session-status="activeSession?.status ?? 'disconnected'"
        :current-uid="activeSession?.userUID ?? 'uid_unbound'"
        :disclosure-message="identity.disclosureMessage"
        :uid-mode="identity.uidMode"
        @toggle-uid-mode="cycleUIDMode"
        @set-session-status="setSessionStatus"
      />
    </section>
  </div>
</template>
