<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  isOpen: boolean;
  status: "downloading" | "downloaded" | "error";
  latestVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
}>();

const emit = defineEmits<{
  close: [];
  retry: [];
  install: [];
}>();

const displayPercent = computed(() => {
  if (props.progressPercent === null) return null;
  const value = Math.round(props.progressPercent);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
});

const progressStyle = computed(() => {
  if (displayPercent.value === null) return undefined;
  return {
    width: `${displayPercent.value}%`
  };
});

const modalTitle = computed(() => {
  if (props.status === "downloaded") return "Update downloaded";
  if (props.status === "error") return "Update failed";
  return "Downloading update";
});

const statusMessage = computed(() => {
  if (props.status === "downloaded") {
    return props.latestVersion
      ? `OpenChat ${props.latestVersion} is ready to install.`
      : "The latest OpenChat update is ready to install.";
  }
  if (props.status === "error") {
    return "OpenChat could not complete the update download.";
  }
  return props.latestVersion ? `Preparing OpenChat ${props.latestVersion}` : "Preparing latest OpenChat build";
});
</script>

<template>
  <div v-if="isOpen" class="update-progress-backdrop" role="presentation">
    <section class="update-progress-modal" role="dialog" aria-modal="true" aria-label="Downloading client update">
      <h3>{{ modalTitle }}</h3>
      <p>{{ statusMessage }}</p>

      <div
        v-if="status !== 'error'"
        class="update-progress-track"
        role="progressbar"
        aria-label="Update download progress"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="displayPercent ?? undefined"
      >
        <div class="update-progress-fill" :class="{ 'is-indeterminate': displayPercent === null }" :style="progressStyle" />
      </div>

      <strong v-if="status === 'downloading'" class="update-progress-value">
        {{ displayPercent === null ? "Downloading..." : `${displayPercent}%` }}
      </strong>

      <p v-if="status === 'error'" class="update-progress-error">
        {{ errorMessage ?? "No error details are available." }}
      </p>

      <p class="update-progress-footnote">
        {{
          status === "downloaded"
            ? "Restart and install when you are ready."
            : status === "error"
              ? "You can retry the download now."
              : "Keep OpenChat open while the update is downloading."
        }}
      </p>

      <footer class="update-progress-actions">
        <button v-if="status === 'error'" type="button" class="update-progress-btn is-primary" @click="emit('retry')">Retry download</button>
        <button v-if="status === 'downloaded'" type="button" class="update-progress-btn is-primary" @click="emit('install')">
          Restart and install
        </button>
        <button
          v-if="status === 'error' || status === 'downloaded'"
          type="button"
          class="update-progress-btn"
          @click="emit('close')"
        >
          Later
        </button>
      </footer>
    </section>
  </div>
</template>
