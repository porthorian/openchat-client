<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useDialogFocus } from "@renderer/composables/useDialogFocus";
import { useSettingsStore } from "@renderer/stores/settings";
import { PROFILE_PUBLICATION_APPROVED } from "@renderer/stores/profilePublication";
import { canonicalShortcut, defaultShortcuts, shortcutActions, type ShortcutAction, type NotificationPolicy } from "@renderer/stores/settingsModel";
import { GENERATED_AVATAR_PRESETS, DEFAULT_AVATAR_PRESET_ID } from "@renderer/utils/avatarPresets";
import type { AvatarMode } from "@renderer/types/models";

type UserSettingsTab = "my_account" | "voice_video" | "appearance" | "keybinds" | "notifications" | "accessibility" | "identity_privacy";
type DeviceOption = {
  deviceId: string;
  label: string;
};

const props = defineProps<{
  isOpen: boolean;
  initialTab: UserSettingsTab;
  displayName: string;
  userUID: string;
  uidMode: "server_scoped" | "global";
  disclosureMessage: string;
  avatarMode: AvatarMode;
  avatarPresetId: string;
  avatarImageDataUrl: string | null;
  serverId: string;
  serverName: string;
  notificationServerId: string;
  notificationServerName: string;
  backendUrl: string;
  profileScope: "global" | "server_scoped" | null;
  profileEnabled: boolean;
  profileConsent: boolean;
  profileSyncError: string | null;
  startupError: string | null;
  inputDevices: DeviceOption[];
  selectedInputDeviceId: string;
  inputVolume: number;
  inputDeviceError: string | null;
  outputDevices: DeviceOption[];
  selectedOutputDeviceId: string;
  outputVolume: number;
  outputSelectionSupported: boolean;
  outputDeviceError: string | null;
  videoInputDevices: DeviceOption[];
  selectedCameraDeviceId: string;
  cameraDeviceError: string | null;
  micTestActive: boolean;
  micTestLevel: number;
  micTestError: string | null;
  cameraTestActive: boolean;
  cameraTestStream: MediaStream | null;
  cameraTestError: string | null;
}>();

const emit = defineEmits<{
  close: [];
  refreshInputDevices: [];
  refreshOutputDevices: [];
  refreshVideoInputDevices: [];
  selectInputDevice: [deviceId: string];
  selectOutputDevice: [deviceId: string];
  selectCameraDevice: [deviceId: string];
  updateInputVolume: [value: number];
  updateOutputVolume: [value: number];
  startMicTest: [];
  stopMicTest: [];
  startCameraTest: [];
  stopCameraTest: [];
  toggleUidMode: [];
  saveProfile: [profile: { username: string; avatarMode: AvatarMode; avatarPresetId: string; avatarImageDataUrl: string | null }];
  setProfileConsent: [granted: boolean];
}>();

const activeTab = ref<UserSettingsTab>("my_account");
const cameraPreviewElement = ref<HTMLVideoElement | null>(null);
const dialogElement = ref<HTMLElement | null>(null);
const settings = useSettingsStore();
const profilePublicationApproved = PROFILE_PUBLICATION_APPROVED;
const draftName = ref("");
const draftAvatarMode = ref<AvatarMode>("generated");
const draftAvatarPresetId = ref(DEFAULT_AVATAR_PRESET_ID);
const draftAvatarImageDataUrl = ref<string | null>(null);
const profileError = ref<string | null>(null);
const profileNotice = ref<string | null>(null);
const consentAcknowledged = ref(false);
const recordingAction = ref<ShortcutAction | null>(null);
const shortcutError = ref<string | null>(null);
const permissionState = ref<NotificationPermission>(typeof Notification === "undefined" ? "denied" : Notification.permission);
const permissionError = ref<string | null>(null);
const tabLabels: Record<UserSettingsTab, string> = {
  my_account: "My Account", appearance: "Appearance", keybinds: "Keybinds", notifications: "Notifications",
  accessibility: "Accessibility", identity_privacy: "Identity & Privacy", voice_video: "Voice & Video"
};
const shortcutLabels: Record<ShortcutAction, string> = {
  settings: "Open settings", composer: "Focus composer", channelFilter: "Focus channel filter",
  previousServer: "Previous server", nextServer: "Next server", previousChannel: "Previous text channel",
  nextChannel: "Next text channel", members: "Toggle members pane", microphone: "Toggle microphone", deafen: "Toggle deafen"
};
const isMac = /mac/i.test(navigator.userAgent);

const displayNameLabel = computed(() => props.displayName.trim() || "Unknown User");
const handleLabel = computed(() => `@${props.userUID.trim() || "uid_unbound"}`);
const micLevelPercent = computed(() => Math.max(0, Math.min(100, Math.round(props.micTestLevel * 100))));
const supportsOutputSelection = computed(() => props.outputSelectionSupported);
const profileShareDescription = computed(() => props.profileScope === "global"
  ? `This backend (${props.backendUrl}) may show your display name and avatar across its communities.`
  : `Only ${props.serverName || "this server"} may receive your display name and avatar.`);

useDialogFocus(() => props.isOpen, dialogElement, onClose);

function saveProfile(): void {
  const username = draftName.value.trim().slice(0, 32);
  if (!username) { profileError.value = "Display name is required."; return; }
  if (draftAvatarMode.value === "uploaded" && !draftAvatarImageDataUrl.value) {
    profileError.value = "Choose an avatar image."; return;
  }
  emit("saveProfile", {
    username, avatarMode: draftAvatarMode.value, avatarPresetId: draftAvatarPresetId.value,
    avatarImageDataUrl: draftAvatarMode.value === "uploaded" ? draftAvatarImageDataUrl.value : null
  });
  profileError.value = null;
  profileNotice.value = "Profile saved on this device.";
}

function uploadAvatar(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
    profileError.value = "Use a PNG, JPG, or WEBP image no larger than 2 MB.";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== "string") { profileError.value = "Could not read avatar image."; return; }
    draftAvatarImageDataUrl.value = reader.result;
    draftAvatarMode.value = "uploaded";
    profileError.value = null;
  };
  reader.onerror = () => { profileError.value = "Could not read avatar image."; };
  reader.readAsDataURL(file);
}

function setConsent(granted: boolean): void {
  if (granted && !consentAcknowledged.value) { profileError.value = "Confirm the sharing scope first."; return; }
  emit("setProfileConsent", granted);
  profileError.value = null;
  consentAcknowledged.value = false;
}

function recordShortcut(action: ShortcutAction, event: KeyboardEvent): void {
  if (recordingAction.value !== action) return;
  if (event.key === "Tab") { recordingAction.value = null; return; }
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") { recordingAction.value = null; shortcutError.value = null; return; }
  const shortcut = canonicalShortcut(event, isMac);
  if (!shortcut) return;
  const error = settings.setShortcut(action, shortcut);
  shortcutError.value = error;
  if (!error) recordingAction.value = null;
}

async function requestNotificationPermission(): Promise<void> {
  if (typeof Notification === "undefined") return;
  try {
    permissionState.value = await Notification.requestPermission();
    permissionError.value = null;
  } catch {
    permissionError.value = "The operating system did not complete the permission request.";
  }
}

function activateTab(tab: UserSettingsTab): void {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  if (tab === "voice_video") {
    emit("refreshInputDevices");
    emit("refreshOutputDevices");
    emit("refreshVideoInputDevices");
  }
}

function onClose(): void {
  recordingAction.value = null;
  emit("close");
}

function syncCameraPreview(stream: MediaStream | null): void {
  const videoElement = cameraPreviewElement.value;
  if (!videoElement) return;
  if (!stream) {
    videoElement.pause();
    videoElement.srcObject = null;
    return;
  }
  videoElement.srcObject = stream;
  void videoElement.play().catch(() => {});
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) {
      syncCameraPreview(null);
      return;
    }
    activeTab.value = props.initialTab;
    draftName.value = props.displayName;
    draftAvatarMode.value = props.avatarMode;
    draftAvatarPresetId.value = props.avatarPresetId;
    draftAvatarImageDataUrl.value = props.avatarImageDataUrl;
    profileError.value = null;
    profileNotice.value = null;
    consentAcknowledged.value = false;
    permissionState.value = typeof Notification === "undefined" ? "denied" : Notification.permission;
    permissionError.value = null;
    if (props.initialTab === "voice_video") {
      emit("refreshInputDevices");
      emit("refreshOutputDevices");
      emit("refreshVideoInputDevices");
    }
    syncCameraPreview(props.cameraTestStream);
  },
  { immediate: true }
);

watch(
  () => props.initialTab,
  (nextTab) => {
    if (!props.isOpen) return;
    activateTab(nextTab);
  }
);

watch(
  () => props.cameraTestStream,
  (stream) => {
    if (!props.isOpen) return;
    syncCameraPreview(stream);
  }
);

onBeforeUnmount(() => {
  syncCameraPreview(null);
});
</script>

<template>
  <div v-if="isOpen" class="modal-backdrop" role="presentation" @click.self="onClose">
    <section ref="dialogElement" class="server-modal user-settings-modal" role="dialog" aria-modal="true" aria-labelledby="user-settings-title" tabindex="-1">
      <aside class="user-settings-nav">
        <div class="user-settings-profile">
          <strong>{{ displayNameLabel }}</strong>
          <small>{{ handleLabel }}</small>
        </div>

        <p class="user-settings-section-label">User Settings</p>
        <button
          type="button"
          class="user-settings-nav-btn"
          :class="{ 'is-active': activeTab === 'my_account' }"
          :aria-current="activeTab === 'my_account' ? 'page' : undefined"
          @click="activateTab('my_account')"
        >
          My Account
        </button>
        <button v-for="tab in (['appearance', 'keybinds', 'notifications', 'accessibility', 'identity_privacy'] as const)"
          :key="tab" type="button" class="user-settings-nav-btn" :class="{ 'is-active': activeTab === tab }"
          :aria-current="activeTab === tab ? 'page' : undefined" @click="activateTab(tab)">{{ tabLabels[tab] }}</button>
        <button
          type="button"
          class="user-settings-nav-btn"
          :class="{ 'is-active': activeTab === 'voice_video' }"
          :aria-current="activeTab === 'voice_video' ? 'page' : undefined"
          @click="activateTab('voice_video')"
        >
          Voice &amp; Video
        </button>
      </aside>

      <div class="user-settings-content">
        <header class="user-settings-header">
          <h3 id="user-settings-title" tabindex="-1" data-initial-focus aria-live="polite">{{ tabLabels[activeTab] }}</h3>
          <button type="button" class="server-modal-close" @click="onClose">Close</button>
        </header>

        <template v-if="activeTab === 'my_account'">
          <section class="voice-video-section">
            <h4>Local profile</h4>
            <p>Your display name and avatar are stored on this device. See Identity &amp; Privacy to choose where to share them.</p>
            <label class="server-modal-field"><span>Display name</span><input v-model="draftName" maxlength="32" autocomplete="nickname" /></label>
            <fieldset class="settings-fieldset"><legend>Avatar</legend>
              <label><input v-model="draftAvatarMode" type="radio" value="generated" /> Generated avatar</label>
              <label><input v-model="draftAvatarMode" type="radio" value="uploaded" /> Uploaded image</label>
            </fieldset>
            <label v-if="draftAvatarMode === 'generated'" class="server-modal-field"><span>Avatar color</span>
              <select v-model="draftAvatarPresetId"><option v-for="preset in GENERATED_AVATAR_PRESETS" :key="preset.id" :value="preset.id">{{ preset.id }}</option></select>
            </label>
            <label v-else class="server-modal-field"><span>Avatar image</span><input type="file" accept="image/png,image/jpeg,image/webp" @change="uploadAvatar" /></label>
            <img v-if="draftAvatarMode === 'uploaded' && draftAvatarImageDataUrl" class="settings-avatar-preview" :src="draftAvatarImageDataUrl" alt="Avatar preview" />
            <p v-if="profileError" class="user-settings-inline-error" role="alert">{{ profileError }}</p>
            <p v-if="profileNotice" role="status">{{ profileNotice }}</p>
            <button type="button" class="server-modal-btn is-primary" @click="saveProfile">Save profile</button>
          </section>
        </template>

        <template v-else-if="activeTab === 'voice_video'">
          <section class="voice-video-section">
            <h4>Voice</h4>
            <div class="voice-video-grid">
              <label class="server-modal-field">
                <span>Microphone</span>
                <select
                  :value="selectedInputDeviceId"
                  @change="emit('selectInputDevice', ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="device in inputDevices" :key="device.deviceId" :value="device.deviceId">
                    {{ device.label }}
                  </option>
                </select>
              </label>

              <label class="server-modal-field">
                <span>Speaker</span>
                <select
                  :value="selectedOutputDeviceId"
                  :disabled="!supportsOutputSelection"
                  @change="emit('selectOutputDevice', ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="device in outputDevices" :key="device.deviceId" :value="device.deviceId">
                    {{ device.label }}
                  </option>
                </select>
              </label>
            </div>

            <div class="voice-video-grid">
              <label class="server-modal-field">
                <span>Microphone Volume</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  :value="inputVolume"
                  @input="emit('updateInputVolume', Number(($event.target as HTMLInputElement).value))"
                />
              </label>

              <label class="server-modal-field">
                <span>Speaker Volume</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  :value="outputVolume"
                  @input="emit('updateOutputVolume', Number(($event.target as HTMLInputElement).value))"
                />
              </label>
            </div>

            <div class="voice-video-meter-row">
              <button
                type="button"
                class="server-modal-btn is-primary"
                @click="props.micTestActive ? emit('stopMicTest') : emit('startMicTest')"
              >
                {{ props.micTestActive ? "Stop Mic Test" : "Start Mic Test" }}
              </button>
              <div class="voice-video-meter" role="progressbar" aria-label="Microphone level" :aria-valuenow="micLevelPercent">
                <div class="voice-video-meter-fill" :style="{ width: `${micLevelPercent}%` }" />
              </div>
            </div>
            <p v-if="inputDeviceError" class="user-settings-inline-error">{{ inputDeviceError }}</p>
            <p v-if="!supportsOutputSelection" class="user-settings-inline-note">
              Output device switching is not supported in this runtime.
            </p>
            <p v-if="outputDeviceError" class="user-settings-inline-error">{{ outputDeviceError }}</p>
            <p v-if="micTestError" class="user-settings-inline-error">{{ micTestError }}</p>
          </section>

          <section class="voice-video-section">
            <h4>Camera</h4>
            <label class="server-modal-field">
              <span>Camera Device</span>
              <select
                :value="selectedCameraDeviceId"
                @change="emit('selectCameraDevice', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="device in videoInputDevices" :key="device.deviceId" :value="device.deviceId">
                  {{ device.label }}
                </option>
              </select>
            </label>

            <div class="voice-video-camera-actions">
              <button
                type="button"
                class="server-modal-btn is-primary"
                @click="props.cameraTestActive ? emit('stopCameraTest') : emit('startCameraTest')"
              >
                {{ props.cameraTestActive ? "Stop Camera Test" : "Start Camera Test" }}
              </button>
              <button type="button" class="server-modal-btn" @click="emit('refreshVideoInputDevices')">Refresh Devices</button>
            </div>

            <div class="voice-video-camera-preview">
              <video ref="cameraPreviewElement" autoplay playsinline muted />
              <p v-if="!props.cameraTestActive">Camera preview is stopped.</p>
            </div>
            <p v-if="cameraDeviceError" class="user-settings-inline-error">{{ cameraDeviceError }}</p>
            <p v-if="cameraTestError" class="user-settings-inline-error">{{ cameraTestError }}</p>
          </section>
        </template>
        <template v-else-if="activeTab === 'appearance'">
          <section class="voice-video-section">
            <h4>Theme</h4>
            <label class="server-modal-field"><span>Color theme</span>
              <select :value="settings.theme" @change="settings.setAppearance({ theme: ($event.target as HTMLSelectElement).value as 'dark' | 'light' | 'system' })">
                <option value="dark">Dark</option><option value="light">Light</option><option value="system">Follow system</option>
              </select>
            </label>
            <p>Theme changes apply to every server and to onboarding.</p>
          </section>
        </template>
        <template v-else-if="activeTab === 'keybinds'">
          <section class="voice-video-section">
            <h4>Keyboard shortcuts</h4>
            <p>Shortcuts work while this app is focused. Select a shortcut and press a key combination to replace it. Escape cancels recording.</p>
            <p v-if="shortcutError" class="user-settings-inline-error" role="alert">{{ shortcutError }}</p>
            <div v-for="action in shortcutActions" :key="action" class="settings-keybind-row">
              <span>{{ shortcutLabels[action] }}</span>
              <button type="button" class="server-modal-btn" :aria-pressed="recordingAction === action"
                @click="recordingAction = action; shortcutError = null" @keydown.capture="recordShortcut(action, $event)">
                {{ recordingAction === action ? 'Press shortcut…' : settings.shortcuts[action] }}
              </button>
              <button type="button" class="server-modal-btn" :disabled="settings.shortcuts[action] === defaultShortcuts[action]"
                :aria-label="`Reset ${shortcutLabels[action]}`" @click="settings.resetShortcut(action)">Reset</button>
            </div>
            <button type="button" class="server-modal-btn" @click="settings.resetShortcuts()">Reset all shortcuts</button>
          </section>
        </template>
        <template v-else-if="activeTab === 'notifications'">
          <section class="voice-video-section">
            <h4>Desktop notifications</h4>
            <label class="settings-check"><input type="checkbox" :checked="settings.notificationsEnabled"
              @change="settings.setNotificationPreference({ notificationsEnabled: ($event.target as HTMLInputElement).checked })" /> Enable notifications</label>
            <label class="settings-check"><input type="checkbox" :checked="settings.notificationSound"
              @change="settings.setNotificationPreference({ notificationSound: ($event.target as HTMLInputElement).checked })" /> Play system notification sound</label>
            <label class="settings-check"><input type="checkbox" :checked="settings.notificationPreview"
              @change="settings.setNotificationPreference({ notificationPreview: ($event.target as HTMLInputElement).checked })" /> Show message text in previews</label>
            <p role="status">System permission: {{ permissionState }}</p>
            <p v-if="permissionError" role="alert" class="user-settings-inline-error">{{ permissionError }}</p>
            <button v-if="permissionState === 'default'" type="button" class="server-modal-btn" @click="requestNotificationPermission">Allow notifications</button>
            <p v-else-if="permissionState === 'denied'">Allow notifications in your operating system settings to receive alerts.</p>
          </section>
          <section class="voice-video-section">
            <h4>Server policy</h4>
            <p v-if="!notificationServerId">Join a server to set its notification policy.</p>
            <label v-else class="server-modal-field"><span>{{ notificationServerName }}</span>
              <select :value="settings.policyFor(notificationServerId)" @change="settings.setPolicy(notificationServerId, ($event.target as HTMLSelectElement).value as NotificationPolicy)">
                <option value="all">All messages</option><option value="mentions">Only mentions</option><option value="off">Off</option>
              </select>
            </label>
            <p>Do Not Disturb suppresses desktop alerts across all servers.</p>
            <label class="server-modal-field"><span>Presence</span>
              <select :value="settings.presenceStatus" @change="settings.setNotificationPreference({ presenceStatus: ($event.target as HTMLSelectElement).value as 'online' | 'idle' | 'busy' | 'invisible' })">
                <option value="online">Online</option><option value="idle">Idle</option><option value="busy">Do Not Disturb</option><option value="invisible">Invisible</option>
              </select>
            </label>
          </section>
        </template>
        <template v-else-if="activeTab === 'accessibility'">
          <section class="voice-video-section">
            <h4>Display and motion</h4>
            <label class="server-modal-field"><span>Text size</span>
              <select :value="settings.textScale" @change="settings.setAppearance({ textScale: Number(($event.target as HTMLSelectElement).value) as 100 | 125 | 150 | 200 })">
                <option v-for="scale in [100, 125, 150, 200]" :key="scale" :value="scale">{{ scale }}%</option>
              </select>
            </label>
            <label class="server-modal-field"><span>Contrast</span>
              <select :value="settings.contrast" @change="settings.setAppearance({ contrast: ($event.target as HTMLSelectElement).value as 'system' | 'standard' | 'high' })">
                <option value="system">Follow system</option><option value="standard">Standard</option><option value="high">High contrast</option>
              </select>
            </label>
            <label class="server-modal-field"><span>Motion</span>
              <select :value="settings.motion" @change="settings.setAppearance({ motion: ($event.target as HTMLSelectElement).value as 'system' | 'full' | 'reduced' })">
                <option value="system">Follow system</option><option value="full">Full motion</option><option value="reduced">Reduced motion</option>
              </select>
            </label>
          </section>
        </template>
        <template v-else-if="activeTab === 'identity_privacy'">
          <section class="voice-video-section">
            <h4>Identity disclosure</h4>
            <p v-if="startupError" class="user-settings-inline-error" role="alert">{{ startupError }}</p>
            <p>{{ disclosureMessage }}</p>
            <p>Current UID: <code>{{ userUID }}</code></p>
            <button type="button" class="server-modal-btn" @click="emit('toggleUidMode')">Switch UID mode ({{ uidMode }})</button>
          </section>
          <section class="voice-video-section">
            <h4>Profile sharing</h4>
            <p v-if="!profileEnabled || !profileScope">This server does not offer profile sharing.</p>
            <template v-else>
              <p>{{ profileShareDescription }}</p>
              <p>Sharing includes your display name and avatar. Turning it off stops future updates; the backend may retain information previously shared.</p>
              <p v-if="!profilePublicationApproved" role="status">Profile sharing is awaiting security review and is unavailable in this build.</p>
              <p v-else role="status">{{ profileConsent ? 'Sharing enabled' : 'Sharing off' }}</p>
              <label v-if="!profileConsent" class="settings-check"><input v-model="consentAcknowledged" type="checkbox" /> I understand who can see my profile.</label>
              <p v-if="profileError" class="user-settings-inline-error" role="alert">{{ profileError }}</p>
              <button type="button" class="server-modal-btn is-primary" :disabled="!profilePublicationApproved && !profileConsent" @click="setConsent(!profileConsent)">
                {{ profileConsent ? 'Stop future sharing' : 'Share profile' }}
              </button>
              <p v-if="profileSyncError" class="user-settings-inline-error" role="alert">{{ profileSyncError }}</p>
            </template>
          </section>
        </template>
        <p v-if="settings.persistenceError" class="user-settings-inline-error" role="alert">Settings changed for this session but could not be saved. Check local storage availability.</p>
      </div>
    </section>
  </div>
</template>
