<script setup lang="ts">
import { computed } from "vue";
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
}>();

const emit = defineEmits<{
  leave: [];
  toggleCamera: [];
  toggleScreenShare: [];
}>();

const isVoiceConnected = computed(() => props.callState === "active" && Boolean(props.activeVoiceChannelName));
const shouldShow = computed(() => props.callState !== "idle" || Boolean(props.activeVoiceChannelName));
const canToggleMedia = computed(() => props.callState === "active");
const statusErrorMessage = computed(() => {
  return props.cameraErrorMessage ?? props.screenShareErrorMessage ?? props.callErrorMessage ?? null;
});

const voiceConnectedTitle = computed(() => {
  switch (props.callState) {
    case "active":
      return "Voice Connected";
    case "joining":
      return "Connecting...";
    case "reconnecting":
      return "Reconnecting...";
    case "error":
      return "Voice Error";
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
        <div class="voice-connected-text">
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

    <div class="voice-connected-actions">
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

    <p v-if="statusErrorMessage" class="voice-connected-error">{{ statusErrorMessage }}</p>
  </section>
</template>
