<script setup lang="ts">
import { computed, ref, watch } from "vue";

type SettingsTabID = "profile" | "engagement" | "moderation" | "integrations";

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

const activeTab = ref<SettingsTabID>("profile");
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
  activeTab.value = "profile";
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
    <section class="server-modal server-settings-modal" role="dialog" aria-modal="true" aria-label="Server settings">
      <header>
        <h3>Server Settings</h3>
        <button type="button" class="server-modal-close" :disabled="isSubmitting" @click="emit('close')">Close</button>
      </header>

      <div class="server-settings-body">
        <nav class="server-settings-tabs" aria-label="Server settings sections">
          <button type="button" class="server-settings-tab" :class="{ 'is-active': activeTab === 'profile' }" @click="activeTab = 'profile'">
            Server Profile
          </button>
          <button
            type="button"
            class="server-settings-tab"
            :class="{ 'is-active': activeTab === 'engagement' }"
            @click="activeTab = 'engagement'"
          >
            Engagement
          </button>
          <button
            type="button"
            class="server-settings-tab"
            :class="{ 'is-active': activeTab === 'moderation' }"
            @click="activeTab = 'moderation'"
          >
            Moderation
          </button>
          <button
            type="button"
            class="server-settings-tab"
            :class="{ 'is-active': activeTab === 'integrations' }"
            @click="activeTab = 'integrations'"
          >
            Integrations
          </button>
        </nav>

        <section class="server-settings-panel">
          <template v-if="activeTab === 'profile'">
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
          <template v-else>
            <p class="server-settings-placeholder">This section is planned for the next server settings iteration.</p>
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
