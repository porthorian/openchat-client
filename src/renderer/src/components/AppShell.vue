<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
import { useAppUIStore, useIdentityStore, useServerRegistryStore, useSessionStore } from "@renderer/stores";
import type { SessionStatus } from "@renderer/types/models";
import AppIcon from "./AppIcon.vue";
import ServerRail from "./ServerRail.vue";
import ChannelPane from "./ChannelPane.vue";
import ChatPane from "./ChatPane.vue";
import MembersPane from "./MembersPane.vue";

type Channel = {
  id: string;
  name: string;
  unreadCount: number;
};

type ChannelGroup = {
  id: string;
  label: string;
  channels: Channel[];
};

type Message = {
  id: string;
  authorUID: string;
  body: string;
  sentAt: string;
};

type MemberItem = {
  id: string;
  name: string;
  status: "online" | "idle" | "dnd";
};

const appUI = useAppUIStore();
const identity = useIdentityStore();
const registry = useServerRegistryStore();
const session = useSessionStore();
const isMacOS = /mac/i.test(window.navigator.userAgent);

const runtime = ref<RuntimeInfo | null>(null);
const appVersion = ref<string>("0.0.0");

const channelsByServer: Record<string, ChannelGroup[]> = {
  srv_harbor: [
    {
      id: "grp_general",
      label: "shipposting",
      channels: [
        { id: "ch_general", name: "pornography", unreadCount: 0 },
        { id: "ch_design", name: "memes", unreadCount: 2 },
        { id: "ch_release", name: "bedtime-stories", unreadCount: 0 },
        { id: "ch_jeans", name: "jeansposting", unreadCount: 0 }
      ]
    },
    {
      id: "grp_media",
      label: "media",
      channels: [
        { id: "ch_public", name: "public-clown-services", unreadCount: 0 },
        { id: "ch_jobs", name: "get-a-job", unreadCount: 0 }
      ]
    },
    {
      id: "grp_gaming",
      label: "gaming",
      channels: [
        { id: "ch_video", name: "videogames", unreadCount: 5 },
        { id: "ch_minecraft", name: "minecraft", unreadCount: 0 },
        { id: "ch_ttrpg", name: "ttrpg", unreadCount: 0 }
      ]
    }
  ],
  srv_arcade: [
    {
      id: "grp_lobby",
      label: "lobby",
      channels: [
        { id: "ch_general", name: "welcome-desk", unreadCount: 1 },
        { id: "ch_tools", name: "tooling", unreadCount: 4 },
        { id: "ch_ux", name: "ux-lab", unreadCount: 0 }
      ]
    },
    {
      id: "grp_ops",
      label: "operations",
      channels: [
        { id: "ch_release", name: "release-notes", unreadCount: 0 },
        { id: "ch_public", name: "outage-watch", unreadCount: 0 }
      ]
    }
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
  ],
  ch_jeans: [
    {
      id: "msg_51",
      authorUID: "uid_13bd88fe",
      body: "New texture pass for denim emotes is now in staging.",
      sentAt: "12:12"
    }
  ],
  ch_public: [
    {
      id: "msg_61",
      authorUID: "uid_72cae900",
      body: "Public endpoint health checks are all green.",
      sentAt: "13:31"
    }
  ],
  ch_jobs: [
    {
      id: "msg_71",
      authorUID: "uid_0a31fd67",
      body: "Hiring workflow docs moved to the handbook channel.",
      sentAt: "14:20"
    }
  ],
  ch_video: [
    {
      id: "msg_81",
      authorUID: "uid_49de7aa5",
      body: "Tonight: Halo Infinite private lobby at 9 PM.",
      sentAt: "16:09"
    }
  ],
  ch_minecraft: [
    {
      id: "msg_91",
      authorUID: "uid_2f90a8ec",
      body: "Server seed rotation complete. Backups verified.",
      sentAt: "17:16"
    }
  ],
  ch_ttrpg: [
    {
      id: "msg_101",
      authorUID: "uid_3ef12ab0",
      body: "Session notes synced, next run starts Friday.",
      sentAt: "18:42"
    }
  ]
};

const membersByServer: Record<string, MemberItem[]> = {
  srv_harbor: [
    { id: "mem_1", name: "Lyra", status: "online" },
    { id: "mem_2", name: "Orin", status: "idle" },
    { id: "mem_3", name: "Mira", status: "online" },
    { id: "mem_4", name: "Calix", status: "online" },
    { id: "mem_5", name: "Sable", status: "dnd" },
    { id: "mem_6", name: "Tamsin", status: "idle" }
  ],
  srv_arcade: [
    { id: "mem_11", name: "Aster", status: "online" },
    { id: "mem_12", name: "Nyla", status: "idle" },
    { id: "mem_13", name: "Pearl", status: "online" }
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

const filteredChannelGroups = computed(() => {
  const groups = channelsByServer[appUI.activeServerId] ?? [];
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
  return messagesByChannel[appUI.activeChannelId] ?? [];
});

const activeMembers = computed(() => {
  return membersByServer[appUI.activeServerId] ?? [];
});

const activeChannelName = computed(() => {
  const groups = channelsByServer[appUI.activeServerId] ?? [];
  for (const group of groups) {
    const match = group.channels.find((channel) => channel.id === appUI.activeChannelId);
    if (match) return match.name;
  }
  return appUI.activeChannelId.replace("ch_", "");
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

function toggleMembersPane(): void {
  appUI.toggleMembersPane();
}

function closeMembersPane(): void {
  appUI.setMembersPaneOpen(false);
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
      />

      <ChannelPane
        :server-name="activeServer?.displayName ?? 'Unknown Server'"
        :groups="filteredChannelGroups"
        :active-channel-id="appUI.activeChannelId"
        :filter-value="appUI.channelFilter"
        :session-status="activeSession?.status ?? 'disconnected'"
        @select-channel="selectChannel"
        @update-filter="setChannelFilter"
        @set-session-status="setSessionStatus"
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
        :current-uid="activeSession?.userUID ?? 'uid_unbound'"
        :disclosure-message="identity.disclosureMessage"
        :uid-mode="identity.uidMode"
        :app-version="appVersion"
        :runtime-label="runtime ? `${runtime.platform} / ${runtime.arch}` : 'runtime pending'"
        @toggle-uid-mode="cycleUIDMode"
      />

      <MembersPane
        class="members-pane-slot"
        :members="activeMembers"
        :is-open="appUI.membersPaneOpen"
        @close="closeMembersPane"
      />
    </section>
  </div>
</template>
