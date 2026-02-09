<script setup lang="ts">
import { mdiCogOutline, mdiHeadphones, mdiMicrophone, mdiPlus, mdiPound } from "@mdi/js";
import type { SessionStatus } from "@renderer/types/models";
import AppIcon from "./AppIcon.vue";

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

defineProps<{
  serverName: string;
  groups: ChannelGroup[];
  activeChannelId: string;
  filterValue: string;
  sessionStatus: SessionStatus;
}>();

const emit = defineEmits<{
  selectChannel: [channelId: string];
  updateFilter: [value: string];
  setSessionStatus: [status: SessionStatus];
}>();

const statusOptions: SessionStatus[] = ["active", "connecting", "expired", "disconnected"];
</script>

<template>
  <aside class="channel-pane">
    <header class="guild-header">
      <h2>{{ serverName }}</h2>
      <button type="button" class="guild-header-action">
        <AppIcon :path="mdiPlus" :size="14" />
      </button>
    </header>

    <label class="filter-row guild-filter">
      <span class="sr-only">Filter channels</span>
      <input
        type="text"
        :value="filterValue"
        placeholder="Filter channels"
        @input="emit('updateFilter', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <div class="channel-list">
      <section v-for="group in groups" :key="group.id" class="channel-group">
        <h3>{{ group.label }}</h3>
        <button
          v-for="channel in group.channels"
          :key="channel.id"
          type="button"
          class="channel-row"
          :class="{ 'is-active': channel.id === activeChannelId }"
          @click="emit('selectChannel', channel.id)"
        >
          <span class="channel-symbol">
            <AppIcon :path="mdiPound" :size="14" />
          </span>
          <span class="channel-name">{{ channel.name }}</span>
          <span v-if="channel.unreadCount > 0" class="badge">{{ channel.unreadCount }}</span>
        </button>
      </section>
    </div>

    <footer class="user-dock">
      <div class="avatar-pill">V</div>
      <div class="user-meta">
        <strong>V. Marone</strong>
        <small>Online</small>
      </div>
      <div class="user-actions">
        <button type="button">
          <AppIcon :path="mdiMicrophone" :size="16" />
        </button>
        <button type="button">
          <AppIcon :path="mdiHeadphones" :size="16" />
        </button>
        <button type="button">
          <AppIcon :path="mdiCogOutline" :size="16" />
        </button>
      </div>
      <div class="user-status">
        <span class="status-pill" :class="`is-${sessionStatus}`">{{ sessionStatus }}</span>
        <label>
          <span class="sr-only">Session status</span>
          <select
            :value="sessionStatus"
            @change="emit('setSessionStatus', ($event.target as HTMLSelectElement).value as SessionStatus)"
          >
            <option v-for="option in statusOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </label>
      </div>
    </footer>
  </aside>
</template>
