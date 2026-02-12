<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mdiChevronDown,
  mdiChevronRight,
  mdiCogOutline,
  mdiHeadphones,
  mdiHeadphonesOff,
  mdiMessage,
  mdiMicrophone,
  mdiMicrophoneOff,
  mdiPlus,
  mdiPound,
  mdiVolumeHigh
} from "@mdi/js";
import type { UIDMode } from "@renderer/types/models";
import AppIcon from "./AppIcon.vue";
import ChannelCategoryMenu from "./ChannelCategoryMenu.vue";
import ChannelVoiceConnectedCard from "./ChannelVoiceConnectedCard.vue";
import ProfilePanelCard from "./ProfilePanelCard.vue";
import VoicePresencePopover from "./VoicePresencePopover.vue";

type Channel = {
  id: string;
  name: string;
  type: "text" | "voice";
  unreadCount?: number;
};

type ChannelGroup = {
  id: string;
  label: string;
  kind: "text" | "voice";
  channels: Channel[];
};

type VoiceMood = "chilling" | "gaming" | "studying" | "brb" | "watching stuff";

type VoiceParticipant = {
  id: string;
  name: string;
  avatarText: string;
  avatarColor: string;
  mood: VoiceMood;
  badgeEmoji?: string;
};

type PresenceStatus = "online" | "idle" | "busy" | "invisible";

const props = defineProps<{
  serverName: string;
  groups: ChannelGroup[];
  activeChannelId: string;
  activeVoiceChannelId: string | null;
  activeVoiceChannelName: string | null;
  callState: "idle" | "joining" | "active" | "reconnecting" | "error";
  callParticipantCount: number;
  micMuted: boolean;
  deafened: boolean;
  callErrorMessage?: string | null;
  voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
  filterValue: string;
  currentUid: string;
  uidMode: UIDMode;
  disclosureMessage: string;
  appVersion: string;
  runtimeLabel: string;
  startupError?: string | null;
}>();

const emit = defineEmits<{
  selectChannel: [channelId: string];
  selectVoiceChannel: [channelId: string];
  updateFilter: [value: string];
  toggleUidMode: [];
  toggleMic: [];
  toggleDeafen: [];
  leaveVoiceChannel: [];
}>();

type CategoryMenuState = {
  open: boolean;
  x: number;
  y: number;
  groupId: string | null;
};

type VoicePresencePopoverState = {
  open: boolean;
  x: number;
  y: number;
  participant: VoiceParticipant | null;
};

const collapsedGroupIds = ref<Set<string>>(new Set());
const readGroupIds = ref<Set<string>>(new Set());
const categoryMenu = ref<CategoryMenuState>({
  open: false,
  x: 0,
  y: 0,
  groupId: null
});
const voicePresencePopover = ref<VoicePresencePopoverState>({
  open: false,
  x: 0,
  y: 0,
  participant: null
});
const channelPaneRef = ref<HTMLElement | null>(null);
const profileCardOpen = ref(false);
const presenceStatus = ref<PresenceStatus>("online");
const inputSettingsMenuOpen = ref(false);
const inputGain = ref(100);

let voicePopoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
const profileDisplayName = computed(() => {
  const uid = props.currentUid.trim();
  if (!uid) return "Unknown User";
  if (uid.length <= 16) return uid;
  return `${uid.slice(0, 12)}…${uid.slice(-4)}`;
});
const profileAvatarText = computed(() => profileDisplayName.value.slice(0, 1).toUpperCase());
const profileHandle = computed(() => `@${props.currentUid.trim() || "uid_unbound"}`);

function isGroupCollapsed(groupId: string): boolean {
  return collapsedGroupIds.value.has(groupId);
}

function toggleGroupCollapse(groupId: string): void {
  const next = new Set(collapsedGroupIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedGroupIds.value = next;
}

function collapseAllGroups(): void {
  collapsedGroupIds.value = new Set(props.groups.map((group) => group.id));
  closeCategoryMenu();
}

function isGroupRead(groupId: string): boolean {
  return readGroupIds.value.has(groupId);
}

function markGroupAsRead(groupId: string): void {
  const next = new Set(readGroupIds.value);
  next.add(groupId);
  readGroupIds.value = next;
  closeCategoryMenu();
}

function openCategoryMenu(groupId: string, event: MouseEvent): void {
  closeVoicePresencePopover();
  closeProfileCard();
  closeInputSettingsMenu();
  const menuWidth = 240;
  const menuHeight = 246;
  const boundedX = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
  const boundedY = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
  categoryMenu.value = {
    open: true,
    x: boundedX,
    y: boundedY,
    groupId
  };
}

function closeCategoryMenu(): void {
  categoryMenu.value.open = false;
  categoryMenu.value.groupId = null;
}

function runMarkAsRead(): void {
  if (!categoryMenu.value.groupId) return;
  markGroupAsRead(categoryMenu.value.groupId);
}

function runCollapseCategory(): void {
  if (!categoryMenu.value.groupId) return;
  toggleGroupCollapse(categoryMenu.value.groupId);
  closeCategoryMenu();
}

function isMenuGroupCollapsed(): boolean {
  if (!categoryMenu.value.groupId) return false;
  return isGroupCollapsed(categoryMenu.value.groupId);
}

function participantsForVoiceChannel(channelId: string): VoiceParticipant[] {
  return props.voiceParticipantsByChannel[channelId] ?? [];
}

function hasVoiceParticipants(channelId: string): boolean {
  return participantsForVoiceChannel(channelId).length > 0;
}

function clearVoicePopoverCloseTimer(): void {
  if (voicePopoverCloseTimer !== null) {
    clearTimeout(voicePopoverCloseTimer);
    voicePopoverCloseTimer = null;
  }
}

function closeVoicePresencePopover(): void {
  clearVoicePopoverCloseTimer();
  voicePresencePopover.value.open = false;
  voicePresencePopover.value.participant = null;
}

function scheduleVoicePresencePopoverClose(): void {
  clearVoicePopoverCloseTimer();
  voicePopoverCloseTimer = setTimeout(() => {
    voicePresencePopover.value.open = false;
    voicePresencePopover.value.participant = null;
  }, 120);
}

function openVoicePresencePopover(participant: VoiceParticipant, event: MouseEvent): void {
  closeCategoryMenu();
  closeProfileCard();
  closeInputSettingsMenu();
  clearVoicePopoverCloseTimer();

  const channelPaneRect = channelPaneRef.value?.getBoundingClientRect();
  const rowRect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
  const popoverWidth = 272;
  const popoverHeight = 250;
  const preferredX = (channelPaneRect?.right ?? 8) + 10;
  const preferredY = (rowRect?.top ?? event.clientY) + (rowRect?.height ?? 0) / 2 - popoverHeight / 2;
  const boundedX = Math.max(8, Math.min(preferredX, window.innerWidth - popoverWidth - 8));
  const boundedY = Math.max(8, Math.min(preferredY, window.innerHeight - popoverHeight - 8));
  voicePresencePopover.value = {
    open: true,
    x: boundedX,
    y: boundedY,
    participant
  };
}

function onWindowPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".category-menu") && !target?.closest(".category-header")) {
    closeCategoryMenu();
  }

  if (!target?.closest(".voice-presence-popover") && !target?.closest(".voice-member-row")) {
    closeVoicePresencePopover();
  }

  if (!target?.closest(".profile-card") && !target?.closest(".user-identity-btn")) {
    closeProfileCard();
  }

  if (!target?.closest(".input-settings-menu") && !target?.closest(".input-settings-trigger")) {
    closeInputSettingsMenu();
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeCategoryMenu();
    closeVoicePresencePopover();
    closeProfileCard();
    closeInputSettingsMenu();
  }
}

function toggleProfileCard(): void {
  profileCardOpen.value = !profileCardOpen.value;
  closeCategoryMenu();
  closeVoicePresencePopover();
  closeInputSettingsMenu();
}

function closeProfileCard(): void {
  profileCardOpen.value = false;
  closeInputSettingsMenu();
}

function setPresenceStatus(status: PresenceStatus): void {
  presenceStatus.value = status;
}

function toggleInputSettingsMenu(): void {
  inputSettingsMenuOpen.value = !inputSettingsMenuOpen.value;
}

function closeInputSettingsMenu(): void {
  inputSettingsMenuOpen.value = false;
}

onMounted(() => {
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("keydown", onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowKeydown);
  clearVoicePopoverCloseTimer();
  closeInputSettingsMenu();
});
</script>

<template>
  <aside ref="channelPaneRef" class="channel-pane">
    <header class="guild-header">
      <h2>{{ serverName }}</h2>
      <button type="button" class="guild-header-action">
        <AppIcon :path="mdiPlus" :size="14" />
      </button>
    </header>

    <label class="filter-row guild-filter">
      <span class="sr-only">Filter channels</span>
      <input
        type="text"
        :value="filterValue"
        placeholder="Filter channels"
        @input="emit('updateFilter', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <div class="channel-list">
      <section
        v-for="group in groups"
        :key="group.id"
        class="channel-group"
        :class="{ 'is-collapsed': isGroupCollapsed(group.id) }"
      >
        <button
          type="button"
          class="category-header"
          :class="{
            'is-voice-label': group.kind === 'voice'
          }"
          @click="toggleGroupCollapse(group.id)"
          @contextmenu.prevent="openCategoryMenu(group.id, $event)"
        >
          <span class="category-chevron" :class="{ 'is-collapsed': isGroupCollapsed(group.id) }">
            <AppIcon :path="mdiChevronDown" :size="12" />
          </span>
          <span class="category-label">{{ group.label }}</span>
        </button>

        <div v-show="!isGroupCollapsed(group.id)" class="channel-group-body">
          <div v-for="channel in group.channels" :key="channel.id" class="channel-entry">
            <button
              type="button"
              class="channel-row"
              :class="{
                'is-active': channel.type === 'text' && channel.id === activeChannelId,
                'is-voice': channel.type === 'voice',
                'is-connected': channel.type === 'voice' && channel.id === activeVoiceChannelId
              }"
              @click="
                channel.type === 'voice' ? emit('selectVoiceChannel', channel.id) : emit('selectChannel', channel.id)
              "
            >
              <span class="channel-symbol">
                <AppIcon :path="channel.type === 'voice' ? mdiVolumeHigh : mdiPound" :size="14" />
              </span>
              <span class="channel-name">{{ channel.name }}</span>
              <span v-if="channel.type === 'voice' && hasVoiceParticipants(channel.id)" class="voice-channel-meta">
                <AppIcon :path="mdiMessage" :size="14" />
              </span>
              <span
                v-if="channel.type === 'text' && !isGroupRead(group.id) && (channel.unreadCount ?? 0) > 0"
                class="badge"
              >
                {{ channel.unreadCount }}
              </span>
            </button>

            <div v-if="channel.type === 'voice' && hasVoiceParticipants(channel.id)" class="voice-member-list">
              <article
                v-for="participant in participantsForVoiceChannel(channel.id)"
                :key="participant.id"
                class="voice-member-row"
                @mouseenter="openVoicePresencePopover(participant, $event)"
                @mouseleave="scheduleVoicePresencePopoverClose"
              >
                <span class="voice-member-avatar" :style="{ background: participant.avatarColor }">
                  {{ participant.avatarText }}
                </span>
                <span class="voice-member-name">
                  {{ participant.name }}
                </span>
                <span v-if="participant.badgeEmoji" class="voice-member-badge">{{ participant.badgeEmoji }}</span>
              </article>
            </div>
          </div>
        </div>
      </section>

      <ChannelCategoryMenu
        :open="categoryMenu.open"
        :x="categoryMenu.x"
        :y="categoryMenu.y"
        :is-collapsed="isMenuGroupCollapsed()"
        @mark-as-read="runMarkAsRead"
        @collapse-category="runCollapseCategory"
        @collapse-all="collapseAllGroups"
        @close="closeCategoryMenu"
      />

      <VoicePresencePopover
        :open="voicePresencePopover.open"
        :x="voicePresencePopover.x"
        :y="voicePresencePopover.y"
        :participant="voicePresencePopover.participant"
        @mouseenter="clearVoicePopoverCloseTimer"
        @mouseleave="scheduleVoicePresencePopoverClose"
      />
    </div>

    <footer class="user-dock">
      <ChannelVoiceConnectedCard
        :server-name="serverName"
        :active-voice-channel-name="activeVoiceChannelName"
        :call-state="callState"
        :call-participant-count="callParticipantCount"
        :call-error-message="callErrorMessage"
        @leave="emit('leaveVoiceChannel')"
      />

      <div class="user-dock-main">
        <button type="button" class="user-identity-btn" @click="toggleProfileCard">
          <div class="avatar-pill">
            {{ profileAvatarText }}
            <span class="presence-dot" :class="`is-${presenceStatus}`" />
          </div>
          <div class="user-meta">
            <strong>{{ profileDisplayName }}</strong>
            <small>{{ profileHandle }}</small>
          </div>
        </button>

        <div class="user-actions">
          <div class="voice-control-group input-control-wrap" :class="{ 'is-muted': micMuted }">
            <button
              type="button"
              class="voice-control-btn"
              :aria-label="micMuted ? 'Unmute microphone' : 'Mute microphone'"
              @click="emit('toggleMic')"
            >
              <AppIcon :path="micMuted ? mdiMicrophoneOff : mdiMicrophone" :size="16" />
            </button>
            <button
              type="button"
              class="voice-control-btn voice-control-caret input-settings-trigger"
              :class="{ 'is-open': inputSettingsMenuOpen }"
              aria-label="Input options"
              :aria-expanded="inputSettingsMenuOpen"
              aria-controls="input-settings-menu"
              @click.stop="toggleInputSettingsMenu"
            >
              <AppIcon :path="mdiChevronDown" :size="14" />
              <span class="icon-tooltip">Input Options</span>
            </button>

            <section
              v-if="inputSettingsMenuOpen"
              id="input-settings-menu"
              class="input-settings-menu"
              role="dialog"
              aria-label="Input settings"
            >
              <button type="button" class="input-settings-row">
                <span class="input-settings-copy">
                  <strong>Input Device</strong>
                  <small>macOS Default (MacBook Pro Microphone)</small>
                </span>
                <AppIcon :path="mdiChevronRight" :size="16" />
              </button>

              <button type="button" class="input-settings-row">
                <span class="input-settings-copy">
                  <strong>Input Profile</strong>
                  <small>Custom</small>
                </span>
                <AppIcon :path="mdiChevronRight" :size="16" />
              </button>

              <div class="input-settings-divider" />

              <div class="input-volume-group">
                <p>Input Volume</p>
                <label class="input-volume-slider">
                  <span class="sr-only">Input volume</span>
                  <input v-model.number="inputGain" type="range" min="0" max="100" />
                </label>
              </div>

              <div class="input-settings-divider" />

              <button type="button" class="input-settings-row is-settings">
                <span class="input-settings-copy">
                  <strong>Voice Settings</strong>
                </span>
                <AppIcon :path="mdiCogOutline" :size="16" />
              </button>
            </section>
          </div>

          <div class="voice-control-group" :class="{ 'is-muted': deafened }">
            <button
              type="button"
              class="voice-control-btn"
              :aria-label="deafened ? 'Undeafen audio' : 'Deafen audio'"
              @click="emit('toggleDeafen')"
            >
              <AppIcon :path="deafened ? mdiHeadphonesOff : mdiHeadphones" :size="16" />
            </button>
            <button type="button" class="voice-control-btn voice-control-caret" aria-label="Output options">
              <AppIcon :path="mdiChevronDown" :size="14" />
              <span class="icon-tooltip">Output Options</span>
            </button>
          </div>

          <button type="button" class="user-settings-btn">
            <AppIcon :path="mdiCogOutline" :size="16" />
          </button>
        </div>
      </div>

      <ProfilePanelCard
        v-if="profileCardOpen"
        :server-name="serverName"
        :current-uid="currentUid"
        :uid-mode="uidMode"
        :disclosure-message="disclosureMessage"
        :app-version="appVersion"
        :runtime-label="runtimeLabel"
        :startup-error="startupError"
        :presence-status="presenceStatus"
        @update:presence-status="setPresenceStatus"
        @toggle-uid-mode="emit('toggleUidMode')"
      />
    </footer>
  </aside>
</template>
