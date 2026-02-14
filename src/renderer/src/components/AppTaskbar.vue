<script setup lang="ts">
import { mdiArrowLeft, mdiArrowRight, mdiBellOutline, mdiDownload } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

defineProps<{
  serverIconText: string;
  serverName: string;
  clientBuildVersion: string;
  clientRuntimeLabel: string;
}>();
</script>

<template>
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
      <span class="taskbar-guild-pill">{{ serverIconText }}</span>
      <div class="taskbar-center-copy">
        <strong>{{ serverName }}</strong>
        <small class="taskbar-build">build {{ clientBuildVersion }} · {{ clientRuntimeLabel }}</small>
      </div>
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
</template>
