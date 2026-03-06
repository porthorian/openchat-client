<script setup lang="ts">
import { mdiClose } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  isOpen: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  serverName: string;
  categoryName: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="server-modal delete-category-modal" role="dialog" aria-modal="true" aria-label="Delete category">
      <header class="delete-category-modal-header">
        <h3>Delete Category</h3>
        <button type="button" class="delete-category-modal-close" :disabled="isSubmitting" aria-label="Close" @click="emit('close')">
          <AppIcon :path="mdiClose" :size="18" />
        </button>
      </header>

      <p class="delete-category-modal-copy">
        Are you sure you want to delete <strong>{{ categoryName || "this category" }}</strong> in
        {{ serverName || "Current Server" }}?
        <br />
        This cannot be undone.
      </p>

      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <div class="server-modal-actions delete-category-modal-actions">
        <button type="button" class="server-modal-btn delete-category-modal-cancel" :disabled="isSubmitting" @click="emit('close')">
          Cancel
        </button>
        <button type="button" class="server-modal-btn is-danger" :disabled="isSubmitting" @click="emit('submit')">
          {{ isSubmitting ? "Deleting..." : "Delete Category" }}
        </button>
      </div>
    </section>
  </div>
</template>
