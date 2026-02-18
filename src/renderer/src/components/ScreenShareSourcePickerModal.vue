<script setup lang="ts">
import { computed, ref } from "vue";
import type { DesktopCaptureSource } from "@shared/ipc";

const emit = defineEmits<{
  close: [];
  selectSource: [sourceId: string];
}>();

type SourceTab = "applications" | "entire-screen" | "devices";

const activeTab = ref<SourceTab>("applications");

const props = defineProps<{
  isOpen: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  targetChannelName: string | null;
  sources: DesktopCaptureSource[];
}>();

const applicationSources = computed(() => props.sources.filter((source) => source.kind === "window"));
const screenSources = computed(() => props.sources.filter((source) => source.kind === "screen"));

const visibleSources = computed(() => {
  if (activeTab.value === "applications") return applicationSources.value;
  if (activeTab.value === "entire-screen") return screenSources.value;
  return [];
});
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

      <nav class="screen-share-source-tabs" aria-label="Screen share source categories">
        <button
          type="button"
          class="screen-share-source-tab"
          :class="{ 'is-active': activeTab === 'applications' }"
          @click="activeTab = 'applications'"
        >
          Applications
          <span>{{ applicationSources.length }}</span>
        </button>
        <button
          type="button"
          class="screen-share-source-tab"
          :class="{ 'is-active': activeTab === 'entire-screen' }"
          @click="activeTab = 'entire-screen'"
        >
          Entire Screen
          <span>{{ screenSources.length }}</span>
        </button>
        <button
          type="button"
          class="screen-share-source-tab"
          :class="{ 'is-active': activeTab === 'devices' }"
          @click="activeTab = 'devices'"
        >
          Devices
          <span>0</span>
        </button>
      </nav>

      <p v-if="isLoading" class="screen-share-picker-status">Loading capture sources...</p>
      <p
        v-else-if="activeTab !== 'devices' && visibleSources.length === 0"
        class="screen-share-picker-status"
      >
        No sources available for this category.
      </p>
      <p v-else-if="activeTab === 'devices'" class="screen-share-picker-status">
        Camera and external input sources are not available yet.
      </p>
      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <section v-if="activeTab !== 'devices' && visibleSources.length > 0" class="screen-share-source-grid">
        <button
          v-for="source in visibleSources"
          :key="source.id"
          type="button"
          class="screen-share-source-card"
          @click="emit('selectSource', source.id)"
        >
          <div class="screen-share-source-thumb" :class="{ 'is-empty': !source.thumbnailDataUrl }">
            <img v-if="source.thumbnailDataUrl" :src="source.thumbnailDataUrl" alt="" />
            <span v-else>{{ source.kind === "screen" ? "Screen" : "Window" }}</span>
          </div>
          <div class="screen-share-source-card-copy">
            <strong>{{ source.name.trim() || (source.kind === "screen" ? "Screen Source" : "Application Window") }}</strong>
            <small>{{ source.kind === "screen" ? "Entire Screen" : "Application Window" }}</small>
            <small class="screen-share-source-id">{{ source.id.trim() || "unknown-source-id" }}</small>
          </div>
          <img v-if="source.appIconDataUrl" class="screen-share-source-icon" :src="source.appIconDataUrl" alt="" />
        </button>
      </section>
    </section>
  </div>
</template>
