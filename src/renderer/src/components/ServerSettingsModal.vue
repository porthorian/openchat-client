<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useDialogFocus } from "@renderer/composables/useDialogFocus";

const props = defineProps<{
  isOpen: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  serverName: string;
  displayName: string;
  description: string;
  bannerPreset: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: { displayName: string; description: string; bannerPreset: string }];
}>();
const dialogElement = ref<HTMLElement | null>(null);
useDialogFocus(() => props.isOpen, dialogElement, () => emit("close"));

const draftDisplayName = ref("");
const draftDescription = ref("");
const draftBannerPreset = ref("");

const bannerPresets = [
  { id: "ocean", label: "Ocean" },
  { id: "sunset", label: "Sunset" },
  { id: "ember", label: "Ember" },
  { id: "forest", label: "Forest" },
  { id: "midnight", label: "Midnight" },
  { id: "orchid", label: "Orchid" },
  { id: "teal", label: "Teal" },
  { id: "gold", label: "Gold" },
  { id: "slate", label: "Slate" }
];

function initializeDraft(): void {
  draftDisplayName.value = props.displayName;
  draftDescription.value = props.description;
  draftBannerPreset.value = props.bannerPreset || "ocean";
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    initializeDraft();
  }
);

const canSubmit = computed(() => {
  return draftDisplayName.value.trim().length > 0 && !props.isLoading && !props.isSubmitting;
});

function submit(): void {
  if (!canSubmit.value) return;
  emit("submit", {
    displayName: draftDisplayName.value.trim(),
    description: draftDescription.value.trim(),
    bannerPreset: draftBannerPreset.value.trim().toLowerCase()
  });
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section ref="dialogElement" class="server-modal server-settings-modal" role="dialog" aria-modal="true" aria-label="Server settings" tabindex="-1">
      <header>
        <h3>Server Settings</h3>
        <button type="button" class="server-modal-close" :disabled="isSubmitting" @click="emit('close')">Close</button>
      </header>

      <div class="server-settings-body">
        <nav class="server-settings-tabs" aria-label="Server settings sections">
          <button type="button" class="server-settings-tab is-active">
            Server Profile
          </button>
        </nav>

        <section class="server-settings-panel">
          <template>
            <p class="create-channel-server">{{ serverName || "Current Server" }}</p>

            <label class="server-modal-field">
              <span>Name</span>
              <input v-model="draftDisplayName" type="text" maxlength="100" :disabled="isLoading || isSubmitting" />
            </label>

            <label class="server-modal-field">
              <span>Description</span>
              <textarea
                v-model="draftDescription"
                rows="4"
                maxlength="280"
                :disabled="isLoading || isSubmitting"
                placeholder="Tell people what this server is about."
              />
            </label>

            <label class="server-modal-field">
              <span>Banner</span>
              <select v-model="draftBannerPreset" :disabled="isLoading || isSubmitting">
                <option v-for="preset in bannerPresets" :key="preset.id" :value="preset.id">
                  {{ preset.label }}
                </option>
              </select>
            </label>
          </template>
        </section>
      </div>

      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <div class="server-modal-actions">
        <button type="button" class="server-modal-btn" :disabled="isSubmitting" @click="emit('close')">Cancel</button>
        <button type="button" class="server-modal-btn is-primary" :disabled="!canSubmit" @click="submit">
          {{ isSubmitting ? "Saving..." : "Save Changes" }}
        </button>
      </div>
    </section>
  </div>
</template>
