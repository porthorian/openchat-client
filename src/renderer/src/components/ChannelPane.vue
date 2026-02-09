<script setup lang="ts">
type Channel = {
  id: string;
  name: string;
  unreadCount: number;
};

defineProps<{
  serverName: string;
  channels: Channel[];
  activeChannelId: string;
  filterValue: string;
}>();

const emit = defineEmits<{
  selectChannel: [channelId: string];
  updateFilter: [value: string];
}>();
</script>

<template>
  <aside class="channel-pane panel">
    <header class="pane-header">
      <h2>{{ serverName }}</h2>
      <small>channels</small>
    </header>

    <label class="filter-row">
      <span class="sr-only">Filter channels</span>
      <input
        type="text"
        :value="filterValue"
        placeholder="Filter channels"
        @input="emit('updateFilter', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <div class="channel-list">
      <button
        v-for="channel in channels"
        :key="channel.id"
        type="button"
        class="channel-row"
        :class="{ 'is-active': channel.id === activeChannelId }"
        @click="emit('selectChannel', channel.id)"
      >
        <span># {{ channel.name }}</span>
        <span v-if="channel.unreadCount > 0" class="badge">{{ channel.unreadCount }}</span>
      </button>
    </div>
  </aside>
</template>
