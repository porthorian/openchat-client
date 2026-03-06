<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

type UserSettingsTab = "my_account" | "voice_video";
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
}>();

const activeTab = ref<UserSettingsTab>("my_account");
const cameraPreviewElement = ref<HTMLVideoElement | null>(null);

const displayNameLabel = computed(() => props.displayName.trim() || "Unknown User");
const handleLabel = computed(() => `@${props.userUID.trim() || "uid_unbound"}`);
const micLevelPercent = computed(() => Math.max(0, Math.min(100, Math.round(props.micTestLevel * 100))));
const supportsOutputSelection = computed(() => props.outputSelectionSupported);

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
    if (props.initialTab === "voice_video") {
      emit("refreshInputDevices");
      emit("refreshOutputDevices");
      emit("refreshVideoInputDevices");
    }
    syncCameraPreview(props.cameraTestStream);
  }
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
    <section class="server-modal user-settings-modal" role="dialog" aria-modal="true" aria-label="User settings">
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
          @click="activateTab('my_account')"
        >
          My Account
        </button>
        <button
          type="button"
          class="user-settings-nav-btn"
          :class="{ 'is-active': activeTab === 'voice_video' }"
          @click="activateTab('voice_video')"
        >
          Voice &amp; Video
        </button>
      </aside>

      <div class="user-settings-content">
        <header class="user-settings-header">
          <h3>{{ activeTab === "voice_video" ? "Voice & Video" : "My Account" }}</h3>
          <button type="button" class="server-modal-close" @click="onClose">Close</button>
        </header>

        <template v-if="activeTab === 'my_account'">
          <section class="user-settings-placeholder-card">
            <h4>{{ displayNameLabel }}</h4>
            <p>Profile and account controls will continue to expand here in future iterations.</p>
          </section>

          <section class="voice-video-section">
            <h4>Identity Disclosure</h4>
            <p v-if="startupError" class="user-settings-inline-error">{{ startupError }}</p>
            <p class="user-settings-identity-copy">{{ disclosureMessage }}</p>
            <p class="user-settings-identity-uid">
              current UID:
              <code>{{ userUID }}</code>
            </p>
            <button type="button" class="server-modal-btn is-primary" @click="emit('toggleUidMode')">
              Switch UID mode ({{ uidMode }})
            </button>
          </section>
        </template>

        <template v-else>
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
      </div>
    </section>
  </div>
</template>
