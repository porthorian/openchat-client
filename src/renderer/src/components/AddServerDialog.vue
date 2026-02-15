<script setup lang="ts">
import { DEFAULT_BACKEND_URL } from "../services/serverRegistryClient";

type DiscoveredServerOption = {
  serverId: string;
  displayName: string;
  trustState: "verified" | "unverified";
  buildVersion: string | null;
  buildCommit: string | null;
};

type ServerJoinProbeSummary = {
  serverId: string;
  serverName: string;
  backendUrl: string;
  trustState: "verified" | "unverified";
  buildVersion: string | null;
  buildCommit: string | null;
  userUidPolicy: "server_scoped" | "global" | "either";
  identityHandshakeMode: "challenge_signature" | "token_proof";
  messagingEnabled: boolean;
  presenceEnabled: boolean;
  rtcEnabled: boolean;
  warningMessage: string | null;
  probedAt: string;
};

defineProps<{
  isOpen: boolean;
  backendUrl: string;
  serverId: string;
  displayName: string;
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
  "update:serverId": [value: string];
  "update:displayName": [value: string];
}>();

function formatBuildLabel(buildVersion: string | null, buildCommit: string | null): string {
  const versionLabel = buildVersion?.trim() || "unknown";
  const commitValue = buildCommit?.trim() || "unknown";
  const commitLabel = commitValue.length > 12 ? commitValue.slice(0, 12) : commitValue;
  return `${versionLabel} · ${commitLabel}`;
}
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
            <small>{{ server.serverId }}</small>
            <small class="server-discovery-build">Build {{ formatBuildLabel(server.buildVersion, server.buildCommit) }}</small>
          </span>
          <span class="server-trust-pill" :class="`is-${server.trustState}`">
            {{ server.trustState === "verified" ? "Verified" : "Unverified" }}
          </span>
        </button>
      </section>

      <p v-if="errorMessage" class="server-modal-error">{{ errorMessage }}</p>

      <div class="server-modal-divider" />

      <p class="server-modal-label">Server Details</p>
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
          <span class="server-trust-pill" :class="`is-${probeSummary.trustState}`">
            {{ probeSummary.trustState === "verified" ? "Verified" : "Unverified" }}
          </span>
        </header>
        <p>{{ probeSummary.backendUrl }}</p>
        <p class="server-probe-build">Build: {{ formatBuildLabel(probeSummary.buildVersion, probeSummary.buildCommit) }}</p>
        <p>UID policy: {{ probeSummary.userUidPolicy }} · Handshake: {{ probeSummary.identityHandshakeMode }}</p>
        <p>
          Features:
          {{ probeSummary.messagingEnabled ? "Messaging" : "No messaging" }},
          {{ probeSummary.presenceEnabled ? "Presence" : "No presence" }},
          {{ probeSummary.rtcEnabled ? "RTC" : "No RTC" }}
        </p>
        <p v-if="probeSummary.warningMessage" class="server-probe-warning">{{ probeSummary.warningMessage }}</p>
      </section>
    </section>
  </div>
</template>
