<script setup lang="ts">
import { mdiMicrophone, mdiMicrophoneOff, mdiHeadphones, mdiHeadphonesOff, mdiPhoneHangup } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

defineProps<{
  activeVoiceChannelName: string | null;
  callState: "idle" | "joining" | "active" | "reconnecting" | "error";
  participantCount: number;
  micMuted: boolean;
  deafened: boolean;
  errorMessage: string | null;
}>();

const emit = defineEmits<{
  toggleMic: [];
  toggleDeafen: [];
  leaveCall: [];
}>();
</script>

<template>
  <section class="call-bar">
    <div class="call-bar-primary">
      <strong v-if="activeVoiceChannelName">Voice: {{ activeVoiceChannelName }}</strong>
      <strong v-else>No active voice channel</strong>
      <span class="call-state-chip" :class="`is-${callState}`">{{ callState }}</span>
      <small v-if="participantCount > 0">{{ participantCount }} participant{{ participantCount === 1 ? "" : "s" }}</small>
      <small v-else>Waiting for participants</small>
    </div>

    <div class="call-bar-actions">
      <button type="button" class="call-control" :disabled="callState !== 'active'" @click="emit('toggleMic')">
        <AppIcon :path="micMuted ? mdiMicrophoneOff : mdiMicrophone" :size="16" />
        <span>{{ micMuted ? "Unmute" : "Mute" }}</span>
      </button>
      <button type="button" class="call-control" :disabled="callState !== 'active'" @click="emit('toggleDeafen')">
        <AppIcon :path="deafened ? mdiHeadphonesOff : mdiHeadphones" :size="16" />
        <span>{{ deafened ? "Undeafen" : "Deafen" }}</span>
      </button>
      <button type="button" class="call-control is-danger" :disabled="callState === 'idle'" @click="emit('leaveCall')">
        <AppIcon :path="mdiPhoneHangup" :size="16" />
        <span>Leave</span>
      </button>
    </div>

    <p v-if="errorMessage" class="call-error">{{ errorMessage }}</p>
  </section>
</template>
