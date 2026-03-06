<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
const rtcLogPrefix = "[openchat:rtc]";
const rtcDebugEnabled = (() => {
  const envValue = String(import.meta.env.VITE_OPENCHAT_RTC_DEBUG ?? "")
    .trim()
    .toLowerCase();
  if (envValue === "1" || envValue === "true" || envValue === "yes" || envValue === "on") {
    return true;
  }
  if (envValue === "0" || envValue === "false" || envValue === "no" || envValue === "off") {
    return false;
  }
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("openchat:rtc-debug") === "1";
  } catch (_error) {
    return false;
  }
})();

function rtcLog(event: string, payload: Record<string, unknown>): void {
  if (!rtcDebugEnabled || typeof console === "undefined") return;
  console.debug(rtcLogPrefix, event, payload);
}

function tryPlayVideo(videoElement: HTMLVideoElement): void {
  if (!videoElement.srcObject) return;
  void videoElement.play().catch(() => {});
}

function bindVideoStream(mediaStream: MediaStream | null): void {
  const videoElement = videoRef.value;
  if (!videoElement) return;

  // Video tile audio is never used. Audio playback is handled by the call store PCM pipeline.
  videoElement.muted = true;
  videoElement.volume = 0;

  if (videoElement.srcObject !== mediaStream) {
    videoElement.srcObject = mediaStream;
    const track = mediaStream?.getVideoTracks()[0] ?? null;
    rtcLog("video.element.bind", {
      label: props.label,
      isLocal: props.isLocal,
      kind: props.kind,
      streamId: mediaStream?.id ?? null,
      trackId: track?.id ?? null,
      trackLabel: track?.label ?? null,
      trackMuted: track?.muted ?? null,
      trackReadyState: track?.readyState ?? null
    });
  }
  if (!mediaStream) return;
  tryPlayVideo(videoElement);
}

watch(
  () => props.stream,
  (stream) => {
    bindVideoStream(stream);
  },
  { immediate: true }
);

onMounted(() => {
  const videoElement = videoRef.value;
  if (!videoElement) return;
  videoElement.onloadedmetadata = () => {
    rtcLog("video.element.loadedmetadata", {
      label: props.label,
      isLocal: props.isLocal,
      kind: props.kind,
      readyState: videoElement.readyState,
      videoWidth: videoElement.videoWidth,
      videoHeight: videoElement.videoHeight
    });
    tryPlayVideo(videoElement);
  };
  videoElement.oncanplay = () => {
    rtcLog("video.element.canplay", {
      label: props.label,
      isLocal: props.isLocal,
      kind: props.kind,
      readyState: videoElement.readyState,
      videoWidth: videoElement.videoWidth,
      videoHeight: videoElement.videoHeight
    });
    tryPlayVideo(videoElement);
  };
  videoElement.onplaying = () => {
    rtcLog("video.element.playing", {
      label: props.label,
      isLocal: props.isLocal,
      kind: props.kind,
      readyState: videoElement.readyState,
      videoWidth: videoElement.videoWidth,
      videoHeight: videoElement.videoHeight
    });
  };
  videoElement.onstalled = () => {
    rtcLog("video.element.stalled", {
      label: props.label,
      isLocal: props.isLocal,
      kind: props.kind,
      readyState: videoElement.readyState
    });
  };
  videoElement.onwaiting = () => {
    rtcLog("video.element.waiting", {
      label: props.label,
      isLocal: props.isLocal,
      kind: props.kind,
      readyState: videoElement.readyState
    });
  };
  videoElement.onerror = () => {
    rtcLog("video.element.error", {
      label: props.label,
      isLocal: props.isLocal,
      kind: props.kind,
      readyState: videoElement.readyState,
      error: videoElement.error?.message ?? null
    });
    tryPlayVideo(videoElement);
  };
  bindVideoStream(props.stream);
});

onBeforeUnmount(() => {
  if (!videoRef.value) return;
  videoRef.value.onloadedmetadata = null;
  videoRef.value.oncanplay = null;
  videoRef.value.onplaying = null;
  videoRef.value.onstalled = null;
  videoRef.value.onwaiting = null;
  videoRef.value.onerror = null;
  videoRef.value.srcObject = null;
});
</script>

<template>
  <article class="call-video-tile" :class="{ 'is-speaking': isSpeaking, 'is-local': isLocal, 'is-pinned': isPinned }">
    <video ref="videoRef" class="call-video-feed" :class="{ 'is-mirrored': mirrorVideo }" autoplay playsinline muted />
    <button type="button" class="call-video-pin-btn" @click.stop="emit('togglePin')">
      {{ isPinned ? "Unpin" : "Pin" }}
    </button>
    <div class="call-video-meta">
      <strong>{{ label }}</strong>
      <small>{{ kindLabel }}</small>
    </div>
  </article>
</template>
