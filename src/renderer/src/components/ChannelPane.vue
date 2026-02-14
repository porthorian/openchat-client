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
import type { AvatarMode, UIDMode } from "@renderer/types/models";
import { avatarPresetById } from "@renderer/utils/avatarPresets";
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

type OutputDevice = {
  deviceId: string;
  label: string;
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
  inputDevices: OutputDevice[];
  selectedInputDeviceId: string;
  inputVolume: number;
  inputDeviceError?: string | null;
  outputDevices: OutputDevice[];
  selectedOutputDeviceId: string;
  outputSelectionSupported: boolean;
  outputVolume: number;
  outputDeviceError?: string | null;
  callErrorMessage?: string | null;
  voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
  voiceSpeakingParticipantIdsByChannel: Record<string, string[]>;
  localVoiceTransmitting: boolean;
  filterValue: string;
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
}>();

const emit = defineEmits<{
  selectChannel: [channelId: string];
  selectVoiceChannel: [channelId: string];
  updateFilter: [value: string];
  markChannelsRead: [channelIds: string[]];
  toggleUidMode: [];
  toggleMic: [];
  toggleDeafen: [];
  leaveVoiceChannel: [];
  openInputOptions: [];
  selectInputDevice: [deviceId: string];
  updateInputVolume: [value: number];
  openOutputOptions: [];
  selectOutputDevice: [deviceId: string];
  updateOutputVolume: [value: number];
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
const outputSettingsMenuOpen = ref(false);
const outputDeviceListOpen = ref(false);
const inputDeviceListOpen = ref(false);

let voicePopoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
const profileDisplayName = computed(() => {
  const username = props.profileDisplayName.trim();
  if (!username) return "Unknown User";
  return username;
});
const profileAvatarText = computed(() => profileDisplayName.value.slice(0, 1).toUpperCase());
const profileHandle = computed(() => `@${props.currentUid.trim() || "uid_unbound"}`);
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
const selectedOutputDeviceLabel = computed(() => {
  const selected = props.outputDevices.find((device) => device.deviceId === props.selectedOutputDeviceId);
  if (selected) return selected.label;
  return props.outputDevices[0]?.label ?? "System Default";
});
const selectedInputDeviceLabel = computed(() => {
  const selected = props.inputDevices.find((device) => device.deviceId === props.selectedInputDeviceId);
  if (selected) return selected.label;
  return props.inputDevices[0]?.label ?? "System Default (Microphone)";
});
const canSelectInputDevice = computed(() => props.inputDevices.length > 1);
const canSelectOutputDevice = computed(() => props.outputSelectionSupported && props.outputDevices.length > 1);

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

function markGroupAsRead(groupId: string): void {
  const targetGroup = props.groups.find((group) => group.id === groupId);
  if (targetGroup) {
    const textChannelIDs = targetGroup.channels.filter((channel) => channel.type === "text").map((channel) => channel.id);
    emit("markChannelsRead", textChannelIDs);
  }
  closeCategoryMenu();
}

function openCategoryMenu(groupId: string, event: MouseEvent): void {
  closeVoicePresencePopover();
  closeProfileCard();
  closeInputSettingsMenu();
  closeOutputSettingsMenu();
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

function isVoiceParticipantSpeaking(channelId: string, participantId: string): boolean {
  const speaking = props.voiceSpeakingParticipantIdsByChannel[channelId] ?? [];
  return speaking.includes(participantId);
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
  closeOutputSettingsMenu();
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

  if (!target?.closest(".output-settings-menu") && !target?.closest(".output-settings-trigger")) {
    closeOutputSettingsMenu();
  }

  if (!target?.closest(".input-device-popout") && !target?.closest(".input-device-trigger")) {
    inputDeviceListOpen.value = false;
  }

  if (!target?.closest(".output-device-popout") && !target?.closest(".output-device-trigger")) {
    outputDeviceListOpen.value = false;
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeCategoryMenu();
    closeVoicePresencePopover();
    closeProfileCard();
    closeInputSettingsMenu();
    closeOutputSettingsMenu();
  }
}

function toggleProfileCard(): void {
  profileCardOpen.value = !profileCardOpen.value;
  closeCategoryMenu();
  closeVoicePresencePopover();
  closeInputSettingsMenu();
  closeOutputSettingsMenu();
}

function closeProfileCard(): void {
  profileCardOpen.value = false;
}

function setPresenceStatus(status: PresenceStatus): void {
  presenceStatus.value = status;
}

function toggleInputSettingsMenu(): void {
  inputSettingsMenuOpen.value = !inputSettingsMenuOpen.value;
  if (inputSettingsMenuOpen.value) {
    closeCategoryMenu();
    closeVoicePresencePopover();
    profileCardOpen.value = false;
    closeOutputSettingsMenu();
    emit("openInputOptions");
  } else {
    inputDeviceListOpen.value = false;
  }
}

function closeInputSettingsMenu(): void {
  inputSettingsMenuOpen.value = false;
  inputDeviceListOpen.value = false;
}

function toggleOutputSettingsMenu(): void {
  outputSettingsMenuOpen.value = !outputSettingsMenuOpen.value;
  if (outputSettingsMenuOpen.value) {
    outputDeviceListOpen.value = false;
    closeCategoryMenu();
    closeVoicePresencePopover();
    profileCardOpen.value = false;
    closeInputSettingsMenu();
    outputDeviceListOpen.value = false;
    emit("openOutputOptions");
  } else {
    outputDeviceListOpen.value = false;
  }
}

function closeOutputSettingsMenu(): void {
  outputSettingsMenuOpen.value = false;
  outputDeviceListOpen.value = false;
}

function toggleOutputDeviceList(): void {
  if (!canSelectOutputDevice.value) return;
  outputDeviceListOpen.value = !outputDeviceListOpen.value;
  if (outputDeviceListOpen.value) {
    inputDeviceListOpen.value = false;
  }
}

function chooseOutputDevice(deviceId: string): void {
  emit("selectOutputDevice", deviceId);
  outputDeviceListOpen.value = false;
}

function splitDeviceLabel(label: string): { primary: string; secondary: string | null } {
  const normalized = label.trim();
  if (!normalized) {
    return {
      primary: "Unknown Device",
      secondary: null
    };
  }

  if (normalized.includes(" - ")) {
    const [head, ...tail] = normalized.split(" - ");
    return {
      primary: head.trim(),
      secondary: tail.join(" - ").trim() || null
    };
  }

  const parenStart = normalized.indexOf(" (");
  if (parenStart > 0 && normalized.endsWith(")")) {
    return {
      primary: normalized.slice(0, parenStart).trim(),
      secondary: normalized.slice(parenStart + 2, -1).trim() || null
    };
  }

  return {
    primary: normalized,
    secondary: null
  };
}

function refreshInputDevices(): void {
  emit("openInputOptions");
}

function toggleInputDeviceList(): void {
  if (!canSelectInputDevice.value) return;
  inputDeviceListOpen.value = !inputDeviceListOpen.value;
  if (inputDeviceListOpen.value) {
    outputDeviceListOpen.value = false;
    refreshInputDevices();
  }
}

function chooseInputDevice(deviceId: string): void {
  emit("selectInputDevice", deviceId);
  inputDeviceListOpen.value = false;
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
  closeOutputSettingsMenu();
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
                v-if="channel.type === 'text' && (channel.unreadCount ?? 0) > 0"
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
                :class="{ 'is-speaking': isVoiceParticipantSpeaking(channel.id, participant.id) }"
                @mouseenter="openVoicePresencePopover(participant, $event)"
                @mouseleave="scheduleVoicePresencePopoverClose"
              >
                <span
                  class="voice-member-avatar"
                  :class="{ 'is-speaking': isVoiceParticipantSpeaking(channel.id, participant.id) }"
                  :style="{ background: participant.avatarColor }"
                >
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
          <div class="avatar-pill" :class="{ 'is-speaking': localVoiceTransmitting }" :style="profileAvatarStyle">
            <img v-if="hasUploadedProfileAvatar" class="avatar-pill-image" :src="profileAvatarImageDataUrl ?? ''" alt="" />
            <template v-else>{{ profileAvatarText }}</template>
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
              <div class="device-row-wrap">
                <button
                  type="button"
                  class="input-settings-row input-device-trigger"
                  :disabled="!canSelectInputDevice"
                  :aria-expanded="inputDeviceListOpen"
                  @click.stop="toggleInputDeviceList"
                >
                  <span class="input-settings-copy">
                    <strong>Input Device</strong>
                    <small>{{ selectedInputDeviceLabel }}</small>
                  </span>
                  <AppIcon :path="mdiChevronRight" :size="16" :class="{ 'is-rotated': inputDeviceListOpen }" />
                </button>

                <section v-if="inputDeviceListOpen" class="device-selection-popout input-device-popout" role="dialog">
                  <button
                    v-for="device in inputDevices"
                    :key="device.deviceId"
                    type="button"
                    class="device-selection-option"
                    :class="{ 'is-active': device.deviceId === selectedInputDeviceId }"
                    @click="chooseInputDevice(device.deviceId)"
                  >
                    <span class="device-selection-copy">
                      <strong>{{ splitDeviceLabel(device.label).primary }}</strong>
                      <small v-if="splitDeviceLabel(device.label).secondary">
                        {{ splitDeviceLabel(device.label).secondary }}
                      </small>
                    </span>
                    <span class="device-selection-indicator" :class="{ 'is-active': device.deviceId === selectedInputDeviceId }" />
                  </button>
                  <button type="button" class="device-selection-more" @click="refreshInputDevices">Show more...</button>
                  <p v-if="inputDeviceError" class="output-settings-error">{{ inputDeviceError }}</p>
                </section>
              </div>

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
                  <input
                    :value="inputVolume"
                    type="range"
                    min="0"
                    max="200"
                    @input="emit('updateInputVolume', Number(($event.target as HTMLInputElement).value))"
                  />
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

          <div class="voice-control-group output-control-wrap" :class="{ 'is-muted': deafened }">
            <button
              type="button"
              class="voice-control-btn"
              :aria-label="deafened ? 'Undeafen audio' : 'Deafen audio'"
              @click="emit('toggleDeafen')"
            >
              <AppIcon :path="deafened ? mdiHeadphonesOff : mdiHeadphones" :size="16" />
            </button>
            <button
              type="button"
              class="voice-control-btn voice-control-caret output-settings-trigger"
              :class="{ 'is-open': outputSettingsMenuOpen }"
              aria-label="Output options"
              :aria-expanded="outputSettingsMenuOpen"
              aria-controls="output-settings-menu"
              @click.stop="toggleOutputSettingsMenu"
            >
              <AppIcon :path="mdiChevronDown" :size="14" />
              <span class="icon-tooltip">Output Options</span>
            </button>

            <section
              v-if="outputSettingsMenuOpen"
              id="output-settings-menu"
              class="output-settings-menu"
              role="dialog"
              aria-label="Output settings"
            >
              <div class="device-row-wrap">
                <button
                  type="button"
                  class="output-settings-row output-device-trigger"
                  :disabled="!canSelectOutputDevice"
                  :aria-expanded="outputDeviceListOpen"
                  @click.stop="toggleOutputDeviceList"
                >
                  <span class="output-settings-copy">
                    <strong>Output Device</strong>
                    <small>{{ selectedOutputDeviceLabel }}</small>
                  </span>
                  <AppIcon :path="mdiChevronRight" :size="16" :class="{ 'is-rotated': outputDeviceListOpen }" />
                </button>

                <section
                  v-if="outputDeviceListOpen && canSelectOutputDevice"
                  class="device-selection-popout output-device-popout"
                  role="dialog"
                >
                  <button
                    v-for="device in outputDevices"
                    :key="device.deviceId"
                    type="button"
                    class="device-selection-option"
                    :class="{ 'is-active': device.deviceId === selectedOutputDeviceId }"
                    @click="chooseOutputDevice(device.deviceId)"
                  >
                    <span class="device-selection-copy">
                      <strong>{{ splitDeviceLabel(device.label).primary }}</strong>
                      <small v-if="splitDeviceLabel(device.label).secondary">
                        {{ splitDeviceLabel(device.label).secondary }}
                      </small>
                    </span>
                    <span
                      class="device-selection-indicator"
                      :class="{ 'is-active': device.deviceId === selectedOutputDeviceId }"
                    />
                  </button>
                  <button type="button" class="device-selection-more" @click="emit('openOutputOptions')">Show more...</button>
                </section>
              </div>

              <div class="output-settings-divider" />

              <div class="output-volume-group">
                <p>Output Volume</p>
                <label class="output-volume-slider">
                  <span class="sr-only">Output volume</span>
                  <input
                    :value="outputVolume"
                    type="range"
                    min="0"
                    max="100"
                    @input="emit('updateOutputVolume', Number(($event.target as HTMLInputElement).value))"
                  />
                </label>
              </div>

              <div class="output-settings-divider" />

              <button type="button" class="output-settings-row is-settings">
                <span class="output-settings-copy">
                  <strong>Voice Settings</strong>
                </span>
                <AppIcon :path="mdiCogOutline" :size="16" />
              </button>

              <p v-if="outputDeviceError" class="output-settings-error">{{ outputDeviceError }}</p>
            </section>
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
        :profile-display-name="profileDisplayName"
        :profile-avatar-mode="profileAvatarMode"
        :profile-avatar-preset-id="profileAvatarPresetId"
        :profile-avatar-image-data-url="profileAvatarImageDataUrl"
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
