<script setup lang="ts">
defineProps<{
  isOpen: boolean;
  backendUrl: string;
  serverId: string;
  displayName: string;
  errorMessage: string | null;
  isSubmitting: boolean;
}>();

const emit = defineEmits<{
  close: [];
  discover: [];
  addManually: [];
  "update:backendUrl": [value: string];
  "update:serverId": [value: string];
  "update:displayName": [value: string];
}>();
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="server-modal" role="dialog" aria-modal="true" aria-label="Add server">
      <header>
        <h3>Add Server</h3>
        <button type="button" class="server-modal-close" @click="emit('close')">Close</button>
      </header>

      <label class="server-modal-field">
        <span>Backend URL</span>
        <input
          type="text"
          :value="backendUrl"
          placeholder="http://localhost:8080"
          @input="emit('update:backendUrl', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <div class="server-modal-actions">
        <button type="button" class="server-modal-btn is-primary" :disabled="isSubmitting" @click="emit('discover')">
          {{ isSubmitting ? "Discovering..." : "Discover From Backend" }}
        </button>
      </div>

      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <div class="server-modal-divider" />

      <p class="server-modal-label">Manual Add</p>
      <label class="server-modal-field">
        <span>Server ID</span>
        <input
          type="text"
          :value="serverId"
          placeholder="srv_demo"
          @input="emit('update:serverId', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="server-modal-field">
        <span>Display Name</span>
        <input
          type="text"
          :value="displayName"
          placeholder="Demo Server"
          @input="emit('update:displayName', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <div class="server-modal-actions">
        <button type="button" class="server-modal-btn" :disabled="isSubmitting" @click="emit('addManually')">
          Add Manually
        </button>
      </div>
    </section>
  </div>
</template>
