<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  isOpen: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  serverName: string;
  initialName: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: { name: string }];
}>();

const categoryName = ref("");

function initializeForm(): void {
  categoryName.value = props.initialName;
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    initializeForm();
  }
);

function submit(): void {
  const name = categoryName.value.trim();
  if (!name) return;
  emit("submit", { name });
}
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="server-modal create-channel-modal" role="dialog" aria-modal="true" aria-label="Rename category">
      <header>
        <h3>Edit Category</h3>
        <button type="button" class="server-modal-close" :disabled="isSubmitting" @click="emit('close')">Close</button>
      </header>

      <p class="create-channel-server">in {{ serverName || "Current Server" }}</p>

      <label class="server-modal-field">
        <span>Category Name</span>
        <input
          v-model="categoryName"
          type="text"
          maxlength="100"
          placeholder="category-name"
          :disabled="isSubmitting"
          @keydown.enter.prevent="submit"
        />
      </label>

      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <div class="server-modal-actions">
        <button type="button" class="server-modal-btn" :disabled="isSubmitting" @click="emit('close')">Cancel</button>
        <button type="button" class="server-modal-btn is-primary" :disabled="isSubmitting || !categoryName.trim()" @click="submit">
          {{ isSubmitting ? "Saving..." : "Save" }}
        </button>
      </div>
    </section>
  </div>
</template>
