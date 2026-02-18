<script setup lang="ts">
import type { DesktopCaptureSource } from "@shared/ipc";

defineProps<{
  isOpen: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  targetChannelName: string | null;
  sources: DesktopCaptureSource[];
}>();

const emit = defineEmits<{
  close: [];
  selectSource: [sourceId: string];
}>();
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="server-modal screen-share-picker-modal" role="dialog" aria-modal="true" aria-label="Choose a screen to share">
      <header>
        <h3>Share Your Screen</h3>
        <button type="button" class="server-modal-close" @click="emit('close')">Close</button>
      </header>

      <p class="screen-share-picker-subtitle">
        {{ targetChannelName ? `Select what to share in ${targetChannelName}` : "Select a screen or window to share" }}
      </p>

      <p v-if="isLoading" class="screen-share-picker-status">Loading capture sources...</p>
      <p v-else-if="sources.length === 0" class="screen-share-picker-status">No capture sources available.</p>
      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <section v-if="sources.length > 0" class="screen-share-source-list">
        <button
          v-for="source in sources"
          :key="source.id"
          type="button"
          class="screen-share-source-item"
          @click="emit('selectSource', source.id)"
        >
          <div class="screen-share-source-thumb" :class="{ 'is-empty': !source.thumbnailDataUrl }">
            <img v-if="source.thumbnailDataUrl" :src="source.thumbnailDataUrl" alt="" />
            <span v-else>{{ source.kind === "screen" ? "Screen" : "Window" }}</span>
          </div>
          <div class="screen-share-source-copy">
            <strong>{{ source.name }}</strong>
            <small>{{ source.kind === "screen" ? "Screen" : "Window" }}</small>
          </div>
          <img v-if="source.appIconDataUrl" class="screen-share-source-icon" :src="source.appIconDataUrl" alt="" />
        </button>
      </section>
    </section>
  </div>
</template>
