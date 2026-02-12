<script setup lang="ts">
import { mdiAccountMultiple, mdiMagnify, mdiMessageTextOutline, mdiPinOutline } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

defineProps<{
  activeChannelName: string;
  serverName: string;
  membersPaneOpen: boolean;
}>();

const emit = defineEmits<{
  toggleMembersPane: [];
}>();
</script>

<template>
  <header class="workspace-toolbar">
    <div class="chat-toolbar-left">
      <h2># {{ activeChannelName }}</h2>
      <span class="toolbar-divider" />
      <small>{{ serverName }}</small>
    </div>
    <div class="chat-toolbar-right">
      <button type="button" class="toolbar-icon">
        <AppIcon :path="mdiPinOutline" :size="18" />
      </button>
      <button type="button" class="toolbar-icon">
        <AppIcon :path="mdiMessageTextOutline" :size="18" />
      </button>
      <button type="button" class="toolbar-icon" :class="{ 'is-active': membersPaneOpen }" @click="emit('toggleMembersPane')">
        <AppIcon :path="mdiAccountMultiple" :size="18" />
      </button>
      <label class="toolbar-search-wrap">
        <AppIcon :path="mdiMagnify" :size="16" />
        <input type="text" class="toolbar-search" :placeholder="`Search ${serverName}`" />
      </label>
    </div>
  </header>
</template>
