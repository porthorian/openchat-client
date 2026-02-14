<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { mdiChevronRight, mdiPencilOutline, mdiPlusCircleOutline } from "@mdi/js";
import type { AvatarMode, UIDMode } from "@renderer/types/models";
import { avatarPresetById } from "@renderer/utils/avatarPresets";
import AppIcon from "./AppIcon.vue";

type PresenceStatus = "online" | "idle" | "busy" | "invisible";

type PresenceOption = {
  value: PresenceStatus;
  label: string;
  description?: string;
};

const props = defineProps<{
  serverName: string;
  currentUid: string;
  profileDisplayName: string;
  profileAvatarMode: AvatarMode;
  profileAvatarPresetId: string;
  profileAvatarImageDataUrl: string | null;
  uidMode: UIDMode;
  disclosureMessage: string;
  appVersion: string;
  runtimeLabel: string;
  startupError?: string | null;
  presenceStatus: PresenceStatus;
}>();

const emit = defineEmits<{
  "update:presenceStatus": [status: PresenceStatus];
  toggleUidMode: [];
}>();

const presenceOptions: PresenceOption[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  {
    value: "busy",
    label: "Do Not Disturb",
    description: "You will not receive desktop notifications"
  },
  {
    value: "invisible",
    label: "Invisible",
    description: "You will appear offline"
  }
];

const presenceLabels: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  busy: "Do Not Disturb",
  invisible: "Invisible"
};

const statusTriggerRef = ref<HTMLElement | null>(null);
const statusMenuOpen = ref(false);
const statusMenuPosition = ref({ x: 0, y: 0 });
let statusMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;

const presenceLabel = computed(() => presenceLabels[props.presenceStatus]);
const profileDisplayName = computed(() => {
  const username = props.profileDisplayName.trim();
  if (!username) return "Unknown User";
  return username;
});
const profileAvatarText = computed(() => profileDisplayName.value.slice(0, 1).toUpperCase());
const profileAvatarPreset = computed(() => avatarPresetById(props.profileAvatarPresetId));
const hasUploadedProfileAvatar = computed(() => {
  return props.profileAvatarMode === "uploaded" && Boolean(props.profileAvatarImageDataUrl);
});
const profileAvatarStyle = computed(() => {
  if (hasUploadedProfileAvatar.value) return {};
  return {
    background: profileAvatarPreset.value.gradient,
    color: profileAvatarPreset.value.accent
  };
});
const profileHandle = computed(() => `@${props.currentUid.trim() || "uid_unbound"}`);
const profileNote = computed(() => {
  return props.uidMode === "server_scoped" ? "Server-scoped identity active" : "Global identity active";
});
const profileBio = computed(() => {
  return `Active on ${props.serverName}.`;
});

function clearStatusMenuCloseTimer(): void {
  if (statusMenuCloseTimer !== null) {
    clearTimeout(statusMenuCloseTimer);
    statusMenuCloseTimer = null;
  }
}

function updateStatusMenuPosition(): void {
  const triggerRect = statusTriggerRef.value?.getBoundingClientRect();
  if (!triggerRect) return;

  const menuWidth = 300;
  const menuHeight = 224;
  const gap = 12;
  let x = triggerRect.right + gap;
  if (x + menuWidth > window.innerWidth - 8) {
    x = triggerRect.left - menuWidth - gap;
  }
  x = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));

  let y = triggerRect.top - 8;
  y = Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8));

  statusMenuPosition.value = { x, y };
}

function openStatusMenu(): void {
  clearStatusMenuCloseTimer();
  updateStatusMenuPosition();
  statusMenuOpen.value = true;
}

function scheduleStatusMenuClose(): void {
  clearStatusMenuCloseTimer();
  statusMenuCloseTimer = setTimeout(() => {
    statusMenuOpen.value = false;
  }, 120);
}

function closeStatusMenu(): void {
  clearStatusMenuCloseTimer();
  statusMenuOpen.value = false;
}

function setPresenceStatus(status: PresenceStatus): void {
  emit("update:presenceStatus", status);
  closeStatusMenu();
}

function onWindowPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".status-hover-menu") && !target?.closest(".profile-status-trigger")) {
    closeStatusMenu();
  }
}

function onWindowResize(): void {
  if (statusMenuOpen.value) {
    updateStatusMenuPosition();
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeStatusMenu();
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("scroll", onWindowResize, true);
  window.addEventListener("keydown", onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener("scroll", onWindowResize, true);
  window.removeEventListener("keydown", onWindowKeydown);
  clearStatusMenuCloseTimer();
});
</script>

<template>
  <section class="profile-card" role="dialog" aria-label="User profile and status">
    <div class="profile-card-header">
      <div class="profile-avatar" :style="profileAvatarStyle">
        <img v-if="hasUploadedProfileAvatar" class="profile-avatar-image" :src="profileAvatarImageDataUrl ?? ''" alt="" />
        <template v-else>{{ profileAvatarText }}</template>
        <span class="presence-dot is-large" :class="`is-${presenceStatus}`" />
      </div>
      <div class="profile-note-pill">
        <AppIcon :path="mdiPlusCircleOutline" :size="14" />
        <span>{{ profileNote }}</span>
      </div>
    </div>

    <div class="profile-identity">
      <strong>{{ profileDisplayName }}</strong>
      <p class="profile-handle">{{ profileHandle }}</p>
      <p class="profile-bio">{{ profileBio }}</p>
    </div>

    <div class="profile-panel">
      <button type="button" class="profile-row">
        <span class="profile-row-left">
          <AppIcon :path="mdiPencilOutline" :size="14" />
          <span>Edit Profile</span>
        </span>
      </button>

      <div class="profile-divider" />

      <div class="profile-status-wrap">
        <button
          ref="statusTriggerRef"
          type="button"
          class="profile-row profile-status-trigger"
          :class="{ 'is-active': statusMenuOpen }"
          @mouseenter="openStatusMenu"
          @mouseleave="scheduleStatusMenuClose"
        >
          <span class="profile-row-left">
            <span class="presence-dot" :class="`is-${presenceStatus}`" />
            <span>{{ presenceLabel }}</span>
          </span>
          <AppIcon :path="mdiChevronRight" :size="14" />
        </button>

        <div
          v-if="statusMenuOpen"
          class="status-hover-menu"
          :style="{ left: `${statusMenuPosition.x}px`, top: `${statusMenuPosition.y}px` }"
          @mouseenter="openStatusMenu"
          @mouseleave="scheduleStatusMenuClose"
        >
          <button
            v-for="option in presenceOptions"
            :key="option.value"
            type="button"
            class="status-menu-item"
            :class="{ 'is-active': option.value === presenceStatus }"
            @click="setPresenceStatus(option.value)"
          >
            <span class="status-menu-main">
              <span class="presence-dot" :class="`is-${option.value}`" />
              <span class="status-menu-copy">
                <strong>{{ option.label }}</strong>
                <small v-if="option.description">{{ option.description }}</small>
              </span>
            </span>
            <AppIcon :path="mdiChevronRight" :size="14" />
          </button>
        </div>
      </div>

      <div class="profile-divider" />

      <section class="profile-disclosure-panel" aria-label="Identity disclosure">
        <p class="profile-disclosure-title">Identity Disclosure</p>
        <p v-if="startupError" class="profile-disclosure-error">{{ startupError }}</p>
        <p class="profile-disclosure-copy">{{ disclosureMessage }}</p>
        <p class="profile-disclosure-uid">
          current UID:
          <code>{{ currentUid }}</code>
        </p>
        <p class="profile-disclosure-meta">build {{ appVersion }} · {{ runtimeLabel }}</p>
        <button type="button" class="profile-disclosure-btn" @click="emit('toggleUidMode')">
          Switch UID mode ({{ uidMode }})
        </button>
      </section>
    </div>
  </section>
</template>
