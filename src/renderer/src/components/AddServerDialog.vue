<script setup lang="ts">
import { DEFAULT_BACKEND_URL } from "../services/serverRegistryClient";

type DiscoveredServerOption = {
  serverId: string;
  displayName: string;
  description: string;
};

type ServerJoinProbeSummary = {
  serverName: string;
  description: string;
  backendUrl: string;
  warningMessage: string | null;
  probedAt: string;
};

defineProps<{
  isOpen: boolean;
  backendUrl: string;
  errorMessage: string | null;
  isSubmitting: boolean;
  discoveredServers: DiscoveredServerOption[];
  selectedDiscoveredServerId: string;
  probeSummary: ServerJoinProbeSummary | null;
}>();

const emit = defineEmits<{
  close: [];
  discover: [];
  probe: [];
  addManually: [];
  selectDiscoveredServer: [serverId: string];
  "update:backendUrl": [value: string];
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
          :placeholder="DEFAULT_BACKEND_URL"
          @input="emit('update:backendUrl', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <div class="server-modal-actions">
        <button type="button" class="server-modal-btn is-primary" :disabled="isSubmitting" @click="emit('discover')">
          {{ isSubmitting ? "Discovering..." : "Discover Servers" }}
        </button>
      </div>

      <section v-if="discoveredServers.length > 0" class="server-discovery-list">
        <p class="server-modal-label">Discovered Servers</p>
        <button
          v-for="server in discoveredServers"
          :key="server.serverId"
          type="button"
          class="server-discovery-item"
          :class="{ 'is-active': server.serverId === selectedDiscoveredServerId }"
          @click="emit('selectDiscoveredServer', server.serverId)"
        >
          <span class="server-discovery-copy">
            <strong>{{ server.displayName }}</strong>
            <small>{{ server.description || "No description." }}</small>
          </span>
        </button>
      </section>

      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <div class="server-modal-actions">
        <button type="button" class="server-modal-btn" :disabled="isSubmitting" @click="emit('probe')">
          {{ isSubmitting ? "Probing..." : "Probe Backend" }}
        </button>
        <button type="button" class="server-modal-btn" :disabled="isSubmitting" @click="emit('addManually')">
          Add Server
        </button>
      </div>

      <section v-if="probeSummary" class="server-probe-summary">
        <header>
          <strong>{{ probeSummary.serverName }}</strong>
        </header>
        <p>{{ probeSummary.description || "No description." }}</p>
        <p>{{ probeSummary.backendUrl }}</p>
        <p v-if="probeSummary.warningMessage" class="server-probe-warning">{{ probeSummary.warningMessage }}</p>
      </section>
    </section>
  </div>
</template>
