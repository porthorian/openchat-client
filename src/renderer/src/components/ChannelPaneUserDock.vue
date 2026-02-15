<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mdiChevronDown,
  mdiChevronRight,
  mdiCogOutline,
  mdiHeadphones,
  mdiHeadphonesOff,
  mdiMicrophone,
  mdiMicrophoneOff
} from "@mdi/js";
import type { AvatarMode, UIDMode } from "@renderer/types/models";
import { avatarPresetById } from "@renderer/utils/avatarPresets";
import AppIcon from "./AppIcon.vue";
import ChannelVoiceConnectedCard from "./ChannelVoiceConnectedCard.vue";
import ProfilePanelCard from "./ProfilePanelCard.vue";

type OutputDevice = {
  deviceId: string;
  label: string;
};

type PresenceStatus = "online" | "idle" | "busy" | "invisible";

const props = defineProps<{
  serverName: string;
  activeVoiceChannelName: string | null;
  callState: "idle" | "joining" | "active" | "reconnecting" | "error";
  callParticipantCount: number;
  callErrorMessage?: string | null;
  localVoiceTransmitting: boolean;
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
  currentUid: string;
  profileDisplayName: string;
  profileAvatarMode: AvatarMode;
  profileAvatarPresetId: string;
  profileAvatarImageDataUrl: string | null;
  uidMode: UIDMode;
  disclosureMessage: string;
  startupError?: string | null;
}>();

const emit = defineEmits<{
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

const profileCardOpen = ref(false);
const presenceStatus = ref<PresenceStatus>("online");
const inputSettingsMenuOpen = ref(false);
const outputSettingsMenuOpen = ref(false);
const outputDeviceListOpen = ref(false);
const inputDeviceListOpen = ref(false);
const outputDevicePopoutSide = ref<"left" | "right">("left");

const profileDisplayNameLabel = computed(() => {
  const username = props.profileDisplayName.trim();
  if (!username) return "Unknown User";
  return username;
});
const profileAvatarText = computed(() => profileDisplayNameLabel.value.slice(0, 1).toUpperCase());
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
const micEffectivelyMuted = computed(() => props.micMuted || props.deafened);

function onWindowPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
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
    closeProfileCard();
    closeInputSettingsMenu();
    closeOutputSettingsMenu();
  }
}

function toggleProfileCard(): void {
  profileCardOpen.value = !profileCardOpen.value;
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
    closeProfileCard();
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
    closeProfileCard();
    closeInputSettingsMenu();
    emit("openOutputOptions");
  } else {
    outputDeviceListOpen.value = false;
  }
}

function closeOutputSettingsMenu(): void {
  outputSettingsMenuOpen.value = false;
  outputDeviceListOpen.value = false;
}

function resolvePopoutSide(triggerElement: HTMLElement, popoutWidth = 232): "left" | "right" {
  const triggerRect = triggerElement.getBoundingClientRect();
  const viewportPadding = 12;
  const availableRight = window.innerWidth - triggerRect.right - viewportPadding;
  const availableLeft = triggerRect.left - viewportPadding;

  if (availableRight >= popoutWidth) return "right";
  if (availableLeft >= popoutWidth) return "left";
  return availableRight >= availableLeft ? "right" : "left";
}

function toggleOutputDeviceList(event: MouseEvent): void {
  if (!canSelectOutputDevice.value) return;
  if (!outputDeviceListOpen.value) {
    const triggerElement = event.currentTarget as HTMLElement | null;
    if (triggerElement) {
      outputDevicePopoutSide.value = resolvePopoutSide(triggerElement);
    }
  }
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
  closeInputSettingsMenu();
  closeOutputSettingsMenu();
});
</script>

<template>
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
          <strong>{{ profileDisplayNameLabel }}</strong>
          <small>{{ profileHandle }}</small>
        </div>
      </button>

      <div class="user-actions">
        <div class="voice-control-group input-control-wrap" :class="{ 'is-muted': micEffectivelyMuted }">
          <button
            type="button"
            class="voice-control-btn"
            :aria-label="micEffectivelyMuted ? 'Unmute microphone' : 'Mute microphone'"
            @click="emit('toggleMic')"
          >
            <AppIcon :path="micEffectivelyMuted ? mdiMicrophoneOff : mdiMicrophone" :size="16" />
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
                @click.stop="toggleOutputDeviceList($event)"
              >
                <span class="output-settings-copy">
                  <strong>Output Device</strong>
                  <small>{{ selectedOutputDeviceLabel }}</small>
                </span>
                <AppIcon :path="mdiChevronRight" :size="16" :class="{ 'is-rotated': outputDeviceListOpen }" />
              </button>

              <section
                v-if="outputDeviceListOpen && canSelectOutputDevice"
                :class="[
                  'device-selection-popout',
                  'output-device-popout',
                  outputDevicePopoutSide === 'right' ? 'is-side-right' : 'is-side-left'
                ]"
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
      :profile-display-name="profileDisplayNameLabel"
      :profile-avatar-mode="profileAvatarMode"
      :profile-avatar-preset-id="profileAvatarPresetId"
      :profile-avatar-image-data-url="profileAvatarImageDataUrl"
      :uid-mode="uidMode"
      :disclosure-message="disclosureMessage"
      :startup-error="startupError"
      :presence-status="presenceStatus"
      @update:presence-status="setPresenceStatus"
      @toggle-uid-mode="emit('toggleUidMode')"
    />
  </footer>
</template>
