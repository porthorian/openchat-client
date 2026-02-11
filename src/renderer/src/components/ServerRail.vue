<script setup lang="ts">
import { mdiHelpCircleOutline, mdiMessage, mdiPlus } from "@mdi/js";
import type { ServerProfile } from "@renderer/types/models";
import AppIcon from "./AppIcon.vue";

defineProps<{
  servers: ServerProfile[];
  activeServerId: string;
}>();

const emit = defineEmits<{
  selectServer: [serverId: string];
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
      @click="emit('selectServer', server.serverId)"
    >
      {{ server.iconText }}
    </button>

    <button type="button" class="server-dot utility">
      <AppIcon :path="mdiPlus" :size="18" />
    </button>
  </aside>
</template>
