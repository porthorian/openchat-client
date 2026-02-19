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

export type CallVideoStreamKind = "camera" | "screen";

export type CallVideoStream = {
  streamKey: string;
  participantId: string;
  userUID: string;
  deviceID: string;
  kind: CallVideoStreamKind;
  mediaStream: MediaStream;
  trackId: string;
  startedAt: string;
  isLocal: boolean;
};

export type ChannelCallSession = {
  state: CallConnectionState;
  participants: CallParticipant[];
  localParticipantId: string | null;
  activeSpeakerParticipantIds: string[];
  videoStreams: CallVideoStream[];
  micMuted: boolean;
  deafened: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  canSendVideo: boolean;
  canShareScreen: boolean;
  cameraErrorMessage: string | null;
  screenShareErrorMessage: string | null;
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
const RTC_VIDEO_CAMERA_KIND = "video_camera";
const RTC_VIDEO_SCREEN_KIND = "video_screen";
const socketsByKey = new Map<string, WebSocket>();
const intentionallyClosed = new Set<string>();
const nextPlaybackTimeByStream = new Map<string, number>();
const micUplinksByKey = new Map<string, MicUplink>();
const peerConnectionsByKey = new Map<string, Map<string, PeerConnectionEntry>>();
const iceServersByKey = new Map<string, RTCIceServer[]>();
const videoHintByKey = new Map<string, Map<string, CallVideoStreamKind>>();
const localCameraStreamsByKey = new Map<string, MediaStream>();
const localScreenStreamsByKey = new Map<string, MediaStream>();
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
const rtcLogPrefix = "[openchat:rtc]";
const rtcDebugEnabled = (() => {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem("openchat:rtc-debug") === "1";
  } catch (_error) {
    return false;
  }
})();

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

type PeerConnectionEntry = {
  connection: RTCPeerConnection;
  participantId: string;
  channelId: string;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingNegotiation: boolean;
  pendingNegotiationReason: string | null;
};

type ElectronDesktopVideoConstraints = MediaTrackConstraints & {
  mandatory?: {
    chromeMediaSource: "desktop";
    chromeMediaSourceId: string;
    maxFrameRate?: number;
  };
};

function rtcLog(event: string, payload: Record<string, unknown>): void {
  if (!rtcDebugEnabled || typeof console === "undefined") return;
  console.debug(rtcLogPrefix, event, payload);
}

function sessionKey(serverId: string, channelId: string): string {
  return `${serverId}:${channelId}`;
}

function createEmptySession(): ChannelCallSession {
  return {
    state: "idle",
    participants: [],
    localParticipantId: null,
    activeSpeakerParticipantIds: [],
    videoStreams: [],
    micMuted: false,
    deafened: false,
    cameraEnabled: false,
    screenShareEnabled: false,
    canSendVideo: true,
    canShareScreen: true,
    cameraErrorMessage: null,
    screenShareErrorMessage: null,
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

function toDescriptionType(value: unknown): RTCSdpType | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "offer" || normalized === "answer" || normalized === "pranswer" || normalized === "rollback") {
    return normalized;
  }
  return null;
}

function toVideoKindFromSignal(streamKind: string): CallVideoStreamKind | null {
  if (streamKind === RTC_VIDEO_CAMERA_KIND) return "camera";
  if (streamKind === RTC_VIDEO_SCREEN_KIND) return "screen";
  return null;
}

function toSignalStreamKind(kind: CallVideoStreamKind): string {
  return kind === "screen" ? RTC_VIDEO_SCREEN_KIND : RTC_VIDEO_CAMERA_KIND;
}

function videoHintKey(participantId: string, trackId: string): string {
  return `${participantId}:${trackId}`;
}

function inferVideoKindFromTrackLabel(label: string): CallVideoStreamKind {
  const normalized = label.trim().toLowerCase();
  if (
    normalized.includes("screen") ||
    normalized.includes("display") ||
    normalized.includes("window") ||
    normalized.includes("monitor")
  ) {
    return "screen";
  }
  return "camera";
}

function toRTCIceServers(iceServers: Array<{ urls: string[]; username?: string; credential?: string }>): RTCIceServer[] {
  return iceServers
    .filter((server) => Array.isArray(server.urls) && server.urls.length > 0)
    .map((server) => ({
      urls: server.urls,
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {})
    }));
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
    videoStreamsFor:
      (state) =>
      (serverId: string, channelId: string): CallVideoStream[] => {
        return state.sessionsByKey[sessionKey(serverId, channelId)]?.videoStreams ?? [];
      },
    activeChannelFor: (state) => (serverId: string): string | null => {
      return state.activeVoiceChannelByServer[serverId] ?? null;
    },
    micMutedForServer: (state) => (serverId: string): boolean => {
      return state.audioPrefsByServer[serverId]?.micMuted ?? false;
    },
    deafenedForServer: (state) => (serverId: string): boolean => {
      return state.audioPrefsByServer[serverId]?.deafened ?? false;
    },
    cameraEnabledFor: (state) => (serverId: string, channelId: string): boolean => {
      return state.sessionsByKey[sessionKey(serverId, channelId)]?.cameraEnabled ?? false;
    },
    screenShareEnabledFor: (state) => (serverId: string, channelId: string): boolean => {
      return state.sessionsByKey[sessionKey(serverId, channelId)]?.screenShareEnabled ?? false;
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
    peerConnectionsForSession(key: string): Map<string, PeerConnectionEntry> {
      const existing = peerConnectionsByKey.get(key);
      if (existing) return existing;
      const created = new Map<string, PeerConnectionEntry>();
      peerConnectionsByKey.set(key, created);
      return created;
    },
    videoHintsForSession(key: string): Map<string, CallVideoStreamKind> {
      const existing = videoHintByKey.get(key);
      if (existing) return existing;
      const created = new Map<string, CallVideoStreamKind>();
      videoHintByKey.set(key, created);
      return created;
    },
    updateVideoHint(serverId: string, channelId: string, participantId: string, trackId: string, kind: CallVideoStreamKind): void {
      if (!participantId || !trackId) return;
      const key = sessionKey(serverId, channelId);
      this.videoHintsForSession(key).set(videoHintKey(participantId, trackId), kind);
    },
    deleteVideoHint(serverId: string, channelId: string, participantId: string, trackId: string): void {
      if (!participantId || !trackId) return;
      const key = sessionKey(serverId, channelId);
      const hintMap = videoHintByKey.get(key);
      if (!hintMap) return;
      hintMap.delete(videoHintKey(participantId, trackId));
      if (hintMap.size === 0) {
        videoHintByKey.delete(key);
      }
    },
    deleteVideoHintsForParticipant(serverId: string, channelId: string, participantId: string): void {
      if (!participantId) return;
      const key = sessionKey(serverId, channelId);
      const hintMap = videoHintByKey.get(key);
      if (!hintMap) return;
      const prefix = `${participantId}:`;
      for (const hintKey of hintMap.keys()) {
        if (hintKey.startsWith(prefix)) {
          hintMap.delete(hintKey);
        }
      }
      if (hintMap.size === 0) {
        videoHintByKey.delete(key);
      }
    },
    upsertVideoStream(params: {
      serverId: string;
      channelId: string;
      participantId: string;
      userUID: string;
      deviceID: string;
      kind: CallVideoStreamKind;
      mediaStream: MediaStream;
      trackId: string;
      isLocal: boolean;
    }): void {
      const key = this.ensureSession(params.serverId, params.channelId);
      const session = this.sessionsByKey[key];
      const streamKey = `${params.participantId}:${params.trackId}`;
      const index = session.videoStreams.findIndex((entry) => entry.streamKey === streamKey);
      const sameKindIndex = session.videoStreams.findIndex(
        (entry) => entry.participantId === params.participantId && entry.kind === params.kind
      );
      const next: CallVideoStream = {
        streamKey,
        participantId: params.participantId,
        userUID: params.userUID,
        deviceID: params.deviceID,
        kind: params.kind,
        mediaStream: params.mediaStream,
        trackId: params.trackId,
        startedAt: new Date().toISOString(),
        isLocal: params.isLocal
      };
      if (index >= 0) {
        session.videoStreams.splice(index, 1, next);
        return;
      }
      if (sameKindIndex >= 0) {
        session.videoStreams.splice(sameKindIndex, 1, next);
        return;
      }
      session.videoStreams.push(next);
    },
    removeVideoStream(serverId: string, channelId: string, streamKeyToRemove: string): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      session.videoStreams = session.videoStreams.filter((entry) => entry.streamKey !== streamKeyToRemove);
    },
    removeVideoStreamsForParticipant(
      serverId: string,
      channelId: string,
      participantId: string,
      kind?: CallVideoStreamKind
    ): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      session.videoStreams = session.videoStreams.filter((entry) => {
        if (entry.participantId !== participantId) return true;
        if (!kind) return false;
        return entry.kind !== kind;
      });
    },
    sendVideoStateSignal(params: {
      serverId: string;
      channelId: string;
      kind: CallVideoStreamKind;
      action: "start" | "stop";
      trackId: string;
      streamId: string;
    }): void {
      const key = sessionKey(params.serverId, params.channelId);
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendSignal(socket, {
        type: "rtc.media.state",
        request_id: `video_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        channel_id: params.channelId,
        payload: {
          stream_id: params.streamId,
          track_id: params.trackId,
          stream_kind: toSignalStreamKind(params.kind),
          action: params.action
        }
      });
    },
    stopLocalVideoKind(serverId: string, channelId: string, kind: CallVideoStreamKind, options?: { notify?: boolean }): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;

      const streamMap = kind === "screen" ? localScreenStreamsByKey : localCameraStreamsByKey;
      const stream = streamMap.get(key);
      if (!stream) {
        if (kind === "screen") {
          session.screenShareEnabled = false;
          session.screenShareErrorMessage = null;
        } else {
          session.cameraEnabled = false;
          session.cameraErrorMessage = null;
        }
        return;
      }

      const track = stream.getVideoTracks()[0];
      if (track && options?.notify !== false) {
        this.sendVideoStateSignal({
          serverId,
          channelId,
          kind,
          action: "stop",
          trackId: track.id,
          streamId: stream.id
        });
      }

      stream.getTracks().forEach((item) => {
        item.onended = null;
        item.stop();
      });
      streamMap.delete(key);

      const localParticipantID = session.localParticipantId ?? "";
      if (localParticipantID) {
        this.removeVideoStreamsForParticipant(serverId, channelId, localParticipantID, kind);
      } else {
        session.videoStreams = session.videoStreams.filter((entry) => !(entry.isLocal && entry.kind === kind));
      }

      if (kind === "screen") {
        session.screenShareEnabled = false;
        session.screenShareErrorMessage = null;
      } else {
        session.cameraEnabled = false;
        session.cameraErrorMessage = null;
      }
    },
    stopAllLocalVideo(serverId: string, channelId: string, options?: { notify?: boolean }): void {
      this.stopLocalVideoKind(serverId, channelId, "camera", options);
      this.stopLocalVideoKind(serverId, channelId, "screen", options);
    },
    async syncPeerVideoTracks(serverId: string, channelId: string, participantId: string): Promise<void> {
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      const peer = peers?.get(participantId);
      if (!peer) return;
      const session = this.sessionsByKey[key];
      if (!session || peer.connection.signalingState === "closed") return;

      const desiredVideoTracks: Array<{ kind: CallVideoStreamKind; track: MediaStreamTrack; stream: MediaStream }> = [];
      const cameraStream = localCameraStreamsByKey.get(key);
      const cameraTrack = cameraStream?.getVideoTracks()[0];
      if (cameraTrack && session.cameraEnabled) {
        desiredVideoTracks.push({
          kind: "camera",
          track: cameraTrack,
          stream: cameraStream
        });
      }

      const screenStream = localScreenStreamsByKey.get(key);
      const screenTrack = screenStream?.getVideoTracks()[0];
      if (screenTrack && session.screenShareEnabled) {
        desiredVideoTracks.push({
          kind: "screen",
          track: screenTrack,
          stream: screenStream
        });
      }

      const pendingTrackIDs = new Set(desiredVideoTracks.map((entry) => entry.track.id));
      peer.connection
        .getSenders()
        .filter((sender) => sender.track?.kind === "video")
        .forEach((sender) => {
          const senderTrack = sender.track;
          if (!senderTrack) return;
          if (pendingTrackIDs.has(senderTrack.id)) {
            pendingTrackIDs.delete(senderTrack.id);
            return;
          }
          try {
            peer.connection.removeTrack(sender);
            rtcLog("video.sender.remove", {
              serverId,
              channelId,
              participantId,
              signalingState: peer.connection.signalingState,
              trackId: senderTrack.id
            });
          } catch (_error) {
            // No-op
          }
        });

      desiredVideoTracks.forEach((entry) => {
        if (!pendingTrackIDs.has(entry.track.id)) return;
        peer.connection.addTrack(entry.track, entry.stream);
        rtcLog("video.sender.add", {
          serverId,
          channelId,
          participantId,
          signalingState: peer.connection.signalingState,
          kind: entry.kind,
          trackId: entry.track.id
        });
      });
    },
    async syncAllPeerVideoTracks(serverId: string, channelId: string): Promise<void> {
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      if (!peers || peers.size === 0) return;
      await Promise.all(
        Array.from(peers.values()).map(async (peer) => {
          await this.syncPeerVideoTracks(serverId, channelId, peer.participantId);
        })
      );
    },
    async createAndSendOffer(
      serverId: string,
      channelId: string,
      participantId: string,
      reason = "unspecified"
    ): Promise<void> {
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      const peer = peers?.get(participantId);
      if (!peer) return;
      const session = this.sessionsByKey[key];
      if (!session || session.state !== "active") return;
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (peer.connection.signalingState === "closed") return;
      if (peer.makingOffer || peer.connection.signalingState !== "stable" || peer.isSettingRemoteAnswerPending) {
        peer.pendingNegotiation = true;
        peer.pendingNegotiationReason = reason;
        rtcLog("offer.defer", {
          serverId,
          channelId,
          participantId,
          reason,
          signalingState: peer.connection.signalingState,
          makingOffer: peer.makingOffer,
          isSettingRemoteAnswerPending: peer.isSettingRemoteAnswerPending
        });
        return;
      }

      try {
        peer.pendingNegotiation = false;
        peer.pendingNegotiationReason = null;
        peer.makingOffer = true;
        rtcLog("offer.start", {
          serverId,
          channelId,
          participantId,
          reason,
          signalingState: peer.connection.signalingState
        });
        await peer.connection.setLocalDescription();
        const localDescription = peer.connection.localDescription;
        if (!localDescription || localDescription.type !== "offer") {
          rtcLog("offer.skip", {
            serverId,
            channelId,
            participantId,
            reason,
            signalingState: peer.connection.signalingState,
            localDescriptionType: localDescription?.type ?? null
          });
          return;
        }
        sendSignal(socket, {
          type: "rtc.offer.publish",
          request_id: `offer_${Date.now()}_${participantId}`,
          channel_id: channelId,
          payload: {
            target_participant_id: participantId,
            description_type: localDescription.type,
            sdp: localDescription.sdp
          }
        });
        rtcLog("offer.sent", {
          serverId,
          channelId,
          participantId,
          reason,
          signalingState: peer.connection.signalingState
        });
      } catch (error) {
        session.errorMessage = `Offer negotiation failed: ${(error as Error).message}`;
        rtcLog("offer.error", {
          serverId,
          channelId,
          participantId,
          reason,
          signalingState: peer.connection.signalingState,
          message: (error as Error).message
        });
      } finally {
        peer.makingOffer = false;
        const shouldFlushPending =
          peer.pendingNegotiation &&
          !peer.makingOffer &&
          !peer.isSettingRemoteAnswerPending &&
          peer.connection.signalingState === "stable";
        if (shouldFlushPending) {
          const pendingReason = peer.pendingNegotiationReason ?? "pending";
          peer.pendingNegotiation = false;
          peer.pendingNegotiationReason = null;
          void Promise.resolve().then(() =>
            this.createAndSendOffer(serverId, channelId, participantId, `flush:${pendingReason}`)
          );
        }
      }
    },
    ensurePeerConnection(serverId: string, channelId: string, participantId: string): PeerConnectionEntry | null {
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session || !participantId || session.localParticipantId === participantId) return null;

      const peers = this.peerConnectionsForSession(key);
      const existing = peers.get(participantId);
      if (existing) return existing;

      const localParticipantID = session.localParticipantId ?? "";
      const polite = localParticipantID ? localParticipantID.localeCompare(participantId) > 0 : true;
      const connection = new RTCPeerConnection({
        iceServers: iceServersByKey.get(key) ?? []
      });
      const entry: PeerConnectionEntry = {
        connection,
        participantId,
        channelId,
        polite,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingNegotiation: false,
        pendingNegotiationReason: null
      };
      peers.set(participantId, entry);
      rtcLog("peer.create", {
        serverId,
        channelId,
        participantId,
        polite
      });

      connection.onicecandidate = (event) => {
        if (!event.candidate) return;
        const socket = socketsByKey.get(key);
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        sendSignal(socket, {
          type: "rtc.ice.candidate",
          request_id: `ice_${Date.now()}_${participantId}`,
          channel_id: channelId,
          payload: {
            target_participant_id: participantId,
            candidate: event.candidate.toJSON()
          }
        });
      };

      connection.onnegotiationneeded = () => {
        rtcLog("negotiation.needed", {
          serverId,
          channelId,
          participantId,
          signalingState: connection.signalingState
        });
        void this.createAndSendOffer(serverId, channelId, participantId, "onnegotiationneeded");
      };

      connection.ontrack = (event) => {
        if (event.track.kind !== "video") return;
        const mediaStream = event.streams[0] ?? new MediaStream([event.track]);
        rtcLog("track.received", {
          serverId,
          channelId,
          participantId,
          streamId: mediaStream.id,
          trackId: event.track.id,
          trackLabel: event.track.label,
          muted: event.track.muted,
          readyState: event.track.readyState,
          mid: event.transceiver?.mid ?? null
        });
        this.handleRemoteVideoTrack({
          serverId,
          channelId,
          participantId,
          mediaStream,
          track: event.track
        });
      };

      connection.onsignalingstatechange = () => {
        rtcLog("signaling.state", {
          serverId,
          channelId,
          participantId,
          signalingState: connection.signalingState,
          pendingNegotiation: entry.pendingNegotiation
        });
        if (connection.signalingState !== "stable" || !entry.pendingNegotiation) return;
        const pendingReason = entry.pendingNegotiationReason ?? "signaling-stable";
        entry.pendingNegotiation = false;
        entry.pendingNegotiationReason = null;
        void this.createAndSendOffer(serverId, channelId, participantId, `stable:${pendingReason}`);
      };

      connection.oniceconnectionstatechange = () => {
        rtcLog("ice.state", {
          serverId,
          channelId,
          participantId,
          iceConnectionState: connection.iceConnectionState
        });
      };

      connection.onicecandidateerror = (event: Event) => {
        const iceEvent = event as Event & {
          errorCode?: number;
          errorText?: string;
          address?: string;
          port?: number;
          url?: string;
        };
        rtcLog("ice.candidate.error", {
          serverId,
          channelId,
          participantId,
          errorCode: iceEvent.errorCode ?? null,
          errorText: iceEvent.errorText ?? null,
          address: iceEvent.address ?? null,
          port: iceEvent.port ?? null,
          url: iceEvent.url ?? null
        });
      };

      connection.onconnectionstatechange = () => {
        rtcLog("connection.state", {
          serverId,
          channelId,
          participantId,
          connectionState: connection.connectionState
        });
        if (connection.connectionState !== "failed" && connection.connectionState !== "closed") return;
        this.removeVideoStreamsForParticipant(serverId, channelId, participantId);
      };

      void this.syncPeerVideoTracks(serverId, channelId, participantId);
      return entry;
    },
    closePeerConnection(serverId: string, channelId: string, participantId: string): void {
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      const peer = peers?.get(participantId);
      if (!peer) return;
      peer.connection.onicecandidate = null;
      peer.connection.onnegotiationneeded = null;
      peer.connection.ontrack = null;
      peer.connection.onsignalingstatechange = null;
      peer.connection.oniceconnectionstatechange = null;
      peer.connection.onicecandidateerror = null;
      peer.connection.onconnectionstatechange = null;
      if (peer.connection.signalingState !== "closed") {
        peer.connection.close();
      }
      peers?.delete(participantId);
      if (peers && peers.size === 0) {
        peerConnectionsByKey.delete(key);
      }
      this.deleteVideoHintsForParticipant(serverId, channelId, participantId);
    },
    closePeerConnectionsForSession(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      if (peers) {
        for (const participantId of peers.keys()) {
          this.closePeerConnection(serverId, channelId, participantId);
        }
      }
      peerConnectionsByKey.delete(key);
      iceServersByKey.delete(key);
      videoHintByKey.delete(key);
    },
    connectParticipantMesh(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session || !session.localParticipantId) return;
      const activeParticipantIDs = new Set(
        session.participants.filter((participant) => participant.participantId !== session.localParticipantId).map((participant) => participant.participantId)
      );

      const peers = this.peerConnectionsForSession(key);
      for (const participantId of peers.keys()) {
        if (activeParticipantIDs.has(participantId)) continue;
        this.closePeerConnection(serverId, channelId, participantId);
      }

      session.participants.forEach((participant) => {
        if (participant.participantId === session.localParticipantId) return;
        if (!participant.participantId) return;
        this.ensurePeerConnection(serverId, channelId, participant.participantId);
      });
    },
    handleRemoteVideoTrack(params: {
      serverId: string;
      channelId: string;
      participantId: string;
      mediaStream: MediaStream;
      track: MediaStreamTrack;
    }): void {
      const key = this.ensureSession(params.serverId, params.channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const participant = session.participants.find((item) => item.participantId === params.participantId);
      const hintMap = this.videoHintsForSession(key);
      const hint = hintMap.get(videoHintKey(params.participantId, params.track.id));
      const kind = hint ?? inferVideoKindFromTrackLabel(params.track.label);
      rtcLog("video.track.apply", {
        serverId: params.serverId,
        channelId: params.channelId,
        participantId: params.participantId,
        streamId: params.mediaStream.id,
        trackId: params.track.id,
        inferredKind: kind,
        hintKind: hint ?? null,
        hintSource: hint ? "signal" : "track_label",
        trackLabel: params.track.label,
        muted: params.track.muted,
        readyState: params.track.readyState
      });

      this.upsertVideoStream({
        serverId: params.serverId,
        channelId: params.channelId,
        participantId: params.participantId,
        userUID: participant?.userUID ?? "uid_unknown",
        deviceID: participant?.deviceID ?? "device_unknown",
        kind,
        mediaStream: params.mediaStream,
        trackId: params.track.id,
        isLocal: session.localParticipantId === params.participantId
      });

      params.track.onended = () => {
        rtcLog("video.track.ended", {
          serverId: params.serverId,
          channelId: params.channelId,
          participantId: params.participantId,
          trackId: params.track.id,
          kind
        });
        this.removeVideoStream(params.serverId, params.channelId, `${params.participantId}:${params.track.id}`);
        this.deleteVideoHint(params.serverId, params.channelId, params.participantId, params.track.id);
      };
    },
    async handleOfferSignal(serverId: string, channelId: string, payload: Record<string, unknown>): Promise<void> {
      const fromParticipantID = String(payload.from_participant_id ?? "").trim();
      const sdp = String(payload.sdp ?? "");
      const descriptionType = toDescriptionType(payload.description_type ?? "offer");
      if (!fromParticipantID || !sdp || descriptionType !== "offer") return;
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;

      const peer = this.ensurePeerConnection(serverId, channelId, fromParticipantID);
      if (!peer) return;
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const offerDescription: RTCSessionDescriptionInit = { type: "offer", sdp };
      const offerCollision = peer.makingOffer || peer.connection.signalingState !== "stable";
      peer.ignoreOffer = !peer.polite && offerCollision;
      rtcLog("offer.received", {
        serverId,
        channelId,
        participantId: fromParticipantID,
        signalingState: peer.connection.signalingState,
        makingOffer: peer.makingOffer,
        polite: peer.polite,
        isSettingRemoteAnswerPending: peer.isSettingRemoteAnswerPending,
        offerCollision,
        ignoreOffer: peer.ignoreOffer
      });
      if (peer.ignoreOffer) {
        rtcLog("offer.ignored", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          reason: "impolite_offer_collision",
          signalingState: peer.connection.signalingState
        });
        return;
      }

      try {
        if (offerCollision) {
          rtcLog("offer.rollback", {
            serverId,
            channelId,
            participantId: fromParticipantID,
            signalingState: peer.connection.signalingState
          });
          if (peer.connection.signalingState !== "stable") {
            await Promise.all([
              peer.connection.setLocalDescription({ type: "rollback" }),
              peer.connection.setRemoteDescription(offerDescription)
            ]);
          } else {
            await peer.connection.setRemoteDescription(offerDescription);
          }
        } else {
          await peer.connection.setRemoteDescription(offerDescription);
        }
        rtcLog("offer.applied", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          signalingState: peer.connection.signalingState
        });
        await this.syncPeerVideoTracks(serverId, channelId, fromParticipantID);
        await peer.connection.setLocalDescription();
        const localDescription = peer.connection.localDescription;
        if (!localDescription || localDescription.type !== "answer") return;

        sendSignal(socket, {
          type: "rtc.answer.publish",
          request_id: `answer_${Date.now()}_${fromParticipantID}`,
          channel_id: channelId,
          payload: {
            target_participant_id: fromParticipantID,
            description_type: localDescription.type,
            sdp: localDescription.sdp
          }
        });
        peer.ignoreOffer = false;
        rtcLog("answer.sent", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          signalingState: peer.connection.signalingState
        });
      } catch (error) {
        session.errorMessage = `Offer handling failed: ${(error as Error).message}`;
        rtcLog("offer.error", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          signalingState: peer.connection.signalingState,
          message: (error as Error).message
        });
      }
    },
    async handleAnswerSignal(serverId: string, channelId: string, payload: Record<string, unknown>): Promise<void> {
      const fromParticipantID = String(payload.from_participant_id ?? "").trim();
      const sdp = String(payload.sdp ?? "");
      const descriptionType = toDescriptionType(payload.description_type ?? "answer");
      if (!fromParticipantID || !sdp || descriptionType !== "answer") return;
      const key = sessionKey(serverId, channelId);
      const peer = peerConnectionsByKey.get(key)?.get(fromParticipantID);
      if (!peer) return;
      const session = this.sessionsByKey[key];
      if (!session) return;
      rtcLog("answer.received", {
        serverId,
        channelId,
        participantId: fromParticipantID,
        signalingState: peer.connection.signalingState,
        ignoreOffer: peer.ignoreOffer
      });
      peer.isSettingRemoteAnswerPending = true;
      try {
        await peer.connection.setRemoteDescription({
          type: "answer",
          sdp
        });
        peer.ignoreOffer = false;
        rtcLog("answer.applied", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          signalingState: peer.connection.signalingState
        });
      } catch (error) {
        session.errorMessage = `Answer handling failed: ${(error as Error).message}`;
        rtcLog("answer.error", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          signalingState: peer.connection.signalingState,
          message: (error as Error).message
        });
      } finally {
        peer.isSettingRemoteAnswerPending = false;
        const shouldFlushPending = peer.pendingNegotiation && !peer.makingOffer && peer.connection.signalingState === "stable";
        if (shouldFlushPending) {
          const pendingReason = peer.pendingNegotiationReason ?? "post-answer";
          peer.pendingNegotiation = false;
          peer.pendingNegotiationReason = null;
          void this.createAndSendOffer(serverId, channelId, fromParticipantID, `answer:${pendingReason}`);
        }
      }
    },
    async handleIceCandidateSignal(serverId: string, channelId: string, payload: Record<string, unknown>): Promise<void> {
      const fromParticipantID = String(payload.from_participant_id ?? "").trim();
      if (!fromParticipantID) return;
      const key = sessionKey(serverId, channelId);
      const peer = this.ensurePeerConnection(serverId, channelId, fromParticipantID);
      if (!peer) return;
      if (peer.ignoreOffer) {
        rtcLog("ice.remote.ignore", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          signalingState: peer.connection.signalingState
        });
        return;
      }

      const candidatePayload = payload.candidate;
      if (!candidatePayload || typeof candidatePayload !== "object") {
        return;
      }

      try {
        const candidate = candidatePayload as RTCIceCandidateInit;
        await peer.connection.addIceCandidate(candidate);
        rtcLog("ice.remote.add", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          signalingState: peer.connection.signalingState,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null
        });
      } catch (error) {
        rtcLog("ice.remote.error", {
          serverId,
          channelId,
          participantId: fromParticipantID,
          signalingState: peer.connection.signalingState,
          message: (error as Error).message
        });
        // Ignore transient candidate races while SDP syncs.
      }
    },
    async enableCamera(serverId: string): Promise<void> {
      const channelId = this.activeVoiceChannelByServer[serverId];
      if (!channelId) return;
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session.localParticipantId) {
        session.cameraErrorMessage = "Camera can be enabled after the call is connected.";
        return;
      }
      if (!session.canSendVideo) {
        session.cameraErrorMessage = "This server does not allow camera video for this channel.";
        return;
      }
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        session.cameraErrorMessage = "Camera capture is not supported in this runtime.";
        return;
      }

      try {
        this.stopLocalVideoKind(serverId, channelId, "camera", { notify: false });
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 }
          }
        });
        const track = mediaStream.getVideoTracks()[0];
        if (!track) {
          throw new Error("No camera track available.");
        }

        const localParticipant = session.participants.find((item) => item.participantId === session.localParticipantId);
        localCameraStreamsByKey.set(key, mediaStream);
        session.cameraEnabled = true;
        session.cameraErrorMessage = null;
        this.upsertVideoStream({
          serverId,
          channelId,
          participantId: session.localParticipantId,
          userUID: localParticipant?.userUID ?? "uid_unknown",
          deviceID: localParticipant?.deviceID ?? "device_unknown",
          kind: "camera",
          mediaStream,
          trackId: track.id,
          isLocal: true
        });
        this.sendVideoStateSignal({
          serverId,
          channelId,
          kind: "camera",
          action: "start",
          trackId: track.id,
          streamId: mediaStream.id
        });
        track.onended = () => {
          this.stopLocalVideoKind(serverId, channelId, "camera");
          void this.syncAllPeerVideoTracks(serverId, channelId);
        };
        await this.syncAllPeerVideoTracks(serverId, channelId);
      } catch (error) {
        session.cameraEnabled = false;
        session.cameraErrorMessage = `Camera unavailable: ${(error as Error).message}`;
      }
    },
    async enableScreenShare(serverId: string, options?: { sourceId?: string }): Promise<void> {
      const channelId = this.activeVoiceChannelByServer[serverId];
      if (!channelId) return;
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session.localParticipantId) {
        session.screenShareErrorMessage = "Screen share can be enabled after the call is connected.";
        return;
      }
      if (!session.canShareScreen) {
        session.screenShareErrorMessage = "This server does not allow screen sharing for this channel.";
        return;
      }
      if (
        typeof navigator === "undefined" ||
        (!navigator.mediaDevices?.getDisplayMedia && !navigator.mediaDevices?.getUserMedia)
      ) {
        session.screenShareErrorMessage = "Screen sharing is not supported in this runtime.";
        return;
      }

      try {
        this.stopLocalVideoKind(serverId, channelId, "screen", { notify: false });
        let mediaStream: MediaStream;
        const sourceId = options?.sourceId?.trim();
        if (sourceId) {
          const desktopConstraints: MediaStreamConstraints = {
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                maxFrameRate: 30
              }
            } as ElectronDesktopVideoConstraints
          };
          mediaStream = await navigator.mediaDevices.getUserMedia(desktopConstraints);
        } else {
          mediaStream = await navigator.mediaDevices.getDisplayMedia({
            audio: false,
            video: {
              frameRate: { ideal: 20, max: 30 }
            }
          });
        }
        const track = mediaStream.getVideoTracks()[0];
        if (!track) {
          throw new Error("No screen-share track available.");
        }

        const localParticipant = session.participants.find((item) => item.participantId === session.localParticipantId);
        localScreenStreamsByKey.set(key, mediaStream);
        session.screenShareEnabled = true;
        session.screenShareErrorMessage = null;
        this.upsertVideoStream({
          serverId,
          channelId,
          participantId: session.localParticipantId,
          userUID: localParticipant?.userUID ?? "uid_unknown",
          deviceID: localParticipant?.deviceID ?? "device_unknown",
          kind: "screen",
          mediaStream,
          trackId: track.id,
          isLocal: true
        });
        this.sendVideoStateSignal({
          serverId,
          channelId,
          kind: "screen",
          action: "start",
          trackId: track.id,
          streamId: mediaStream.id
        });
        track.onended = () => {
          this.stopLocalVideoKind(serverId, channelId, "screen");
          void this.syncAllPeerVideoTracks(serverId, channelId);
        };
        await this.syncAllPeerVideoTracks(serverId, channelId);
      } catch (error) {
        session.screenShareEnabled = false;
        session.screenShareErrorMessage = `Screen share unavailable: ${(error as Error).message}`;
      }
    },
    async toggleCamera(serverId: string): Promise<void> {
      const channelId = this.activeVoiceChannelByServer[serverId];
      if (!channelId) return;
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      if (session.cameraEnabled) {
        this.stopLocalVideoKind(serverId, channelId, "camera");
        await this.syncAllPeerVideoTracks(serverId, channelId);
        return;
      }
      await this.enableCamera(serverId);
    },
    async toggleScreenShare(serverId: string, options?: { sourceId?: string }): Promise<void> {
      const channelId = this.activeVoiceChannelByServer[serverId];
      if (!channelId) return;
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      if (session.screenShareEnabled) {
        this.stopLocalVideoKind(serverId, channelId, "screen");
        await this.syncAllPeerVideoTracks(serverId, channelId);
        return;
      }
      await this.enableScreenShare(serverId, options);
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
      this.stopAllLocalVideo(params.serverId, params.channelId, { notify: false });
      this.closePeerConnectionsForSession(params.serverId, params.channelId);
      this.stopMicUplink(params.serverId, params.channelId);
      session.state = "joining";
      session.errorMessage = null;
      session.participants = [];
      session.localParticipantId = null;
      session.videoStreams = [];
      session.cameraEnabled = false;
      session.screenShareEnabled = false;
      session.cameraErrorMessage = null;
      session.screenShareErrorMessage = null;
      session.canSendVideo = true;
      session.canShareScreen = true;
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
        iceServersByKey.set(key, toRTCIceServers(joinTicket.ice_servers));
        session.canSendVideo = Boolean(joinTicket.permissions.video);
        session.canShareScreen = Boolean(joinTicket.permissions.screenshare);

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
          this.stopAllLocalVideo(params.serverId, params.channelId, { notify: false });
          this.closePeerConnectionsForSession(params.serverId, params.channelId);
          const localSession = this.sessionsByKey[key];
          localJoinIdentityByKey.delete(key);
          if (!localSession) return;
          localSession.lastEventAt = new Date().toISOString();
          if (intentionallyClosed.has(key)) {
            intentionallyClosed.delete(key);
            localSession.state = "idle";
            localSession.participants = [];
            localSession.localParticipantId = null;
            localSession.videoStreams = [];
            localSession.cameraEnabled = false;
            localSession.screenShareEnabled = false;
            this.clearSpeakingForSession(params.serverId, params.channelId);
            localSession.errorMessage = null;
            return;
          }
          localSession.state = "error";
          localSession.errorMessage = "Call signaling disconnected.";
          localSession.participants = [];
          localSession.localParticipantId = null;
          localSession.videoStreams = [];
          localSession.cameraEnabled = false;
          localSession.screenShareEnabled = false;
          this.clearSpeakingForSession(params.serverId, params.channelId);
          this.activeVoiceChannelByServer[params.serverId] = null;
        });

        socket.addEventListener("error", () => {
          this.stopMicUplink(params.serverId, params.channelId);
          this.stopAllLocalVideo(params.serverId, params.channelId, { notify: false });
          this.closePeerConnectionsForSession(params.serverId, params.channelId);
          const localSession = this.sessionsByKey[key];
          localJoinIdentityByKey.delete(key);
          if (!localSession) return;
          localSession.state = "error";
          localSession.errorMessage = "Call signaling transport failed.";
          localSession.videoStreams = [];
          localSession.cameraEnabled = false;
          localSession.screenShareEnabled = false;
          this.clearSpeakingForSession(params.serverId, params.channelId);
          localSession.lastEventAt = new Date().toISOString();
        });
      } catch (error) {
        session.state = "error";
        session.errorMessage = (error as Error).message;
        session.videoStreams = [];
        session.cameraEnabled = false;
        session.screenShareEnabled = false;
        this.stopAllLocalVideo(params.serverId, params.channelId, { notify: false });
        this.closePeerConnectionsForSession(params.serverId, params.channelId);
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
          session.videoStreams = session.videoStreams.filter((entry) => entry.isLocal);
          setPlaybackMuted(session.deafened);
          session.joinedAt = new Date().toISOString();
          this.connectParticipantMesh(params.serverId, params.channelId);
          void this.syncAllPeerVideoTracks(params.serverId, params.channelId);
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
          this.connectParticipantMesh(params.serverId, params.channelId);
          return;
        }
        case "rtc.participant.left": {
          const participantPayload = payload.participant as Record<string, unknown> | undefined;
          if (!participantPayload) return;
          const leavingParticipantID = String(participantPayload.participant_id ?? "");
          session.participants = session.participants.filter((item) => item.participantId !== leavingParticipantID);
          this.closePeerConnection(params.serverId, params.channelId, leavingParticipantID);
          this.removeVideoStreamsForParticipant(params.serverId, params.channelId, leavingParticipantID);
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
          const participantID = String(payload.participant_id ?? "");
          if (!participantID) return;

          const streamKindVideo = toVideoKindFromSignal(streamKind);
          if (streamKindVideo) {
            if (session.localParticipantId && participantID === session.localParticipantId) {
              return;
            }

            const action = String(payload.action ?? "start").trim().toLowerCase();
            const trackID = String(payload.track_id ?? "");
            if (action === "stop") {
              if (trackID) {
                this.removeVideoStream(params.serverId, params.channelId, `${participantID}:${trackID}`);
                this.deleteVideoHint(params.serverId, params.channelId, participantID, trackID);
              } else {
                this.removeVideoStreamsForParticipant(params.serverId, params.channelId, participantID, streamKindVideo);
              }
              return;
            }

            if (trackID) {
              this.updateVideoHint(params.serverId, params.channelId, participantID, trackID, streamKindVideo);
            }
            return;
          }

          const chunkB64 = String(payload.chunk_b64 ?? "");
          if (streamKind !== "audio_pcm_s16le_48k_mono" || !chunkB64) {
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
        case "rtc.offer.publish": {
          void this.handleOfferSignal(params.serverId, params.channelId, payload);
          return;
        }
        case "rtc.answer.publish": {
          void this.handleAnswerSignal(params.serverId, params.channelId, payload);
          return;
        }
        case "rtc.ice.candidate": {
          void this.handleIceCandidateSignal(params.serverId, params.channelId, payload);
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
      this.stopAllLocalVideo(serverId, channelId);
      this.closePeerConnectionsForSession(serverId, channelId);
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
        session.videoStreams = [];
        session.cameraEnabled = false;
        session.screenShareEnabled = false;
        session.cameraErrorMessage = null;
        session.screenShareErrorMessage = null;
        session.errorMessage = options?.reason ?? null;
        session.lastEventAt = new Date().toISOString();
      }
      clearPlaybackState();
      if (this.activeVoiceChannelByServer[serverId] === channelId) {
        this.activeVoiceChannelByServer[serverId] = null;
      }
    },
    clearServerState(serverId: string): void {
      const activeChannelId = this.activeVoiceChannelByServer[serverId];
      if (activeChannelId) {
        this.leaveChannel(serverId, activeChannelId);
      }

      const keyPrefix = `${serverId}:`;
      Object.keys(this.sessionsByKey).forEach((key) => {
        if (!key.startsWith(keyPrefix)) return;
        const channelId = key.slice(keyPrefix.length);
        this.stopMicUplink(serverId, channelId);
        this.stopAllLocalVideo(serverId, channelId, { notify: false });
        this.closePeerConnectionsForSession(serverId, channelId);
        localJoinIdentityByKey.delete(key);
        this.clearSpeakingForSession(serverId, channelId);
        const socket = socketsByKey.get(key);
        if (socket) {
          intentionallyClosed.add(key);
          socket.close();
          socketsByKey.delete(key);
        }
        delete this.sessionsByKey[key];
        intentionallyClosed.delete(key);
      });

      delete this.activeVoiceChannelByServer[serverId];
      delete this.audioPrefsByServer[serverId];
      clearPlaybackState();
    },
    disconnectAll(): void {
      Object.entries(this.activeVoiceChannelByServer).forEach(([serverId, channelId]) => {
        if (channelId) {
          this.leaveChannel(serverId, channelId);
        }
      });
      for (const key of Object.keys(this.sessionsByKey)) {
        const separator = key.indexOf(":");
        if (separator <= 0) continue;
        const serverId = key.slice(0, separator);
        const channelId = key.slice(separator + 1);
        if (!serverId || !channelId) continue;
        this.stopAllLocalVideo(serverId, channelId, { notify: false });
        this.closePeerConnectionsForSession(serverId, channelId);
      }
      speakingTimersByParticipant.forEach((timer) => {
        clearTimeout(timer);
      });
      speakingTimersByParticipant.clear();
      clearPlaybackState();
    }
  }
});
