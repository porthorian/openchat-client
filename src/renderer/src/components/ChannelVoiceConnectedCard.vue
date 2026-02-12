<script setup lang="ts">
import { computed } from "vue";
import { mdiAccessPoint, mdiMonitorShare, mdiPhoneHangup, mdiVideo } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  serverName: string;
  activeVoiceChannelName: string | null;
  callState: "idle" | "joining" | "active" | "reconnecting" | "error";
  callParticipantCount: number;
  callErrorMessage?: string | null;
}>();

const emit = defineEmits<{
  leave: [];
}>();

const isVoiceConnected = computed(() => props.callState === "active" && Boolean(props.activeVoiceChannelName));
const shouldShow = computed(() => props.callState !== "idle" || Boolean(props.activeVoiceChannelName));

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
      <button type="button" class="voice-connected-action-btn" aria-label="Share screen">
        <AppIcon :path="mdiVideo" :size="16" />
      </button>
      <button type="button" class="voice-connected-action-btn" aria-label="Share screen">
        <AppIcon :path="mdiMonitorShare" :size="16" />
      </button>
    </div>

    <p v-if="callErrorMessage" class="voice-connected-error">{{ callErrorMessage }}</p>
  </section>
</template>
