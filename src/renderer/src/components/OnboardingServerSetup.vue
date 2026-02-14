<script setup lang="ts">
import { computed, ref } from "vue";
import { DEFAULT_BACKEND_URL, fetchServerDirectory } from "@renderer/services/serverRegistryClient";
import { fetchServerCapabilities } from "@renderer/services/rtcClient";
import type { ServerCapabilities } from "@renderer/types/capabilities";
import type { ServerProfile } from "@renderer/types/models";

type ServerSetupMode = "join" | "create";

type ServerSetupResult = {
  profile: ServerProfile;
  capabilities: ServerCapabilities | null;
};

type ProbeSummary = {
  serverId: string;
  serverName: string;
  backendUrl: string;
  trustState: ServerProfile["trustState"];
  userUidPolicy: ServerCapabilities["userUidPolicy"];
  identityHandshakeMode: ServerProfile["identityHandshakeStrategy"];
  messagingEnabled: boolean;
  presenceEnabled: boolean;
  rtcEnabled: boolean;
  warningMessage: string | null;
  probedAt: string;
};

const emit = defineEmits<{
  complete: [payload: ServerSetupResult];
}>();

const mode = ref<ServerSetupMode>("join");
const backendUrl = ref(DEFAULT_BACKEND_URL);
const serverId = ref("");
const displayName = ref("");
const errorMessage = ref<string | null>(null);
const isSubmitting = ref(false);
const discoveredServers = ref<ServerProfile[]>([]);
const selectedDiscoveredServerId = ref("");
const probeSummary = ref<ProbeSummary | null>(null);
const probedCapabilities = ref<ServerCapabilities | null>(null);

const selectedDiscoveredServer = computed(() => {
  const selectedId = selectedDiscoveredServerId.value;
  if (!selectedId) return null;
  return discoveredServers.value.find((server) => server.serverId === selectedId) ?? null;
});

function normalizeBackendURL(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function toIconText(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "SV";
  return normalized.slice(0, 2);
}

function isLikelyLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function resolveTrustWarning(targetBackendUrl: string, capabilities: ServerCapabilities): string | null {
  let parsedURL: URL;
  try {
    parsedURL = new URL(targetBackendUrl);
  } catch (_error) {
    return "Backend URL is invalid.";
  }

  const insecureScheme = parsedURL.protocol !== "https:";
  const localhost = isLikelyLocalhost(parsedURL);

  if (capabilities.security.httpsRequired && insecureScheme && !localhost) {
    return "Server requires HTTPS. Update the backend URL to an HTTPS endpoint.";
  }

  if (insecureScheme && !localhost) {
    return "Connection is not HTTPS. Network operators and server admins may inspect traffic metadata.";
  }

  return null;
}

function toHandshakeStrategy(capabilities: ServerCapabilities): ServerProfile["identityHandshakeStrategy"] {
  if (capabilities.identityHandshakeModes.includes("challenge_signature")) {
    return "challenge_signature";
  }
  return "token_proof";
}

function setMode(nextMode: ServerSetupMode): void {
  mode.value = nextMode;
  errorMessage.value = null;
}

function setBackendUrl(value: string): void {
  backendUrl.value = value;
  discoveredServers.value = [];
  selectedDiscoveredServerId.value = "";
  probeSummary.value = null;
  probedCapabilities.value = null;
  errorMessage.value = null;
}

function setServerId(value: string): void {
  serverId.value = value;
  if (selectedDiscoveredServerId.value && selectedDiscoveredServerId.value !== value) {
    selectedDiscoveredServerId.value = "";
  }
  probeSummary.value = null;
  probedCapabilities.value = null;
  errorMessage.value = null;
}

function setDisplayName(value: string): void {
  displayName.value = value;
  errorMessage.value = null;
}

function chooseDiscoveredServer(value: string): void {
  const selected = discoveredServers.value.find((server) => server.serverId === value);
  if (!selected) return;
  selectedDiscoveredServerId.value = selected.serverId;
  serverId.value = selected.serverId;
  displayName.value = selected.displayName;
  probeSummary.value = null;
  probedCapabilities.value = null;
  errorMessage.value = null;
}

async function discoverServers(): Promise<void> {
  const targetBackendUrl = normalizeBackendURL(backendUrl.value);
  if (!targetBackendUrl) {
    errorMessage.value = "Backend URL is required.";
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = null;
  try {
    const discovered = await fetchServerDirectory(targetBackendUrl);
    if (discovered.length === 0) {
      errorMessage.value = `No servers available at ${targetBackendUrl}/v1/servers`;
      discoveredServers.value = [];
      selectedDiscoveredServerId.value = "";
      return;
    }
    discoveredServers.value = discovered;
    chooseDiscoveredServer(discovered[0].serverId);
  } catch (error) {
    errorMessage.value = (error as Error).message;
    discoveredServers.value = [];
    selectedDiscoveredServerId.value = "";
  } finally {
    isSubmitting.value = false;
  }
}

async function probeJoinTarget(manageSubmitting = true): Promise<ProbeSummary | null> {
  const targetBackendUrl = normalizeBackendURL(backendUrl.value);
  if (!targetBackendUrl) {
    errorMessage.value = "Backend URL is required.";
    return null;
  }

  const discovered = selectedDiscoveredServer.value;
  const trustState = discovered?.trustState ?? "unverified";
  if (manageSubmitting) {
    isSubmitting.value = true;
  }
  errorMessage.value = null;
  try {
    const capabilities = await fetchServerCapabilities(targetBackendUrl);
    const summary: ProbeSummary = {
      serverId: capabilities.serverId,
      serverName: capabilities.serverName,
      backendUrl: targetBackendUrl,
      trustState,
      userUidPolicy: capabilities.userUidPolicy,
      identityHandshakeMode: toHandshakeStrategy(capabilities),
      messagingEnabled: capabilities.features.messaging,
      presenceEnabled: capabilities.features.presence,
      rtcEnabled: capabilities.rtc !== null,
      warningMessage: resolveTrustWarning(targetBackendUrl, capabilities),
      probedAt: new Date().toISOString()
    };
    probeSummary.value = summary;
    probedCapabilities.value = capabilities;
    if (!serverId.value.trim()) {
      serverId.value = summary.serverId;
    }
    if (!displayName.value.trim()) {
      displayName.value = summary.serverName;
    }
    return summary;
  } catch (error) {
    errorMessage.value = (error as Error).message;
    probeSummary.value = null;
    probedCapabilities.value = null;
    return null;
  } finally {
    if (manageSubmitting) {
      isSubmitting.value = false;
    }
  }
}

async function completeJoin(): Promise<void> {
  const targetBackendUrl = normalizeBackendURL(backendUrl.value);
  if (!targetBackendUrl) {
    errorMessage.value = "Backend URL is required.";
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = null;
  try {
    let summary = probeSummary.value;
    let capabilities = probedCapabilities.value;
    if (!summary || !capabilities || summary.backendUrl !== targetBackendUrl) {
      summary = await probeJoinTarget(false);
      capabilities = probedCapabilities.value;
    }
    if (!summary || !capabilities) return;

    const resolvedServerId = serverId.value.trim() || summary.serverId;
    if (!resolvedServerId) {
      errorMessage.value = "Server ID is required.";
      return;
    }
    const resolvedDisplayName = displayName.value.trim() || summary.serverName || resolvedServerId;

    const discovered = selectedDiscoveredServer.value;
    const profile: ServerProfile = {
      serverId: resolvedServerId,
      displayName: resolvedDisplayName,
      backendUrl: targetBackendUrl,
      iconText: discovered?.iconText ?? toIconText(resolvedDisplayName),
      trustState: discovered?.trustState ?? summary.trustState,
      identityHandshakeStrategy: summary.identityHandshakeMode,
      userIdentifierPolicy: summary.userUidPolicy
    };

    emit("complete", {
      profile,
      capabilities
    });
  } finally {
    isSubmitting.value = false;
  }
}

function completeCreateModel(): void {
  const targetBackendUrl = normalizeBackendURL(backendUrl.value);
  const resolvedServerId = serverId.value.trim();
  const resolvedDisplayName = displayName.value.trim() || resolvedServerId;

  if (!targetBackendUrl) {
    errorMessage.value = "Backend URL is required.";
    return;
  }
  if (!resolvedServerId) {
    errorMessage.value = "Server ID is required.";
    return;
  }

  errorMessage.value = null;
  emit("complete", {
    profile: {
      serverId: resolvedServerId,
      displayName: resolvedDisplayName,
      backendUrl: targetBackendUrl,
      iconText: toIconText(resolvedDisplayName),
      trustState: "unverified",
      identityHandshakeStrategy: "token_proof",
      userIdentifierPolicy: "server_scoped"
    },
    capabilities: null
  });
}
</script>

<template>
  <main class="onboarding-shell">
    <section class="onboarding-card" role="dialog" aria-label="Server setup">
      <header class="onboarding-header">
        <p class="onboarding-kicker">OpenChat setup</p>
        <h1>Join or create your first server</h1>
        <p>Connect to an existing backend or create a local server model to continue.</p>
      </header>

      <div class="mode-toggle">
        <button type="button" class="mode-btn" :class="{ 'is-active': mode === 'join' }" @click="setMode('join')">
          Join Server
        </button>
        <button type="button" class="mode-btn" :class="{ 'is-active': mode === 'create' }" @click="setMode('create')">
          Create Server Model
        </button>
      </div>

      <label class="onboarding-field">
        <span>Backend URL</span>
        <input
          type="text"
          :value="backendUrl"
          placeholder="http://localhost:8080"
          @input="setBackendUrl(($event.target as HTMLInputElement).value)"
        />
      </label>

      <template v-if="mode === 'join'">
        <div class="server-actions">
          <button type="button" class="action-btn" :disabled="isSubmitting" @click="discoverServers">
            {{ isSubmitting ? "Discovering..." : "Discover servers" }}
          </button>
          <button type="button" class="action-btn" :disabled="isSubmitting" @click="probeJoinTarget()">
            {{ isSubmitting ? "Probing..." : "Probe server" }}
          </button>
        </div>

        <section v-if="discoveredServers.length > 0" class="discovery-list">
          <p class="list-label">Discovered servers</p>
          <button
            v-for="server in discoveredServers"
            :key="server.serverId"
            type="button"
            class="discovery-item"
            :class="{ 'is-active': server.serverId === selectedDiscoveredServerId }"
            @click="chooseDiscoveredServer(server.serverId)"
          >
            <span class="discovery-copy">
              <strong>{{ server.displayName }}</strong>
              <small>{{ server.serverId }}</small>
            </span>
            <span class="trust-pill" :class="`is-${server.trustState}`">
              {{ server.trustState === "verified" ? "Verified" : "Unverified" }}
            </span>
          </button>
        </section>

        <label class="onboarding-field">
          <span>Server ID</span>
          <input
            type="text"
            :value="serverId"
            placeholder="srv_demo"
            @input="setServerId(($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="onboarding-field">
          <span>Display Name</span>
          <input
            type="text"
            :value="displayName"
            placeholder="Demo Server"
            @input="setDisplayName(($event.target as HTMLInputElement).value)"
          />
        </label>

        <section v-if="probeSummary" class="probe-summary">
          <header>
            <strong>{{ probeSummary.serverName }}</strong>
            <span class="trust-pill" :class="`is-${probeSummary.trustState}`">
              {{ probeSummary.trustState === "verified" ? "Verified" : "Unverified" }}
            </span>
          </header>
          <p>{{ probeSummary.backendUrl }}</p>
          <p>UID policy: {{ probeSummary.userUidPolicy }} · Handshake: {{ probeSummary.identityHandshakeMode }}</p>
          <p>
            Features:
            {{ probeSummary.messagingEnabled ? "Messaging" : "No messaging" }},
            {{ probeSummary.presenceEnabled ? "Presence" : "No presence" }},
            {{ probeSummary.rtcEnabled ? "RTC" : "No RTC" }}
          </p>
          <p v-if="probeSummary.warningMessage" class="probe-warning">{{ probeSummary.warningMessage }}</p>
        </section>

        <footer class="onboarding-actions">
          <button type="button" class="onboarding-continue" :disabled="isSubmitting" @click="completeJoin">
            Join server
          </button>
        </footer>
      </template>

      <template v-else>
        <p class="create-note">
          Create a local server model when you want to define a new server profile before backend availability is finalized.
        </p>
        <label class="onboarding-field">
          <span>Server ID</span>
          <input
            type="text"
            :value="serverId"
            placeholder="srv_mycommunity"
            @input="setServerId(($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="onboarding-field">
          <span>Display Name</span>
          <input
            type="text"
            :value="displayName"
            placeholder="My Community"
            @input="setDisplayName(($event.target as HTMLInputElement).value)"
          />
        </label>

        <footer class="onboarding-actions">
          <button type="button" class="onboarding-continue" @click="completeCreateModel">Create server model</button>
        </footer>
      </template>

      <p v-if="errorMessage" class="onboarding-error">{{ errorMessage }}</p>
    </section>
  </main>
</template>

<style scoped>
.onboarding-shell {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
}

.onboarding-card {
  width: min(620px, 100%);
  border: 1px solid #32374b;
  border-radius: 16px;
  background: linear-gradient(180deg, #1e2332, #181c2a);
  box-shadow: 0 20px 38px rgb(0 0 0 / 38%);
  padding: 18px;
  display: grid;
  gap: 14px;
}

.onboarding-header {
  display: grid;
  gap: 6px;
}

.onboarding-kicker {
  color: #9fb4ef;
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.onboarding-header h1 {
  font-size: 1.36rem;
}

.onboarding-header p {
  color: #c4ccdf;
  font-size: 0.95rem;
}

.mode-toggle {
  display: inline-flex;
  gap: 8px;
}

.mode-btn {
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid #46506c;
  background: #262d40;
  color: #dde5f7;
  padding: 0 12px;
}

.mode-btn.is-active {
  border-color: #7084b8;
  background: #334162;
}

.onboarding-field {
  display: grid;
  gap: 7px;
}

.onboarding-field span {
  color: #cad2e7;
  font-size: 0.82rem;
  letter-spacing: 0.03em;
}

.onboarding-field input {
  height: 40px;
  border: 1px solid #3d4359;
  border-radius: 9px;
  background: #111623;
  color: #ecf0fb;
  padding: 0 12px;
  outline: none;
}

.onboarding-field input:focus {
  border-color: #5d72aa;
}

.server-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid #5a6a93;
  background: #2f3d5f;
  color: #eaf0ff;
  padding: 0 12px;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.discovery-list {
  display: grid;
  gap: 6px;
}

.list-label {
  color: #b9c2d9;
  font-size: 0.82rem;
}

.discovery-item {
  width: 100%;
  min-height: 42px;
  border-radius: 8px;
  border: 1px solid #3a4052;
  background: #262b39;
  color: #e7ebf8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  padding: 6px 10px;
}

.discovery-item.is-active {
  border-color: #64729b;
  background: #30384c;
}

.discovery-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.discovery-copy strong {
  font-size: 0.9rem;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.discovery-copy small {
  color: #b8c0d6;
  font-size: 0.76rem;
  line-height: 1.1;
}

.trust-pill {
  min-width: 76px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid #4f5568;
  background: #363c4b;
  color: #e6ebfa;
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
  padding: 0 8px;
}

.trust-pill.is-verified {
  border-color: #2f7050;
  background: #1f4734;
  color: #b8f6d2;
}

.trust-pill.is-unverified {
  border-color: #7a5b36;
  background: #4a3621;
  color: #f8ddb7;
}

.probe-summary {
  border-radius: 10px;
  border: 1px solid #37415a;
  background: linear-gradient(180deg, #21314f, #1c2840);
  display: grid;
  gap: 6px;
  padding: 10px;
}

.probe-summary > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.probe-summary > header strong {
  font-size: 0.92rem;
}

.probe-summary p {
  color: #d6def0;
  font-size: 0.78rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.probe-warning {
  border-radius: 8px;
  border: 1px solid #7a5b36;
  background: #4a3621;
  color: #f8ddb7;
  padding: 6px 8px;
}

.create-note {
  color: #b5c0d8;
  font-size: 0.88rem;
  line-height: 1.3;
}

.onboarding-error {
  border-radius: 8px;
  border: 1px solid #7a3a40;
  background: #49262c;
  color: #ffd2d7;
  padding: 8px 10px;
  font-size: 0.85rem;
}

.onboarding-actions {
  display: flex;
  justify-content: flex-end;
}

.onboarding-continue {
  min-height: 38px;
  border-radius: 9px;
  border: 1px solid #6980b5;
  background: #3b4d77;
  color: #f2f6ff;
  padding: 0 14px;
}
</style>
