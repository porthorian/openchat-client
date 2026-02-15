<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { mdiChevronRight, mdiMessage, mdiPlus } from "@mdi/js";
import type { ServerProfile } from "@renderer/types/models";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  servers: ServerProfile[];
  activeServerId: string;
  unreadByServer: Record<string, number>;
  mutedByServer: Record<string, boolean>;
}>();

const emit = defineEmits<{
  selectServer: [serverId: string];
  addServer: [];
  toggleServerMuted: [serverId: string];
}>();

type ServerContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  serverId: string;
};

const serverContextMenu = ref<ServerContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  serverId: ""
});

const selectedContextServer = computed(() => {
  if (!serverContextMenu.value.serverId) return null;
  return props.servers.find((server) => server.serverId === serverContextMenu.value.serverId) ?? null;
});
const selectedContextServerMuted = computed(() => {
  if (!selectedContextServer.value) return false;
  return props.mutedByServer[selectedContextServer.value.serverId] ?? false;
});

function closeServerContextMenu(): void {
  serverContextMenu.value.open = false;
  serverContextMenu.value.serverId = "";
}

function openServerContextMenu(serverId: string, event: MouseEvent): void {
  event.preventDefault();
  const menuWidth = 236;
  const menuHeight = 438;
  const boundedX = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
  const boundedY = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));

  serverContextMenu.value = {
    open: true,
    x: boundedX,
    y: boundedY,
    serverId
  };
}

function handleSelectServer(serverId: string): void {
  closeServerContextMenu();
  if (serverId === props.activeServerId) return;
  emit("selectServer", serverId);
}

function runServerContextAction(): void {
  closeServerContextMenu();
}

function toggleServerMuted(): void {
  const serverId = serverContextMenu.value.serverId;
  if (!serverId) return;
  emit("toggleServerMuted", serverId);
  closeServerContextMenu();
}

function onWindowPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".server-context-menu") && !target?.closest(".server-dot")) {
    closeServerContextMenu();
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeServerContextMenu();
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("keydown", onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowKeydown);
});
</script>

<template>
  <aside class="server-rail">
    <button type="button" class="server-dot app-home is-active">
      <AppIcon :path="mdiMessage" :size="20" />
    </button>
    <div class="server-divider"></div>
    <button
      v-for="server in servers"
      :key="server.serverId"
      type="button"
      class="server-dot"
      :class="{
        'is-active': server.serverId === activeServerId,
        'is-unverified': server.trustState === 'unverified'
      }"
      @click="handleSelectServer(server.serverId)"
      @contextmenu.prevent="openServerContextMenu(server.serverId, $event)"
    >
      <span>{{ server.iconText }}</span>
      <span v-if="(unreadByServer[server.serverId] ?? 0) > 0" class="server-unread-badge">
        {{ unreadByServer[server.serverId] > 99 ? "99+" : unreadByServer[server.serverId] }}
      </span>
    </button>

    <button type="button" class="server-dot utility" aria-label="Add server" @click="emit('addServer')">
      <AppIcon :path="mdiPlus" :size="18" />
    </button>

    <section
      v-if="serverContextMenu.open"
      class="server-context-menu"
      role="menu"
      aria-label="Server actions"
      :style="{ left: `${serverContextMenu.x}px`, top: `${serverContextMenu.y}px` }"
    >
      <button type="button" class="server-context-item" role="menuitem" @click="runServerContextAction">Mark As Read</button>

      <div class="server-context-divider" />

      <button type="button" class="server-context-item" role="menuitem" @click="runServerContextAction">Invite to Server</button>

      <div class="server-context-divider" />

      <button
        type="button"
        class="server-context-item"
        role="menuitemcheckbox"
        :aria-checked="selectedContextServerMuted"
        @click="toggleServerMuted"
      >
        {{ selectedContextServerMuted ? "Unmute Server" : "Mute Server" }}
      </button>
      <button type="button" class="server-context-item" role="menuitem" @click="runServerContextAction">
        <span class="server-context-copy">
          Notification Settings
          <small>Only @mentions</small>
        </span>
        <span class="server-context-trailing">
          <AppIcon :path="mdiChevronRight" :size="14" />
        </span>
      </button>
      <button type="button" class="server-context-item" role="menuitemcheckbox" aria-checked="false" @click="runServerContextAction">
        Hide Muted Channels
        <span class="server-context-checkbox" aria-hidden="true" />
      </button>

      <div class="server-context-divider" />

      <div class="server-context-submenu-wrap">
        <button type="button" class="server-context-item" role="menuitem" @click="runServerContextAction">
          Server Settings
          <span class="server-context-trailing">
            <AppIcon :path="mdiChevronRight" :size="14" />
          </span>
        </button>
        <section class="server-context-submenu" role="menu" aria-label="Server settings actions">
          <button type="button" class="server-context-subitem" role="menuitem" @click="runServerContextAction">Server Profile</button>
          <button type="button" class="server-context-subitem" role="menuitem" @click="runServerContextAction">Engagement</button>
          <button type="button" class="server-context-subitem" role="menuitem" @click="runServerContextAction">Emoji</button>
          <button type="button" class="server-context-subitem" role="menuitem" @click="runServerContextAction">Stickers</button>
          <button type="button" class="server-context-subitem" role="menuitem" @click="runServerContextAction">Soundboard</button>
        </section>
      </div>
      <button type="button" class="server-context-item" role="menuitem" @click="runServerContextAction">Privacy Settings</button>
      <button type="button" class="server-context-item" role="menuitem" @click="runServerContextAction">Edit Per-server Profile</button>

      <div class="server-context-divider" />

      <button type="button" class="server-context-item" role="menuitem" @click="runServerContextAction">Create Event</button>

      <div class="server-context-divider" />

      <button type="button" class="server-context-item is-danger" role="menuitem" @click="runServerContextAction">Leave Server</button>
      <p v-if="selectedContextServer" class="server-context-caption">{{ selectedContextServer.displayName }}</p>
    </section>
  </aside>
</template>
