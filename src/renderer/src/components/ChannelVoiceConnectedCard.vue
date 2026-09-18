<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { mdiAccessPoint, mdiMonitorShare, mdiPhoneHangup, mdiVideo } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  serverName: string;
  activeVoiceChannelName: string | null;
  callState: "idle" | "joining" | "active" | "reconnecting" | "error";
  callParticipantCount: number;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  cameraAvailable: boolean;
  screenShareAvailable: boolean;
  cameraErrorMessage?: string | null;
  screenShareErrorMessage?: string | null;
  callErrorMessage?: string | null;
  canRetry: boolean;
  receiveOnly: boolean;
  reconnectAttempt: number;
  reconnectPhase: "waiting" | "attempting" | null;
  nextRetryAt: number | null;
}>();

const emit = defineEmits<{
  leave: [];
  retry: [];
  toggleCamera: [];
  toggleScreenShare: [];
}>();

const isVoiceConnected = computed(() => props.callState === "active" && Boolean(props.activeVoiceChannelName));
const shouldShow = computed(() => props.callState !== "idle" || Boolean(props.activeVoiceChannelName));
const canToggleMedia = computed(() => props.callState === "active");
const statusErrorMessage = computed(() => {
  return props.cameraErrorMessage ?? props.screenShareErrorMessage ?? props.callErrorMessage ?? null;
});
const countdownNow = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | null = null;

watch(
  () => [props.callState, props.reconnectPhase, props.nextRetryAt],
  () => {
    if (countdownTimer !== null) clearInterval(countdownTimer);
    countdownTimer = null;
    countdownNow.value = Date.now();
    if (typeof window !== "undefined" && props.callState === "reconnecting" && props.reconnectPhase === "waiting" && props.nextRetryAt !== null) {
      countdownTimer = setInterval(() => { countdownNow.value = Date.now(); }, 250);
    }
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  if (countdownTimer !== null) clearInterval(countdownTimer);
});

const retryCountdown = computed(() => {
  if (props.callState !== "reconnecting" || props.reconnectPhase !== "waiting" || props.nextRetryAt === null) return null;
  const seconds = Math.max(0, Math.ceil((props.nextRetryAt - countdownNow.value) / 1_000));
  return seconds > 0 ? `Retry ${props.reconnectAttempt} of 5 in ${seconds}s` : `Retry ${props.reconnectAttempt} of 5 now`;
});

const voiceConnectedTitle = computed(() => {
  switch (props.callState) {
    case "active":
      return props.receiveOnly ? "Receive-only call" : "Voice Connected";
    case "joining":
      return "Connecting...";
    case "reconnecting":
      if (props.reconnectPhase === "waiting") return `Waiting to retry ${props.reconnectAttempt} of 5`;
      if (props.reconnectPhase === "attempting") return `Trying ${props.reconnectAttempt} of 5`;
      return "Reconnecting...";
    case "error":
      return "Call failed";
    default:
      return "Voice Idle";
  }
});
</script>

<template>
  <section
    v-if="shouldShow"
    class="voice-connected-card"
    :class="{
      'is-active': isVoiceConnected,
      'is-joining': callState === 'joining' || callState === 'reconnecting',
      'is-error': callState === 'error'
    }"
  >
    <header class="voice-connected-header">
      <div class="voice-connected-copy">
        <span class="voice-connected-icon">
          <AppIcon :path="mdiAccessPoint" :size="15" />
        </span>
        <div class="voice-connected-text" role="status" aria-live="polite" aria-atomic="true">
          <strong>{{ voiceConnectedTitle }}</strong>
          <small>
            {{ activeVoiceChannelName ?? "No active voice channel" }} / {{ serverName }}
            <span v-if="callParticipantCount > 0"> · {{ callParticipantCount }} online</span>
          </small>
        </div>
      </div>

      <div class="voice-connected-header-actions">
        <button type="button" class="voice-connected-header-btn is-danger" aria-label="Leave voice channel" @click="emit('leave')">
          <AppIcon :path="mdiPhoneHangup" :size="16" />
        </button>
      </div>
    </header>

    <p v-if="retryCountdown" class="voice-connected-retry-countdown" aria-hidden="true">{{ retryCountdown }}</p>

    <div class="voice-connected-actions">
      <button v-if="callState === 'error' && canRetry" type="button" class="voice-connected-action-btn" @click="emit('retry')">
        Retry
      </button>
      <button
        type="button"
        class="voice-connected-action-btn"
        :class="{ 'is-active': cameraEnabled }"
        :disabled="!cameraAvailable || !canToggleMedia"
        :aria-label="cameraEnabled ? 'Disable camera' : 'Enable camera'"
        @click="emit('toggleCamera')"
      >
        <AppIcon :path="mdiVideo" :size="16" />
      </button>
      <button
        type="button"
        class="voice-connected-action-btn"
        :class="{ 'is-active': screenShareEnabled }"
        :disabled="!screenShareAvailable || !canToggleMedia"
        :aria-label="screenShareEnabled ? 'Stop screen share' : 'Start screen share'"
        @click="emit('toggleScreenShare')"
      >
        <AppIcon :path="mdiMonitorShare" :size="16" />
      </button>
    </div>

    <p v-if="statusErrorMessage" class="voice-connected-error" role="alert">{{ statusErrorMessage }}</p>
  </section>
</template>
