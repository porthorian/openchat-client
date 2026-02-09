<script setup lang="ts">
import type { ServerProfile } from "@renderer/types/models";

defineProps<{
  servers: ServerProfile[];
  activeServerId: string;
}>();

const emit = defineEmits<{
  selectServer: [serverId: string];
}>();
</script>

<template>
  <aside class="server-rail panel">
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
  </aside>
</template>
