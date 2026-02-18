<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from "vue";
import type { CallVideoStreamKind } from "@renderer/stores/call";

const props = defineProps<{
  stream: MediaStream;
  label: string;
  kind: CallVideoStreamKind;
  isLocal: boolean;
  isSpeaking: boolean;
  isPinned: boolean;
}>();

const emit = defineEmits<{
  togglePin: [];
}>();

const videoRef = ref<HTMLVideoElement | null>(null);

const kindLabel = computed(() => (props.kind === "screen" ? "Screen Share" : "Camera"));
const mirrorVideo = computed(() => props.isLocal && props.kind === "camera");

function bindVideoStream(mediaStream: MediaStream | null): void {
  const videoElement = videoRef.value;
  if (!videoElement) return;
  if (videoElement.srcObject === mediaStream) return;
  videoElement.srcObject = mediaStream;
  void videoElement.play().catch(() => {});
}

watchEffect(() => {
  bindVideoStream(props.stream);
});

onBeforeUnmount(() => {
  if (!videoRef.value) return;
  videoRef.value.srcObject = null;
});
</script>

<template>
  <article class="call-video-tile" :class="{ 'is-speaking': isSpeaking, 'is-local': isLocal, 'is-pinned': isPinned }">
    <video ref="videoRef" class="call-video-feed" :class="{ 'is-mirrored': mirrorVideo }" autoplay playsinline :muted="isLocal" />
    <button type="button" class="call-video-pin-btn" @click.stop="emit('togglePin')">
      {{ isPinned ? "Unpin" : "Pin" }}
    </button>
    <div class="call-video-meta">
      <strong>{{ label }}</strong>
      <small>{{ kindLabel }}</small>
    </div>
  </article>
</template>
