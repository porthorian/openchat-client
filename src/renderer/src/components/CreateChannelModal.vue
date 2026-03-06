<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChannelGroup, ChannelType } from "@renderer/types/chat";
import { selectCreateChannelDefaults } from "@renderer/stores/chat/channelGroups";

const props = defineProps<{
  isOpen: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  serverName: string;
  groups: ChannelGroup[];
  initialGroupId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: { name: string; type: ChannelType; groupId: string }];
}>();

const channelName = ref("");
const selectedType = ref<ChannelType>("text");
const selectedGroupId = ref("");

const availableTypeOptions = computed(() => {
  const available = new Set(props.groups.map((group) => group.kind));
  return {
    text: available.has("text"),
    voice: available.has("voice")
  };
});

const availableGroups = computed(() => {
  return props.groups.filter((group) => group.kind === selectedType.value);
});

function initializeForm(): void {
  const defaults = selectCreateChannelDefaults({
    groups: props.groups,
    initialGroupId: props.initialGroupId,
    initialType: "text"
  });
  selectedType.value = defaults.selectedType;
  selectedGroupId.value = defaults.selectedGroupId ?? "";
  channelName.value = "";
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    initializeForm();
  }
);

watch(
  () => selectedType.value,
  () => {
    const currentGroup = props.groups.find((group) => group.id === selectedGroupId.value);
    if (currentGroup?.kind === selectedType.value) return;
    selectedGroupId.value = availableGroups.value[0]?.id ?? "";
  }
);

function setType(nextType: ChannelType): void {
  if (nextType === selectedType.value) return;
  if (nextType === "text" && !availableTypeOptions.value.text) return;
  if (nextType === "voice" && !availableTypeOptions.value.voice) return;
  selectedType.value = nextType;
}

function submit(): void {
  const name = channelName.value.trim();
  const groupId = selectedGroupId.value.trim();
  if (!name || !groupId) return;
  emit("submit", {
    name,
    groupId,
    type: selectedType.value
  });
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="server-modal create-channel-modal" role="dialog" aria-modal="true" aria-label="Create channel">
      <header>
        <h3>Create Channel</h3>
        <button type="button" class="server-modal-close" :disabled="isSubmitting" @click="emit('close')">Close</button>
      </header>

      <p class="create-channel-server">in {{ serverName || "Current Server" }}</p>

      <div class="create-channel-type-row">
        <button
          type="button"
          class="create-channel-type-btn"
          :class="{ 'is-active': selectedType === 'text' }"
          :disabled="!availableTypeOptions.text"
          @click="setType('text')"
        >
          # Text
        </button>
        <button
          type="button"
          class="create-channel-type-btn"
          :class="{ 'is-active': selectedType === 'voice' }"
          :disabled="!availableTypeOptions.voice"
          @click="setType('voice')"
        >
          Voice
        </button>
      </div>

      <label class="server-modal-field">
        <span>Category</span>
        <select v-model="selectedGroupId" :disabled="isSubmitting || availableGroups.length === 0">
          <option value="" disabled>Select category</option>
          <option v-for="group in availableGroups" :key="group.id" :value="group.id">
            {{ group.label }}
          </option>
        </select>
      </label>

      <label class="server-modal-field">
        <span>Channel Name</span>
        <input
          v-model="channelName"
          type="text"
          maxlength="100"
          placeholder="new-channel"
          :disabled="isSubmitting"
          @keydown.enter.prevent="submit"
        />
      </label>

      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <div class="server-modal-actions">
        <button type="button" class="server-modal-btn" :disabled="isSubmitting" @click="emit('close')">Cancel</button>
        <button
          type="button"
          class="server-modal-btn is-primary"
          :disabled="isSubmitting || !channelName.trim() || !selectedGroupId"
          @click="submit"
        >
          {{ isSubmitting ? "Creating..." : "Create Channel" }}
        </button>
      </div>
    </section>
  </div>
</template>
