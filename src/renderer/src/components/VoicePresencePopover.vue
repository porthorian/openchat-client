<script setup lang="ts">
import { computed } from "vue";
import { mdiDeleteOutline, mdiDotsGrid } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

type VoiceMood = "chilling" | "gaming" | "studying" | "brb" | "watching stuff";

type VoiceParticipant = {
  id: string;
  name: string;
  avatarText: string;
  avatarColor: string;
  mood: VoiceMood;
  badgeEmoji?: string;
};

const props = defineProps<{
  open: boolean;
  x: number;
  y: number;
  participant: VoiceParticipant | null;
}>();

const emit = defineEmits<{
  mouseenter: [];
  mouseleave: [];
}>();

const moodOrder: VoiceMood[] = ["chilling", "gaming", "studying", "brb", "watching stuff"];
const moodCatalog: Record<VoiceMood, { label: string; icon: string }> = {
  chilling: { label: "chilling", icon: "🛋️" },
  gaming: { label: "gaming", icon: "🎮" },
  studying: { label: "studying", icon: "📘" },
  brb: { label: "brb", icon: "🍽️" },
  "watching stuff": { label: "watching stuff", icon: "🍿" }
};

const currentMood = computed(() => props.participant?.mood ?? null);

function moodLabel(mood: VoiceMood): string {
  return moodCatalog[mood].label;
}

function moodIcon(mood: VoiceMood): string {
  return moodCatalog[mood].icon;
}
</script>

<template>
  <div
    v-if="open && participant"
    class="voice-presence-popover"
    role="dialog"
    aria-label="Voice presence details"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @mouseenter="emit('mouseenter')"
    @mouseleave="emit('mouseleave')"
  >
    <div class="voice-presence-current">
      <div class="voice-presence-pill">
        <span class="voice-presence-emoji">{{ moodIcon(participant.mood) }}</span>
        <span>{{ moodLabel(participant.mood) }}</span>
      </div>

      <div class="voice-presence-actions">
        <button type="button" aria-label="Clear status">
          <AppIcon :path="mdiDeleteOutline" :size="14" />
        </button>
        <button type="button" aria-label="More status options">
          <AppIcon :path="mdiDotsGrid" :size="14" />
        </button>
      </div>
    </div>

    <button
      v-for="mood in moodOrder"
      :key="mood"
      type="button"
      class="voice-presence-option"
      :class="{ 'is-active': mood === currentMood }"
    >
      <span class="voice-presence-emoji">{{ moodIcon(mood) }}</span>
      <span>{{ moodLabel(mood) }}</span>
    </button>
  </div>
</template>
