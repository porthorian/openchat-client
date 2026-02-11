<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiChevronDown,
  mdiChevronRight,
  mdiCogOutline,
  mdiDeleteOutline,
  mdiDotsGrid,
  mdiHeadphones,
  mdiMessage,
  mdiMicrophone,
  mdiPencilOutline,
  mdiPlus,
  mdiPlusCircleOutline,
  mdiPound,
  mdiVolumeHigh
} from "@mdi/js";
import AppIcon from "./AppIcon.vue";

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
  voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
  filterValue: string;
}>();

const emit = defineEmits<{
  selectChannel: [channelId: string];
  selectVoiceChannel: [channelId: string];
  updateFilter: [value: string];
}>();

const voiceMoodOrder: VoiceMood[] = ["chilling", "gaming", "studying", "brb", "watching stuff"];
const voiceMoodCatalog: Record<VoiceMood, { label: string; icon: string }> = {
  chilling: { label: "chilling", icon: "🛋️" },
  gaming: { label: "gaming", icon: "🎮" },
  studying: { label: "studying", icon: "📘" },
  brb: { label: "brb", icon: "🍽️" },
  "watching stuff": { label: "watching stuff", icon: "🍿" }
};
const presenceOptions: Array<{ value: PresenceStatus; label: string; description?: string }> = [
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

type FloatingMenuPosition = {
  x: number;
  y: number;
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
const statusMenuOpen = ref(false);
const statusTriggerRef = ref<HTMLElement | null>(null);
const statusMenuPosition = ref<FloatingMenuPosition>({ x: 0, y: 0 });
const micMuted = ref(false);
const outputDeafened = ref(false);
const inputSettingsMenuOpen = ref(false);
const inputGain = ref(100);

let voicePopoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
let statusMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
const presenceLabel = computed(() => presenceLabels[presenceStatus.value]);

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

function moodLabel(mood: VoiceMood): string {
  return voiceMoodCatalog[mood].label;
}

function moodIcon(mood: VoiceMood): string {
  return voiceMoodCatalog[mood].icon;
}

function isPopoverMood(mood: VoiceMood): boolean {
  return voicePresencePopover.value.participant?.mood === mood;
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

function clearStatusMenuCloseTimer(): void {
  if (statusMenuCloseTimer !== null) {
    clearTimeout(statusMenuCloseTimer);
    statusMenuCloseTimer = null;
  }
}

function openStatusMenu(): void {
  clearStatusMenuCloseTimer();
  closeInputSettingsMenu();
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

function onWindowResize(): void {
  if (statusMenuOpen.value) {
    updateStatusMenuPosition();
  }
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

  if (!target?.closest(".status-hover-menu") && !target?.closest(".profile-status-trigger")) {
    closeStatusMenu();
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
    closeStatusMenu();
    closeInputSettingsMenu();
  }
}

function toggleProfileCard(): void {
  profileCardOpen.value = !profileCardOpen.value;
  if (!profileCardOpen.value) {
    closeStatusMenu();
  }
  closeCategoryMenu();
  closeVoicePresencePopover();
  closeInputSettingsMenu();
}

function closeProfileCard(): void {
  profileCardOpen.value = false;
  closeStatusMenu();
  closeInputSettingsMenu();
}

function setPresenceStatus(status: PresenceStatus): void {
  presenceStatus.value = status;
  closeStatusMenu();
}

function toggleMicMute(): void {
  micMuted.value = !micMuted.value;
  if (!micMuted.value && outputDeafened.value) {
    outputDeafened.value = false;
  }
}

function toggleOutputDeafen(): void {
  outputDeafened.value = !outputDeafened.value;
  if (outputDeafened.value) {
    micMuted.value = true;
  }
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
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("scroll", onWindowResize, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowKeydown);
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener("scroll", onWindowResize, true);
  clearVoicePopoverCloseTimer();
  clearStatusMenuCloseTimer();
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

      <div
        v-if="categoryMenu.open"
        class="category-menu"
        role="menu"
        aria-label="Category options"
        :style="{ left: `${categoryMenu.x}px`, top: `${categoryMenu.y}px` }"
      >
        <button type="button" class="category-menu-item" @click="runMarkAsRead">
          <span>Mark As Read</span>
        </button>

        <div class="category-menu-divider" />

        <button type="button" class="category-menu-item" @click="runCollapseCategory">
          <span>Collapse Category</span>
          <span class="category-menu-trailing">
            <AppIcon :path="isMenuGroupCollapsed() ? mdiCheckboxMarked : mdiCheckboxBlankOutline" :size="16" />
          </span>
        </button>

        <button type="button" class="category-menu-item" @click="collapseAllGroups">
          <span>Collapse All Categories</span>
        </button>

        <div class="category-menu-divider" />

        <button type="button" class="category-menu-item" @click="closeCategoryMenu">
          <span>Mute Category</span>
          <span class="category-menu-trailing">
            <AppIcon :path="mdiChevronRight" :size="16" />
          </span>
        </button>

        <button type="button" class="category-menu-item is-notification" @click="closeCategoryMenu">
          <span class="category-menu-copy">
            <span>Notification Settings</span>
            <small>Only @mentions</small>
          </span>
          <span class="category-menu-trailing">
            <AppIcon :path="mdiChevronRight" :size="16" />
          </span>
        </button>
      </div>

      <div
        v-if="voicePresencePopover.open && voicePresencePopover.participant"
        class="voice-presence-popover"
        role="dialog"
        aria-label="Voice presence details"
        :style="{ left: `${voicePresencePopover.x}px`, top: `${voicePresencePopover.y}px` }"
        @mouseenter="clearVoicePopoverCloseTimer"
        @mouseleave="scheduleVoicePresencePopoverClose"
      >
        <div class="voice-presence-current">
          <div class="voice-presence-pill">
            <span class="voice-presence-emoji">{{ moodIcon(voicePresencePopover.participant.mood) }}</span>
            <span>{{ moodLabel(voicePresencePopover.participant.mood) }}</span>
          </div>

          <div class="voice-presence-actions">
            <button type="button" aria-label="Clear status">
              <AppIcon :path="mdiDeleteOutline" :size="14" />
            </button>
            <button type="button" aria-label="More status options">
              <AppIcon :path="mdiDotsGrid" :size="14" />
            </button>
          </div>
        </div>

        <button
          v-for="mood in voiceMoodOrder"
          :key="mood"
          type="button"
          class="voice-presence-option"
          :class="{ 'is-active': isPopoverMood(mood) }"
        >
          <span class="voice-presence-emoji">{{ moodIcon(mood) }}</span>
          <span>{{ moodLabel(mood) }}</span>
        </button>
      </div>
    </div>

    <footer class="user-dock">
      <button type="button" class="user-identity-btn" @click="toggleProfileCard">
        <div class="avatar-pill">
          V
          <span class="presence-dot" :class="`is-${presenceStatus}`" />
        </div>
        <div class="user-meta">
          <strong>V. Marone</strong>
          <small>{{ presenceLabel }}</small>
        </div>
      </button>

      <div class="user-actions">
        <div class="voice-control-group input-control-wrap" :class="{ 'is-muted': micMuted }">
          <button
            type="button"
            class="voice-control-btn"
            :aria-label="micMuted ? 'Unmute microphone' : 'Mute microphone'"
            @click="toggleMicMute"
          >
            <AppIcon :path="mdiMicrophone" :size="16" />
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

        <div class="voice-control-group" :class="{ 'is-muted': outputDeafened }">
          <button
            type="button"
            class="voice-control-btn"
            :aria-label="outputDeafened ? 'Undeafen audio' : 'Deafen audio'"
            @click="toggleOutputDeafen"
          >
            <AppIcon :path="mdiHeadphones" :size="16" />
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

      <section v-if="profileCardOpen" class="profile-card" role="dialog" aria-label="User profile and status">
        <div class="profile-card-header">
          <div class="profile-avatar">
            V
            <span class="presence-dot is-large" :class="`is-${presenceStatus}`" />
          </div>
          <div class="profile-note-pill">
            <AppIcon :path="mdiPlusCircleOutline" :size="14" />
            <span>Favorite anime lately?</span>
          </div>
        </div>

        <div class="profile-identity">
          <strong>V. Marone</strong>
          <p class="profile-handle">vmarone <span>#</span> <span>⚙️</span></p>
          <p class="profile-bio">Welp.</p>
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
        </div>
      </section>
    </footer>
  </aside>
</template>
