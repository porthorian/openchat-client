<script setup lang="ts">
import OnboardingProfileSetup from "./components/OnboardingProfileSetup.vue";
import OnboardingServerSetup from "./components/OnboardingServerSetup.vue";
import WorkspaceHome from "./components/WorkspaceHome.vue";
import { useAppUIStore, useIdentityStore, useServerRegistryStore } from "@renderer/stores";
import type { ServerCapabilities } from "@renderer/types/capabilities";
import type { OnboardingSetupInput } from "@renderer/types/models";
import type { ServerProfile } from "@renderer/types/models";

const identity = useIdentityStore();
const registry = useServerRegistryStore();
const appUI = useAppUIStore();

identity.initializeIdentity();
registry.hydrateFromStorage();

function completeOnboarding(payload: OnboardingSetupInput): void {
  identity.completeSetup(payload);
}

function completeServerSetup(payload: { profile: ServerProfile; capabilities: ServerCapabilities | null }): void {
  const added = registry.addServer(payload.profile);
  if (payload.capabilities) {
    registry.setCapabilities(payload.profile.serverId, payload.capabilities);
  }
  if (!added && !registry.byId(payload.profile.serverId)) {
    return;
  }
  appUI.setActiveServer(payload.profile.serverId);
}
</script>

<template>
  <OnboardingProfileSetup v-if="!identity.hasCompletedSetup" @complete="completeOnboarding" />
  <OnboardingServerSetup v-else-if="registry.servers.length === 0" @complete="completeServerSetup" />
  <WorkspaceHome v-else />
</template>
