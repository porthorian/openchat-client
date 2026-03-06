<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  isOpen: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  serverName: string;
  initialKind: "text" | "voice" | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: { name: string; kind: "text" | "voice" }];
}>();

const categoryName = ref("");
const categoryKind = ref<"text" | "voice">("text");

function initializeForm(): void {
  categoryName.value = "";
  categoryKind.value = props.initialKind ?? "text";
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    initializeForm();
  }
);

function setKind(kind: "text" | "voice"): void {
  categoryKind.value = kind;
}

function submit(): void {
  const name = categoryName.value.trim();
  if (!name) return;
  emit("submit", {
    name,
    kind: categoryKind.value
  });
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="server-modal create-channel-modal" role="dialog" aria-modal="true" aria-label="Create category">
      <header>
        <h3>Create Category</h3>
        <button type="button" class="server-modal-close" :disabled="isSubmitting" @click="emit('close')">Close</button>
      </header>

      <p class="create-channel-server">in {{ serverName || "Current Server" }}</p>

      <div class="create-channel-type-row">
        <button
          type="button"
          class="create-channel-type-btn"
          :class="{ 'is-active': categoryKind === 'text' }"
          :disabled="isSubmitting"
          @click="setKind('text')"
        >
          Text Category
        </button>
        <button
          type="button"
          class="create-channel-type-btn"
          :class="{ 'is-active': categoryKind === 'voice' }"
          :disabled="isSubmitting"
          @click="setKind('voice')"
        >
          Voice Category
        </button>
      </div>

      <label class="server-modal-field">
        <span>Category Name</span>
        <input
          v-model="categoryName"
          type="text"
          maxlength="100"
          placeholder="new-category"
          :disabled="isSubmitting"
          @keydown.enter.prevent="submit"
        />
      </label>

      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <div class="server-modal-actions">
        <button type="button" class="server-modal-btn" :disabled="isSubmitting" @click="emit('close')">Cancel</button>
        <button type="button" class="server-modal-btn is-primary" :disabled="isSubmitting || !categoryName.trim()" @click="submit">
          {{ isSubmitting ? "Creating..." : "Create Category" }}
        </button>
      </div>
    </section>
  </div>
</template>
