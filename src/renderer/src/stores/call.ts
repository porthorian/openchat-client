import { defineStore } from "pinia";
import { fetchServerCapabilities, requestJoinTicket, sendSignal, type SignalEnvelope } from "@renderer/services/rtcClient";
import { useServerRegistryStore } from "@renderer/stores/serverRegistry";

export type CallConnectionState = "idle" | "joining" | "active" | "reconnecting" | "error";

export type CallParticipant = {
  participantId: string;
  userUID: string;
  deviceID: string;
  joinedAt: string;
  isLocal: boolean;
};

export type ChannelCallSession = {
  state: CallConnectionState;
  participants: CallParticipant[];
  localParticipantId: string | null;
  activeSpeakerParticipantIds: string[];
  micMuted: boolean;
  deafened: boolean;
  errorMessage: string | null;
  joinedAt: string | null;
  lastEventAt: string | null;
};

export type AudioOutputDevice = {
  deviceId: string;
  label: string;
};

export type AudioInputDevice = {
  deviceId: string;
  label: string;
};

type CallState = {
  activeVoiceChannelByServer: Record<string, string | null>;
  sessionsByKey: Record<string, ChannelCallSession>;
  audioPrefsByServer: Record<
    string,
    {
      micMuted: boolean;
      deafened: boolean;
    }
  >;
  inputDevices: AudioInputDevice[];
  selectedInputDeviceId: string;
  inputVolume: number;
  inputDeviceError: string | null;
  outputDevices: AudioOutputDevice[];
  selectedOutputDeviceId: string;
  outputVolume: number;
  outputSelectionSupported: boolean;
  outputDeviceError: string | null;
};

const DEFAULT_OUTPUT_DEVICE_ID = "default";
const DEFAULT_OUTPUT_DEVICE_LABEL = "System Default";
const socketsByKey = new Map<string, WebSocket>();
const intentionallyClosed = new Set<string>();
const nextPlaybackTimeByStream = new Map<string, number>();
const micUplinksByKey = new Map<string, MicUplink>();
const localJoinIdentityByKey = new Map<string, { userUID: string; deviceID: string }>();
const speakingTimersByParticipant = new Map<string, ReturnType<typeof setTimeout>>();
let playbackAudioContext: AudioContext | null = null;
let playbackGainNode: GainNode | null = null;
let playbackDestinationNode: MediaStreamAudioDestinationNode | null = null;
let playbackAudioElement: HTMLAudioElement | null = null;
let playbackMuted = false;
let playbackVolume = 0.5;
const speakingIndicatorHoldMS = 450;
const speakingActivityThreshold = 0.018;

type AudioElementWithSink = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

type MicUplink = {
  channelId: string;
  streamId: string;
  mediaStream: MediaStream;
  audioContext: AudioContext;
  sourceNode: MediaStreamAudioSourceNode;
  processorNode: ScriptProcessorNode;
  sinkNode: GainNode;
  chunkSeq: number;
};

function sessionKey(serverId: string, channelId: string): string {
  return `${serverId}:${channelId}`;
}

function createEmptySession(): ChannelCallSession {
  return {
    state: "idle",
    participants: [],
    localParticipantId: null,
    activeSpeakerParticipantIds: [],
    micMuted: false,
    deafened: false,
    errorMessage: null,
    joinedAt: null,
    lastEventAt: null
  };
}

function parseSignalEnvelope(rawMessage: string): SignalEnvelope | null {
  try {
    return JSON.parse(rawMessage) as SignalEnvelope;
  } catch (_error) {
    return null;
  }
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function supportsOutputSelection(): boolean {
  if (typeof window === "undefined") return false;
  const mediaElementProto = HTMLMediaElement.prototype as HTMLMediaElement & {
    setSinkId?: (deviceId: string) => Promise<void>;
  };
  return typeof mediaElementProto.setSinkId === "function";
}

function applyPlaybackGain(): void {
  if (!playbackGainNode) return;
  playbackGainNode.gain.value = playbackMuted ? 0 : playbackVolume;
}

function ensureAudioPlayback(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!playbackAudioContext) {
    playbackAudioContext = new AudioContext({
      sampleRate: 48000
    });
  }
  if (!playbackGainNode) {
    playbackGainNode = playbackAudioContext.createGain();
  }
  if (!playbackDestinationNode) {
    playbackDestinationNode = playbackAudioContext.createMediaStreamDestination();
  }
  try {
    playbackGainNode.disconnect();
  } catch (_error) {
    // No-op; disconnect can throw when there are no existing connections.
  }
  playbackGainNode.connect(playbackDestinationNode);

  if (!playbackAudioElement) {
    playbackAudioElement = new Audio();
    playbackAudioElement.autoplay = true;
    playbackAudioElement.preload = "auto";
  }
  if (playbackAudioElement.srcObject !== playbackDestinationNode.stream) {
    playbackAudioElement.srcObject = playbackDestinationNode.stream;
  }
  if (playbackAudioContext.state === "suspended") {
    void playbackAudioContext.resume();
  }
  applyPlaybackGain();
  void playbackAudioElement.play().catch(() => {});
  return playbackAudioContext;
}

function setPlaybackMuted(isMuted: boolean): void {
  playbackMuted = isMuted;
  applyPlaybackGain();
}

function setPlaybackVolume(volume: number): void {
  playbackVolume = Math.max(0, Math.min(1, volume));
  applyPlaybackGain();
}

async function setPlaybackSinkDevice(deviceId: string): Promise<boolean> {
  ensureAudioPlayback();
  if (!playbackAudioElement) return false;
  const sinkElement = playbackAudioElement as AudioElementWithSink;
  if (typeof sinkElement.setSinkId !== "function") return false;
  await sinkElement.setSinkId(deviceId || DEFAULT_OUTPUT_DEVICE_ID);
  return true;
}

async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [
      {
        deviceId: DEFAULT_OUTPUT_DEVICE_ID,
        label: DEFAULT_OUTPUT_DEVICE_LABEL
      }
    ];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  const deduped = new Map<string, AudioOutputDevice>();
  outputs.forEach((device, index) => {
    const deviceId = device.deviceId || DEFAULT_OUTPUT_DEVICE_ID;
    const fallbackLabel = deviceId === DEFAULT_OUTPUT_DEVICE_ID ? DEFAULT_OUTPUT_DEVICE_LABEL : `Output Device ${index + 1}`;
    deduped.set(deviceId, {
      deviceId,
      label: device.label.trim() || fallbackLabel
    });
  });

  if (!deduped.has(DEFAULT_OUTPUT_DEVICE_ID)) {
    deduped.set(DEFAULT_OUTPUT_DEVICE_ID, {
      deviceId: DEFAULT_OUTPUT_DEVICE_ID,
      label: DEFAULT_OUTPUT_DEVICE_LABEL
    });
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.deviceId === DEFAULT_OUTPUT_DEVICE_ID) return -1;
    if (right.deviceId === DEFAULT_OUTPUT_DEVICE_ID) return 1;
    return left.label.localeCompare(right.label);
  });
}

async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [
      {
        deviceId: DEFAULT_OUTPUT_DEVICE_ID,
        label: "System Default (Microphone)"
      }
    ];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const deduped = new Map<string, AudioInputDevice>();
  inputs.forEach((device, index) => {
    const deviceId = device.deviceId || DEFAULT_OUTPUT_DEVICE_ID;
    const fallbackLabel = deviceId === DEFAULT_OUTPUT_DEVICE_ID ? "System Default (Microphone)" : `Input Device ${index + 1}`;
    deduped.set(deviceId, {
      deviceId,
      label: device.label.trim() || fallbackLabel
    });
  });

  if (!deduped.has(DEFAULT_OUTPUT_DEVICE_ID)) {
    deduped.set(DEFAULT_OUTPUT_DEVICE_ID, {
      deviceId: DEFAULT_OUTPUT_DEVICE_ID,
      label: "System Default (Microphone)"
    });
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.deviceId === DEFAULT_OUTPUT_DEVICE_ID) return -1;
    if (right.deviceId === DEFAULT_OUTPUT_DEVICE_ID) return 1;
    return left.label.localeCompare(right.label);
  });
}

function clearPlaybackState(): void {
  nextPlaybackTimeByStream.clear();
}

function speakingTimerKey(serverId: string, channelId: string, participantId: string): string {
  return `${serverId}:${channelId}:${participantId}`;
}

function estimatePCM16Activity(bytes: Uint8Array): number {
  if (bytes.length < 2) return 0;
  let total = 0;
  let samples = 0;
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const lo = bytes[index];
    const hi = bytes[index + 1];
    let value = (hi << 8) | lo;
    if (value >= 0x8000) value -= 0x10000;
    total += Math.abs(value) / 32768;
    samples += 1;
  }
  if (samples === 0) return 0;
  return total / samples;
}

function estimateFloat32Activity(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    total += Math.abs(samples[index]);
  }
  return total / samples.length;
}

function encodePCM16Mono(samples: Float32Array): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    const scaled = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    const value = scaled < 0 ? scaled + 0x10000 : scaled;
    pcm[index * 2] = value & 0xff;
    pcm[index * 2 + 1] = (value >> 8) & 0xff;
  }
  return pcm;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return window.btoa(binary);
}

function decodeBase64Chunk(chunkB64: string): Uint8Array | null {
  try {
    const binary = window.atob(chunkB64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (_error) {
    return null;
  }
}

function decodePCM16LEInterleaved(bytes: Uint8Array, channels: number): Float32Array[] {
  const sampleCount = Math.floor(bytes.length / 2 / channels);
  const channelBuffers: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(sampleCount));
  let offset = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const lo = bytes[offset];
      const hi = bytes[offset + 1];
      offset += 2;
      let value = (hi << 8) | lo;
      if (value >= 0x8000) value -= 0x10000;
      channelBuffers[channel][sample] = value / 32768;
    }
  }
  return channelBuffers;
}

function schedulePCMPlayback(params: {
  streamKey: string;
  chunkB64: string;
  sampleRate: number;
  channels: number;
}): void {
  const context = ensureAudioPlayback();
  if (!context) return;
  const bytes = decodeBase64Chunk(params.chunkB64);
  if (!bytes || bytes.length < 2) return;

  const channelCount = Math.max(1, Math.min(2, params.channels));
  const sampleRate = Math.max(8000, Math.min(96000, params.sampleRate));
  const samplesByChannel = decodePCM16LEInterleaved(bytes, channelCount);
  if (samplesByChannel.length === 0 || samplesByChannel[0].length === 0) return;

  const audioBuffer = context.createBuffer(channelCount, samplesByChannel[0].length, sampleRate);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    channelData.set(samplesByChannel[channel]);
  }

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(playbackGainNode ?? context.destination);
  const earliest = context.currentTime + 0.01;
  const scheduledStart = Math.max(earliest, nextPlaybackTimeByStream.get(params.streamKey) ?? earliest);
  source.start(scheduledStart);
  nextPlaybackTimeByStream.set(params.streamKey, scheduledStart + audioBuffer.duration);
}

function toParticipant(payload: Record<string, unknown>, isLocal: boolean): CallParticipant {
  return {
    participantId: String(payload.participant_id ?? ""),
    userUID: String(payload.user_uid ?? "uid_unknown"),
    deviceID: String(payload.device_id ?? "device_unknown"),
    joinedAt: String(payload.joined_at ?? new Date().toISOString()),
    isLocal
  };
}

function isPlaceholderUserUID(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "uid_local" || normalized === "uid_unknown" || normalized === "uid_pending";
}

function isPlaceholderDeviceID(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "device_local" || normalized === "device_unknown";
}

export const useCallStore = defineStore("call", {
  state: (): CallState => ({
    activeVoiceChannelByServer: {},
    sessionsByKey: {},
    audioPrefsByServer: {},
    inputDevices: [
      {
        deviceId: DEFAULT_OUTPUT_DEVICE_ID,
        label: "System Default (Microphone)"
      }
    ],
    selectedInputDeviceId: DEFAULT_OUTPUT_DEVICE_ID,
    inputVolume: 100,
    inputDeviceError: null,
    outputDevices: [
      {
        deviceId: DEFAULT_OUTPUT_DEVICE_ID,
        label: DEFAULT_OUTPUT_DEVICE_LABEL
      }
    ],
    selectedOutputDeviceId: DEFAULT_OUTPUT_DEVICE_ID,
    outputVolume: 50,
    outputSelectionSupported: supportsOutputSelection(),
    outputDeviceError: null
  }),
  getters: {
    sessionFor: (state) => (serverId: string, channelId: string): ChannelCallSession => {
      return state.sessionsByKey[sessionKey(serverId, channelId)] ?? createEmptySession();
    },
    participantsFor:
      (state) =>
      (serverId: string, channelId: string): CallParticipant[] => {
        return state.sessionsByKey[sessionKey(serverId, channelId)]?.participants ?? [];
      },
    activeChannelFor: (state) => (serverId: string): string | null => {
      return state.activeVoiceChannelByServer[serverId] ?? null;
    },
    micMutedForServer: (state) => (serverId: string): boolean => {
      return state.audioPrefsByServer[serverId]?.micMuted ?? false;
    },
    deafenedForServer: (state) => (serverId: string): boolean => {
      return state.audioPrefsByServer[serverId]?.deafened ?? false;
    }
  },
  actions: {
    ensureAudioPrefs(serverId: string): { micMuted: boolean; deafened: boolean } {
      if (!this.audioPrefsByServer[serverId]) {
        this.audioPrefsByServer[serverId] = {
          micMuted: false,
          deafened: false
        };
      }
      return this.audioPrefsByServer[serverId];
    },
    ensureSession(serverId: string, channelId: string): string {
      const key = sessionKey(serverId, channelId);
      if (!this.sessionsByKey[key]) {
        this.sessionsByKey[key] = createEmptySession();
      }
      return key;
    },
    markParticipantSpeaking(serverId: string, channelId: string, participantId: string): void {
      if (!participantId) return;
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session.activeSpeakerParticipantIds.includes(participantId)) {
        session.activeSpeakerParticipantIds = [...session.activeSpeakerParticipantIds, participantId];
      }
      const timerKey = speakingTimerKey(serverId, channelId, participantId);
      const existingTimer = speakingTimersByParticipant.get(timerKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const timer = setTimeout(() => {
        speakingTimersByParticipant.delete(timerKey);
        this.clearParticipantSpeaking(serverId, channelId, participantId);
      }, speakingIndicatorHoldMS);
      speakingTimersByParticipant.set(timerKey, timer);
    },
    clearParticipantSpeaking(serverId: string, channelId: string, participantId: string): void {
      if (!participantId) return;
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      session.activeSpeakerParticipantIds = session.activeSpeakerParticipantIds.filter((id) => id !== participantId);
      const timerKey = speakingTimerKey(serverId, channelId, participantId);
      const timer = speakingTimersByParticipant.get(timerKey);
      if (!timer) return;
      clearTimeout(timer);
      speakingTimersByParticipant.delete(timerKey);
    },
    clearSpeakingForSession(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (session) {
        session.activeSpeakerParticipantIds = [];
      }
      const prefix = `${serverId}:${channelId}:`;
      for (const [timerKey, timer] of speakingTimersByParticipant.entries()) {
        if (!timerKey.startsWith(prefix)) continue;
        clearTimeout(timer);
        speakingTimersByParticipant.delete(timerKey);
      }
    },
    async refreshInputDevices(): Promise<void> {
      try {
        this.inputDevices = await listAudioInputDevices();
        if (!this.inputDevices.some((device) => device.deviceId === this.selectedInputDeviceId)) {
          this.selectedInputDeviceId = DEFAULT_OUTPUT_DEVICE_ID;
        }
        this.inputDeviceError = null;
      } catch (error) {
        this.inputDevices = [
          {
            deviceId: DEFAULT_OUTPUT_DEVICE_ID,
            label: "System Default (Microphone)"
          }
        ];
        this.selectedInputDeviceId = DEFAULT_OUTPUT_DEVICE_ID;
        this.inputDeviceError = (error as Error).message;
      }
    },
    async selectInputDevice(deviceId: string): Promise<void> {
      const nextDeviceId = deviceId.trim() || DEFAULT_OUTPUT_DEVICE_ID;
      this.selectedInputDeviceId = nextDeviceId;
      this.inputDeviceError = null;

      for (const [serverId, channelId] of Object.entries(this.activeVoiceChannelByServer)) {
        if (!channelId) continue;
        const key = this.ensureSession(serverId, channelId);
        const session = this.sessionsByKey[key];
        if (session.state !== "active" || session.micMuted) continue;
        this.stopMicUplink(serverId, channelId);
        await this.startMicUplink(serverId, channelId);
      }
    },
    setInputVolume(volume: number): void {
      this.inputVolume = Math.max(0, Math.min(200, Math.round(volume)));
    },
    async startMicUplink(serverId: string, channelId: string): Promise<void> {
      const key = this.ensureSession(serverId, channelId);
      if (micUplinksByKey.has(key)) return;
      const session = this.sessionsByKey[key];
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        session.errorMessage = "Microphone capture is not supported in this runtime.";
        return;
      }

      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        const useCustomInputDevice = this.selectedInputDeviceId && this.selectedInputDeviceId !== DEFAULT_OUTPUT_DEVICE_ID;
        const baseAudioConstraints: MediaTrackConstraints = {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };
        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              ...baseAudioConstraints,
              ...(useCustomInputDevice ? { deviceId: { exact: this.selectedInputDeviceId } } : {})
            }
          });
        } catch (firstError) {
          if (!useCustomInputDevice) {
            throw firstError;
          }
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: baseAudioConstraints
          });
          this.selectedInputDeviceId = DEFAULT_OUTPUT_DEVICE_ID;
          this.inputDeviceError = "Selected input device was unavailable; using system default microphone.";
        }
        const audioContext = new AudioContext({ sampleRate: 48000 });
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }

        const activeSession = this.sessionsByKey[key];
        const activeSocket = socketsByKey.get(key);
        if (!activeSession || activeSession.state !== "active" || !activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
          mediaStream.getTracks().forEach((track) => {
            track.stop();
          });
          if (audioContext.state !== "closed") {
            void audioContext.close().catch(() => {});
          }
          return;
        }

        const sourceNode = audioContext.createMediaStreamSource(mediaStream);
        const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
        const sinkNode = audioContext.createGain();
        sinkNode.gain.value = 0;

        sourceNode.connect(processorNode);
        processorNode.connect(sinkNode);
        sinkNode.connect(audioContext.destination);

        const uplink: MicUplink = {
          channelId,
          streamId: `mic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          mediaStream,
          audioContext,
          sourceNode,
          processorNode,
          sinkNode,
          chunkSeq: 0
        };
        micUplinksByKey.set(key, uplink);
        session.errorMessage = null;

        processorNode.onaudioprocess = (event) => {
          const activeSession = this.sessionsByKey[key];
          if (!activeSession) return;
          if (activeSession.state !== "active" || activeSession.micMuted) return;
          const activeSocket = socketsByKey.get(key);
          if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;

          const input = event.inputBuffer.getChannelData(0);
          if (input.length === 0) return;

          const volumeScale = Math.max(0, this.inputVolume / 100);
          const scaledInput = new Float32Array(input.length);
          for (let index = 0; index < input.length; index += 1) {
            scaledInput[index] = input[index] * volumeScale;
          }

          const activity = estimateFloat32Activity(scaledInput);
          if (activity >= speakingActivityThreshold && activeSession.localParticipantId) {
            this.markParticipantSpeaking(serverId, channelId, activeSession.localParticipantId);
          }

          const chunk = encodePCM16Mono(scaledInput);
          const chunkB64 = encodeBase64(chunk);
          const seq = uplink.chunkSeq;
          uplink.chunkSeq += 1;

          sendSignal(activeSocket, {
            type: "rtc.media.state",
            request_id: `pcm_${Date.now()}_${seq}`,
            channel_id: uplink.channelId,
            payload: {
              stream_id: uplink.streamId,
              stream_kind: "audio_pcm_s16le_48k_mono",
              sample_rate_hz: event.inputBuffer.sampleRate,
              channels: 1,
              encoding: "pcm_s16le",
              chunk_seq: seq,
              chunk_b64: chunkB64
            }
          });
        };
      } catch (error) {
        session.errorMessage = `Microphone unavailable: ${(error as Error).message}`;
      }
    },
    stopMicUplink(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const uplink = micUplinksByKey.get(key);
      if (!uplink) return;

      uplink.processorNode.onaudioprocess = null;
      try {
        uplink.sourceNode.disconnect();
      } catch (_error) {
        // No-op
      }
      try {
        uplink.processorNode.disconnect();
      } catch (_error) {
        // No-op
      }
      try {
        uplink.sinkNode.disconnect();
      } catch (_error) {
        // No-op
      }
      uplink.mediaStream.getTracks().forEach((track) => {
        track.stop();
      });
      if (uplink.audioContext.state !== "closed") {
        void uplink.audioContext.close().catch(() => {});
      }
      micUplinksByKey.delete(key);
    },
    async refreshOutputDevices(): Promise<void> {
      try {
        this.outputDevices = await listAudioOutputDevices();
        if (!this.outputDevices.some((device) => device.deviceId === this.selectedOutputDeviceId)) {
          this.selectedOutputDeviceId = DEFAULT_OUTPUT_DEVICE_ID;
        }
        this.outputDeviceError = null;
      } catch (error) {
        this.outputDevices = [
          {
            deviceId: DEFAULT_OUTPUT_DEVICE_ID,
            label: DEFAULT_OUTPUT_DEVICE_LABEL
          }
        ];
        this.selectedOutputDeviceId = DEFAULT_OUTPUT_DEVICE_ID;
        this.outputDeviceError = (error as Error).message;
      }
    },
    async selectOutputDevice(deviceId: string): Promise<void> {
      const nextDeviceID = deviceId.trim() || DEFAULT_OUTPUT_DEVICE_ID;
      try {
        const applied = await setPlaybackSinkDevice(nextDeviceID);
        if (!applied && nextDeviceID !== DEFAULT_OUTPUT_DEVICE_ID) {
          this.outputSelectionSupported = false;
          this.outputDeviceError = "Output device switching is not supported on this runtime.";
          return;
        }
        this.selectedOutputDeviceId = nextDeviceID;
        this.outputDeviceError = null;
      } catch (error) {
        this.outputDeviceError = (error as Error).message;
      }
    },
    setOutputVolume(volume: number): void {
      const normalized = Math.max(0, Math.min(100, Math.round(volume)));
      this.outputVolume = normalized;
      setPlaybackVolume(normalized / 100);
    },
    async toggleVoiceChannel(params: {
      serverId: string;
      channelId: string;
      backendUrl: string;
      userUID: string;
      deviceID: string;
    }): Promise<void> {
      const active = this.activeVoiceChannelByServer[params.serverId] ?? null;
      if (active === params.channelId) {
        this.leaveChannel(params.serverId, params.channelId);
        return;
      }
      if (active) {
        this.leaveChannel(params.serverId, active);
      }
      await this.joinChannel(params);
    },
    async joinChannel(params: {
      serverId: string;
      channelId: string;
      backendUrl: string;
      userUID: string;
      deviceID: string;
    }): Promise<void> {
      ensureAudioPlayback();
      setPlaybackVolume(this.outputVolume / 100);
      void this.refreshInputDevices();
      void this.refreshOutputDevices();
      void this.selectOutputDevice(this.selectedOutputDeviceId);
      const key = this.ensureSession(params.serverId, params.channelId);
      const audioPrefs = this.ensureAudioPrefs(params.serverId);
      const session = this.sessionsByKey[key];
      session.micMuted = audioPrefs.micMuted;
      session.deafened = audioPrefs.deafened;
      this.stopMicUplink(params.serverId, params.channelId);
      session.state = "joining";
      session.errorMessage = null;
      session.participants = [];
      session.localParticipantId = null;
      this.clearSpeakingForSession(params.serverId, params.channelId);
      session.joinedAt = null;
      session.lastEventAt = new Date().toISOString();
      localJoinIdentityByKey.set(key, {
        userUID: params.userUID,
        deviceID: params.deviceID
      });

      try {
        const capabilities = await fetchServerCapabilities(params.backendUrl);
        const registry = useServerRegistryStore();
        registry.setCapabilities(params.serverId, capabilities);
        if (!capabilities.rtc) {
          throw new Error("Server does not advertise RTC support");
        }
        const joinTicket = await requestJoinTicket({
          backendUrl: params.backendUrl,
          channelId: params.channelId,
          userUID: params.userUID,
          deviceID: params.deviceID,
          serverID: params.serverId
        });

        intentionallyClosed.delete(key);
        const socket = new WebSocket(joinTicket.signaling_url);
        socketsByKey.set(key, socket);
        this.activeVoiceChannelByServer[params.serverId] = params.channelId;

        socket.addEventListener("open", () => {
          sendSignal(socket, {
            type: "rtc.join",
            request_id: `join_${Date.now()}`,
            channel_id: params.channelId,
            payload: {
              ticket: joinTicket.ticket
            }
          });
        });

        socket.addEventListener("message", (event: MessageEvent<string>) => {
          const envelope = parseSignalEnvelope(event.data);
          if (!envelope) return;
          this.handleSignalEnvelope({
            serverId: params.serverId,
            channelId: params.channelId,
            envelope
          });
        });

        socket.addEventListener("close", () => {
          this.stopMicUplink(params.serverId, params.channelId);
          const localSession = this.sessionsByKey[key];
          localJoinIdentityByKey.delete(key);
          if (!localSession) return;
          localSession.lastEventAt = new Date().toISOString();
          if (intentionallyClosed.has(key)) {
            intentionallyClosed.delete(key);
            localSession.state = "idle";
            localSession.participants = [];
            localSession.localParticipantId = null;
            this.clearSpeakingForSession(params.serverId, params.channelId);
            localSession.errorMessage = null;
            return;
          }
          localSession.state = "error";
          localSession.errorMessage = "Call signaling disconnected.";
          localSession.participants = [];
          localSession.localParticipantId = null;
          this.clearSpeakingForSession(params.serverId, params.channelId);
          this.activeVoiceChannelByServer[params.serverId] = null;
        });

        socket.addEventListener("error", () => {
          this.stopMicUplink(params.serverId, params.channelId);
          const localSession = this.sessionsByKey[key];
          localJoinIdentityByKey.delete(key);
          if (!localSession) return;
          localSession.state = "error";
          localSession.errorMessage = "Call signaling transport failed.";
          this.clearSpeakingForSession(params.serverId, params.channelId);
          localSession.lastEventAt = new Date().toISOString();
        });
      } catch (error) {
        session.state = "error";
        session.errorMessage = (error as Error).message;
        this.activeVoiceChannelByServer[params.serverId] = null;
        localJoinIdentityByKey.delete(key);
      }
    },
    handleSignalEnvelope(params: { serverId: string; channelId: string; envelope: SignalEnvelope }): void {
      const key = this.ensureSession(params.serverId, params.channelId);
      const session = this.sessionsByKey[key];
      session.lastEventAt = new Date().toISOString();
      const payload = (params.envelope.payload ?? {}) as Record<string, unknown>;

      switch (params.envelope.type) {
        case "rtc.joined": {
          const localIdentity = localJoinIdentityByKey.get(key);
          const participants = Array.isArray(payload.participants)
            ? payload.participants
                .filter((item) => typeof item === "object" && item !== null)
                .map((item) =>
                  toParticipant(item as Record<string, unknown>, String((item as Record<string, unknown>).participant_id) === String(payload.participant_id))
                )
            : [];
          const localParticipantID = String(payload.participant_id ?? "");
          const localParticipantIndex = participants.findIndex((item) => item.participantId === localParticipantID);
          if (localParticipantIndex >= 0) {
            const localParticipant = participants[localParticipantIndex];
            participants[localParticipantIndex] = {
              ...localParticipant,
              userUID:
                localIdentity && isPlaceholderUserUID(localParticipant.userUID) ? localIdentity.userUID : localParticipant.userUID,
              deviceID:
                localIdentity && isPlaceholderDeviceID(localParticipant.deviceID)
                  ? localIdentity.deviceID
                  : localParticipant.deviceID,
              isLocal: true
            };
          } else if (localParticipantID) {
            participants.unshift(
              toParticipant(
                {
                  participant_id: localParticipantID,
                  channel_id: params.channelId,
                  user_uid: localIdentity?.userUID ?? "uid_unknown",
                  device_id: localIdentity?.deviceID ?? "device_unknown",
                  joined_at: new Date().toISOString()
                },
                true
              )
            );
          }
          session.state = "active";
          session.participants = participants;
          session.localParticipantId = localParticipantID || null;
          session.activeSpeakerParticipantIds = [];
          setPlaybackMuted(session.deafened);
          session.joinedAt = new Date().toISOString();
          void this.startMicUplink(params.serverId, params.channelId);
          return;
        }
        case "rtc.participant.joined": {
          const participantPayload = payload.participant as Record<string, unknown> | undefined;
          if (!participantPayload) return;
          const participant = toParticipant(participantPayload, false);
          if (!session.participants.some((item) => item.participantId === participant.participantId)) {
            session.participants.push(participant);
          }
          return;
        }
        case "rtc.participant.left": {
          const participantPayload = payload.participant as Record<string, unknown> | undefined;
          if (!participantPayload) return;
          const leavingParticipantID = String(participantPayload.participant_id ?? "");
          session.participants = session.participants.filter((item) => item.participantId !== leavingParticipantID);
          this.clearParticipantSpeaking(params.serverId, params.channelId, leavingParticipantID);
          return;
        }
        case "rtc.error": {
          session.state = "error";
          session.errorMessage = String(payload.message ?? "Signaling error");
          return;
        }
        case "rtc.media.state": {
          const streamKind = String(payload.stream_kind ?? "");
          const chunkB64 = String(payload.chunk_b64 ?? "");
          const participantID = String(payload.participant_id ?? "");
          if (streamKind !== "audio_pcm_s16le_48k_mono" || !chunkB64 || !participantID) {
            return;
          }
          const chunkBytes = decodeBase64Chunk(chunkB64);
          if (chunkBytes) {
            const activity = estimatePCM16Activity(chunkBytes);
            if (activity >= speakingActivityThreshold) {
              this.markParticipantSpeaking(params.serverId, params.channelId, participantID);
            }
          }
          if (session.localParticipantId && participantID === session.localParticipantId) {
            return;
          }
          if (session.deafened) return;
          const streamID = String(payload.stream_id ?? "default");
          const sampleRate = toNumber(payload.sample_rate_hz, 48000);
          const channels = toNumber(payload.channels, 1);
          schedulePCMPlayback({
            streamKey: `${params.serverId}:${params.channelId}:${participantID}:${streamID}`,
            chunkB64,
            sampleRate,
            channels
          });
          return;
        }
        case "rtc.kicked": {
          this.leaveChannel(params.serverId, params.channelId, {
            reason: "Removed from voice channel by moderation action."
          });
          return;
        }
        default:
          return;
      }
    },
    toggleMic(serverId: string): void {
      const audioPrefs = this.ensureAudioPrefs(serverId);
      const channelId = this.activeVoiceChannelByServer[serverId];
      if (!channelId) {
        if (audioPrefs.deafened) {
          audioPrefs.deafened = false;
          audioPrefs.micMuted = false;
          setPlaybackMuted(false);
          return;
        }
        audioPrefs.micMuted = !audioPrefs.micMuted;
        return;
      }
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (session.deafened) {
        session.deafened = false;
        session.micMuted = false;
        audioPrefs.deafened = false;
        audioPrefs.micMuted = false;
        setPlaybackMuted(false);
      } else {
        session.micMuted = !session.micMuted;
        audioPrefs.micMuted = session.micMuted;
      }
      if (!session.micMuted && session.state === "active") {
        void this.startMicUplink(serverId, channelId);
      }
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendSignal(socket, {
        type: "rtc.media.state",
        request_id: `media_${Date.now()}`,
        channel_id: channelId,
        payload: {
          mic_muted: session.micMuted,
          deafened: session.deafened
        }
      });
    },
    toggleDeafen(serverId: string): void {
      const audioPrefs = this.ensureAudioPrefs(serverId);
      const channelId = this.activeVoiceChannelByServer[serverId];
      if (!channelId) {
        audioPrefs.deafened = !audioPrefs.deafened;
        if (audioPrefs.deafened) {
          audioPrefs.micMuted = true;
        }
        return;
      }
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      session.deafened = !session.deafened;
      if (session.deafened) {
        session.micMuted = true;
      }
      audioPrefs.deafened = session.deafened;
      audioPrefs.micMuted = session.micMuted;
      setPlaybackMuted(session.deafened);
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendSignal(socket, {
        type: "rtc.media.state",
        request_id: `media_${Date.now()}`,
        channel_id: channelId,
        payload: {
          mic_muted: session.micMuted,
          deafened: session.deafened
        }
      });
    },
    leaveChannel(serverId: string, channelId: string, options?: { reason?: string }): void {
      const key = sessionKey(serverId, channelId);
      this.stopMicUplink(serverId, channelId);
      localJoinIdentityByKey.delete(key);
      this.clearSpeakingForSession(serverId, channelId);
      const socket = socketsByKey.get(key);
      if (socket) {
        intentionallyClosed.add(key);
        sendSignal(socket, {
          type: "rtc.leave",
          request_id: `leave_${Date.now()}`,
          channel_id: channelId,
          payload: {}
        });
        socket.close();
        socketsByKey.delete(key);
      }
      const session = this.sessionsByKey[key];
      if (session) {
        session.state = options?.reason ? "error" : "idle";
        session.participants = [];
        session.localParticipantId = null;
        session.activeSpeakerParticipantIds = [];
        session.errorMessage = options?.reason ?? null;
        session.lastEventAt = new Date().toISOString();
      }
      clearPlaybackState();
      if (this.activeVoiceChannelByServer[serverId] === channelId) {
        this.activeVoiceChannelByServer[serverId] = null;
      }
    },
    disconnectAll(): void {
      Object.entries(this.activeVoiceChannelByServer).forEach(([serverId, channelId]) => {
        if (channelId) {
          this.leaveChannel(serverId, channelId);
        }
      });
      speakingTimersByParticipant.forEach((timer) => {
        clearTimeout(timer);
      });
      speakingTimersByParticipant.clear();
      clearPlaybackState();
    }
  }
});
