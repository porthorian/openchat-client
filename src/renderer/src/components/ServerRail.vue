<script setup lang="ts">
import { mdiMessage, mdiPlus } from "@mdi/js";
import type { ServerProfile } from "@renderer/types/models";
import AppIcon from "./AppIcon.vue";

defineProps<{
  servers: ServerProfile[];
  activeServerId: string;
  unreadByServer: Record<string, number>;
}>();

const emit = defineEmits<{
  selectServer: [serverId: string];
  addServer: [];
}>();
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
      @click="server.serverId === activeServerId ? undefined : emit('selectServer', server.serverId)"
    >
      <span>{{ server.iconText }}</span>
      <span v-if="(unreadByServer[server.serverId] ?? 0) > 0" class="server-unread-badge">
        {{ unreadByServer[server.serverId] > 99 ? "99+" : unreadByServer[server.serverId] }}
      </span>
    </button>

    <button type="button" class="server-dot utility" aria-label="Add server" @click="emit('addServer')">
      <AppIcon :path="mdiPlus" :size="18" />
    </button>
  </aside>
</template>
