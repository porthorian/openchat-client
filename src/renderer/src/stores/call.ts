import { defineStore } from "pinia";
import { fetchServerCapabilities, requestJoinTicket, sendSignal, type SignalEnvelope } from "@renderer/services/rtcClient";
import { useServerRegistryStore } from "@renderer/stores/serverRegistry";
import { transitionCallState } from "@renderer/stores/call/machine";
import {
  decideSubscribeSync,
  desiredSubscribeReceiveTrackCount,
  resolveSubscribeReceivePolicy,
  shouldDeferOffer,
  type RTCSubscribeReceivePolicy
} from "@renderer/stores/call/negotiation";
import { buildMicrophoneConstraints } from "@renderer/stores/call/localMedia";
import {
  findPendingRemoteTrackForMeta,
  parseRemoteTrackLifecyclePayload,
  resolveRemoteMetaForObservedTrack,
  selectRemoteTrackMetaForRemoval,
  type RemoteTrackLifecyclePayload,
  type RemoteTrackPendingCandidate
} from "@renderer/stores/call/remoteMedia";
import { parseSignalEnvelopeMessage } from "@renderer/stores/call/signaling";

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
const RTC_AUDIO_MICROPHONE_KIND = "audio_microphone";
const RTC_VIDEO_CAMERA_KIND = "video_camera";
const RTC_VIDEO_SCREEN_KIND = "video_screen";
const RTC_MEDIA_KIND_AUDIO = "audio";
const RTC_MEDIA_KIND_VIDEO = "video";
const RTC_DIRECTION_PUBLISH = "publish";
const RTC_DIRECTION_SUBSCRIBE = "subscribe";
const RTC_SFU_PUBLISH_PEER_ID = "__sfu_publish__";
const RTC_SFU_SUBSCRIBE_PEER_ID = "__sfu_subscribe__";
const socketsByKey = new Map<string, WebSocket>();
const intentionallyClosed = new Set<string>();
const micUplinksByKey = new Map<string, MicUplink>();
const localMicStreamsByKey = new Map<string, MediaStream>();
const peerConnectionsByKey = new Map<string, Map<string, PeerConnectionEntry>>();
const iceServersByKey = new Map<string, RTCIceServer[]>();
const videoHintByKey = new Map<string, Map<string, CallVideoStreamKind>>();
const videoTrackOwnerByKey = new Map<string, Map<string, string>>();
const videoStreamOwnerByKey = new Map<string, Map<string, string>>();
const videoStreamKindByKey = new Map<string, Map<string, CallVideoStreamKind>>();
const remoteTrackMetaByKey = new Map<string, Map<string, RemoteTrackMeta>>();
const pendingRemoteTracksByKey = new Map<string, Map<string, PendingRemoteTrack>>();
const remoteAudioEntriesByKey = new Map<string, Map<string, RemoteAudioEntry>>();
const remoteVideoStatsProbeByKey = new Map<string, ReturnType<typeof setInterval>>();
const remoteVideoStallCountByProbeKey = new Map<string, number>();
const subscribeSyncCooldownByKey = new Map<string, number>();
const subscribeSyncFollowUpReasonByKey = new Map<string, string>();
const subscribeSyncFollowUpTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
const subscribePeerResetCooldownByKey = new Map<string, number>();
const signalingSocketRestartCooldownByKey = new Map<string, number>();
const reconnectTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
const reconnectAttemptByKey = new Map<string, number>();
const joinContextByKey = new Map<string, { backendUrl: string; userUID: string; deviceID: string }>();
const localCameraStreamsByKey = new Map<string, MediaStream>();
const localScreenStreamsByKey = new Map<string, MediaStream>();
const localJoinIdentityByKey = new Map<string, { userUID: string; deviceID: string }>();
const subscribeReceivePolicyByServer = new Map<string, RTCSubscribeReceivePolicy>();
const subscribeReceivePolicyByKey = new Map<string, RTCSubscribeReceivePolicy>();
const speakingTimersByParticipant = new Map<string, ReturnType<typeof setTimeout>>();
const localMicProbeByKey = new Map<string, LocalAudioProbe>();
const remoteAudioProbeByKey = new Map<string, LocalAudioProbe>();
let playbackMuted = false;
let playbackVolume = 0.5;
const speakingIndicatorHoldMS = 450;
const speakingActivityThreshold = 0.018;
const rtcLogPrefix = "[openchat:rtc]";
const rtcDebugEnabled = (() => {
  const envValue = String(import.meta.env.VITE_OPENCHAT_RTC_DEBUG ?? "")
    .trim()
    .toLowerCase();
  if (envValue === "1" || envValue === "true" || envValue === "yes" || envValue === "on") {
    console.debug(`${rtcLogPrefix} RTC debug logging enabled via environment variable.`);
    return true;
  }
  if (envValue === "0" || envValue === "false" || envValue === "no" || envValue === "off") {
    return false;
  }
  if (typeof window === "undefined") return false;
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
  track: MediaStreamTrack;
};

type RemoteTrackMeta = RemoteTrackLifecyclePayload;

type PendingRemoteTrack = {
  connection: RTCPeerConnection;
  mediaStream: MediaStream;
  track: MediaStreamTrack;
  observedTrackId: string;
  observedStreamId: string;
  mediaKind: typeof RTC_MEDIA_KIND_AUDIO | typeof RTC_MEDIA_KIND_VIDEO;
};

type RemoteAudioEntry = {
  entryKey: string;
  participantId: string;
  trackId: string;
  streamId: string;
  mediaStream: MediaStream;
  audioElement: HTMLAudioElement;
};

type LocalAudioProbe = {
  audioContext: AudioContext;
  sourceNode: MediaStreamAudioSourceNode;
  analyserNode: AnalyserNode;
  timer: ReturnType<typeof setInterval>;
};

type PeerSignalDirection = typeof RTC_DIRECTION_PUBLISH | typeof RTC_DIRECTION_SUBSCRIBE;

type PeerConnectionEntry = {
  connection: RTCPeerConnection;
  peerId: string;
  channelId: string;
  direction: PeerSignalDirection;
  makingOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingNegotiation: boolean;
  pendingNegotiationReason: string | null;
  pendingRemoteCandidates: RTCIceCandidateInit[];
};

type ElectronDesktopVideoConstraints = MediaTrackConstraints & {
  mandatory?: {
    chromeMediaSource: "desktop";
    chromeMediaSourceId: string;
    maxFrameRate?: number;
  };
};

type RTCTrackStatsLike = RTCStats & {
  kind?: string;
  trackIdentifier?: string;
  frameWidth?: number;
  frameHeight?: number;
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
  return parseSignalEnvelopeMessage(rawMessage);
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

function toSignalDirection(value: unknown): PeerSignalDirection | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === RTC_DIRECTION_PUBLISH || normalized === RTC_DIRECTION_SUBSCRIBE) {
    return normalized;
  }
  return null;
}

function peerIdForDirection(direction: PeerSignalDirection): string {
  return direction === RTC_DIRECTION_SUBSCRIBE ? RTC_SFU_SUBSCRIBE_PEER_ID : RTC_SFU_PUBLISH_PEER_ID;
}

function directionForPeerId(peerId: string): PeerSignalDirection | null {
  if (peerId === RTC_SFU_PUBLISH_PEER_ID) return RTC_DIRECTION_PUBLISH;
  if (peerId === RTC_SFU_SUBSCRIBE_PEER_ID) return RTC_DIRECTION_SUBSCRIBE;
  return null;
}

function offerTypeForDirection(direction: PeerSignalDirection): "rtc.offer.publish" | "rtc.offer.subscribe" {
  return direction === RTC_DIRECTION_SUBSCRIBE ? "rtc.offer.subscribe" : "rtc.offer.publish";
}

function answerTypeForDirection(direction: PeerSignalDirection): "rtc.answer.publish" | "rtc.answer.subscribe" {
  return direction === RTC_DIRECTION_SUBSCRIBE ? "rtc.answer.subscribe" : "rtc.answer.publish";
}

function toVideoKindFromSignal(streamKind: string): CallVideoStreamKind | null {
  if (streamKind === RTC_VIDEO_CAMERA_KIND) return "camera";
  if (streamKind === RTC_VIDEO_SCREEN_KIND) return "screen";
  return null;
}

function toSignalStreamKind(kind: CallVideoStreamKind): string {
  return kind === "screen" ? RTC_VIDEO_SCREEN_KIND : RTC_VIDEO_CAMERA_KIND;
}

function toRemoteTrackMediaKind(value: unknown): typeof RTC_MEDIA_KIND_AUDIO | typeof RTC_MEDIA_KIND_VIDEO | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === RTC_MEDIA_KIND_AUDIO) return RTC_MEDIA_KIND_AUDIO;
  if (normalized === RTC_MEDIA_KIND_VIDEO) return RTC_MEDIA_KIND_VIDEO;
  return null;
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
  const normalized: Array<RTCIceServer | null> = iceServers.map((server) => {
      const urls = Array.isArray(server.urls)
        ? server.urls
            .map((url) => String(url ?? "").trim())
            .filter((url) => url.length > 0 && !url.toLowerCase().includes("example.invalid"))
        : [];
      if (urls.length === 0) return null;
      return {
        urls: [...urls],
        ...(server.username ? { username: server.username } : {}),
        ...(server.credential ? { credential: server.credential } : {})
      };
    });
  return normalized.filter((server): server is RTCIceServer => server !== null);
}

function uniqueRemoteTrackMetas(metaMap: Map<string, RemoteTrackMeta>): RemoteTrackMeta[] {
  const byCanonicalTrackId = new Map<string, RemoteTrackMeta>();
  for (const meta of metaMap.values()) {
    const canonicalTrackID = String(meta.trackId ?? "").trim();
    if (!canonicalTrackID || byCanonicalTrackId.has(canonicalTrackID)) continue;
    byCanonicalTrackId.set(canonicalTrackID, meta);
  }
  return [...byCanonicalTrackId.values()];
}

function pendingRemoteTrackCandidates(pendingMap: Map<string, PendingRemoteTrack>): Array<RemoteTrackPendingCandidate<PendingRemoteTrack>> {
  return [...pendingMap.entries()].map(([key, value]) => ({
    key,
    value,
    trackId: value.observedTrackId,
    streamId: value.observedStreamId,
    mediaKind: value.mediaKind
  }));
}

function supportsOutputSelection(): boolean {
  if (typeof window === "undefined") return false;
  const mediaElementProto = HTMLMediaElement.prototype as HTMLMediaElement & {
    setSinkId?: (deviceId: string) => Promise<void>;
  };
  return typeof mediaElementProto.setSinkId === "function";
}

function applyAudioElementPlayback(audioElement: HTMLAudioElement): void {
  audioElement.volume = playbackMuted ? 0 : playbackVolume;
  audioElement.muted = playbackMuted;
  void audioElement.play().catch(() => {});
}

function ensureAudioPlayback(): void {
  // No-op for RTP audio playback; remote audio is attached to per-track elements.
}

function audioEntriesForSession(key: string): Map<string, RemoteAudioEntry> {
  const existing = remoteAudioEntriesByKey.get(key);
  if (existing) return existing;
  const created = new Map<string, RemoteAudioEntry>();
  remoteAudioEntriesByKey.set(key, created);
  return created;
}

function stopAudioProbe(probeMap: Map<string, LocalAudioProbe>, probeKey: string): void {
  const probe = probeMap.get(probeKey);
  if (!probe) return;
  clearInterval(probe.timer);
  try {
    probe.sourceNode.disconnect();
  } catch (_error) {
    // No-op.
  }
  try {
    probe.analyserNode.disconnect();
  } catch (_error) {
    // No-op.
  }
  if (probe.audioContext.state !== "closed") {
    void probe.audioContext.close().catch(() => {});
  }
  probeMap.delete(probeKey);
}

function startAudioActivityProbe(params: {
  probeMap: Map<string, LocalAudioProbe>;
  probeKey: string;
  mediaStream: MediaStream;
  onSpeaking: () => void;
}): void {
  stopAudioProbe(params.probeMap, params.probeKey);
  const audioTrack = params.mediaStream.getAudioTracks()[0];
  if (!audioTrack) return;
  const audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(params.mediaStream);
  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 2048;
  sourceNode.connect(analyserNode);
  const samples = new Uint8Array(analyserNode.fftSize);
  const timer = setInterval(() => {
    analyserNode.getByteTimeDomainData(samples);
    let total = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const centered = (samples[index] - 128) / 128;
      total += Math.abs(centered);
    }
    const activity = total / samples.length;
    if (activity >= speakingActivityThreshold) {
      params.onSpeaking();
    }
  }, 180);
  params.probeMap.set(params.probeKey, {
    audioContext,
    sourceNode,
    analyserNode,
    timer
  });
}

function setPlaybackMuted(isMuted: boolean): void {
  playbackMuted = isMuted;
  for (const entries of remoteAudioEntriesByKey.values()) {
    for (const entry of entries.values()) {
      applyAudioElementPlayback(entry.audioElement);
    }
  }
}

function setPlaybackVolume(volume: number): void {
  playbackVolume = Math.max(0, Math.min(1, volume));
  for (const entries of remoteAudioEntriesByKey.values()) {
    for (const entry of entries.values()) {
      applyAudioElementPlayback(entry.audioElement);
    }
  }
}

async function setPlaybackSinkDevice(deviceId: string): Promise<boolean> {
  const mediaElementProto = HTMLMediaElement.prototype as AudioElementWithSink;
  if (typeof mediaElementProto.setSinkId !== "function") {
    return false;
  }
  const normalizedDeviceID = deviceId || DEFAULT_OUTPUT_DEVICE_ID;
  for (const entries of remoteAudioEntriesByKey.values()) {
    for (const entry of entries.values()) {
      const sinkElement = entry.audioElement as AudioElementWithSink;
      if (typeof sinkElement.setSinkId !== "function") continue;
      await sinkElement.setSinkId(normalizedDeviceID);
    }
  }
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
  for (const [key, entries] of remoteAudioEntriesByKey.entries()) {
    for (const [entryKey, entry] of entries.entries()) {
      entry.audioElement.srcObject = null;
      entries.delete(entryKey);
      stopAudioProbe(remoteAudioProbeByKey, `${key}:${entry.trackId}`);
    }
    remoteAudioEntriesByKey.delete(key);
  }
  for (const probeKey of localMicProbeByKey.keys()) {
    stopAudioProbe(localMicProbeByKey, probeKey);
  }
  for (const probeKey of remoteAudioProbeByKey.keys()) {
    stopAudioProbe(remoteAudioProbeByKey, probeKey);
  }
}

function speakingTimerKey(serverId: string, channelId: string, participantId: string): string {
  return `${serverId}:${channelId}:${participantId}`;
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
    clearReconnectState(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const timer = reconnectTimerByKey.get(key);
      if (timer) {
        clearTimeout(timer);
        reconnectTimerByKey.delete(key);
      }
      const followUpTimer = subscribeSyncFollowUpTimerByKey.get(key);
      if (followUpTimer) {
        clearTimeout(followUpTimer);
        subscribeSyncFollowUpTimerByKey.delete(key);
      }
      subscribeSyncFollowUpReasonByKey.delete(key);
      reconnectAttemptByKey.delete(key);
      signalingSocketRestartCooldownByKey.delete(key);
    },
    subscribeReceivePolicyForSession(serverId: string, channelId: string): RTCSubscribeReceivePolicy {
      const key = sessionKey(serverId, channelId);
      return resolveSubscribeReceivePolicy({
        capabilitiesPolicy: subscribeReceivePolicyByServer.get(serverId),
        joinTicketPolicy: subscribeReceivePolicyByKey.get(key)
      });
    },
    desiredSubscribeReceiveTrackCounts(serverId: string, channelId: string): { audio: number; video: number } {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      const localParticipantID = session?.localParticipantId ?? "";
      const policy = this.subscribeReceivePolicyForSession(serverId, channelId);

      const announcedMetas = remoteTrackMetaByKey.get(key);
      let announcedAudioTracks = 0;
      let announcedVideoTracks = 0;
      if (announcedMetas) {
        for (const meta of uniqueRemoteTrackMetas(announcedMetas)) {
          if (localParticipantID && meta.participantId === localParticipantID) continue;
          if (meta.mediaKind === RTC_MEDIA_KIND_AUDIO) {
            announcedAudioTracks += 1;
          } else if (meta.mediaKind === RTC_MEDIA_KIND_VIDEO) {
            announcedVideoTracks += 1;
          }
        }
      }

      const observedVideoTracks = session
        ? session.videoStreams.filter((entry) => !entry.isLocal).length
        : 0;
      const observedAudioTracks = remoteAudioEntriesByKey.get(key)?.size ?? 0;

      const pendingTracks = pendingRemoteTracksByKey.get(key);
      let pendingAudioTracks = 0;
      let pendingVideoTracks = 0;
      if (pendingTracks) {
        for (const pending of pendingTracks.values()) {
          if (pending.mediaKind === RTC_MEDIA_KIND_AUDIO) {
            pendingAudioTracks += 1;
          } else if (pending.mediaKind === RTC_MEDIA_KIND_VIDEO) {
            pendingVideoTracks += 1;
          }
        }
      }

      return {
        audio: desiredSubscribeReceiveTrackCount({
          cap: policy.maxAudioTracks,
          announcedTracks: announcedAudioTracks,
          observedTracks: observedAudioTracks,
          pendingTracks: pendingAudioTracks
        }),
        video: desiredSubscribeReceiveTrackCount({
          cap: policy.maxVideoTracks,
          announcedTracks: announcedVideoTracks,
          observedTracks: observedVideoTracks,
          pendingTracks: pendingVideoTracks
        })
      };
    },
    countSubscribeRecvonlyTransceivers(connection: RTCPeerConnection, kind: "audio" | "video"): number {
      return connection.getTransceivers().filter((transceiver) => {
        if (transceiver.direction === "stopped" || transceiver.currentDirection === "stopped") return false;
        const receiverKind = transceiver.receiver?.track?.kind;
        if (receiverKind !== kind) return false;
        const direction = transceiver.direction;
        const currentDirection = transceiver.currentDirection;
        return (
          direction === "recvonly" ||
          direction === "sendrecv" ||
          currentDirection === "recvonly" ||
          currentDirection === "sendrecv"
        );
      }).length;
    },
    ensureSubscribeRecvonlyTransceivers(
      serverId: string,
      channelId: string,
      peer: PeerConnectionEntry,
      reason: string
    ): void {
      if (peer.direction !== RTC_DIRECTION_SUBSCRIBE || peer.connection.signalingState === "closed") return;
      const desiredCounts = this.desiredSubscribeReceiveTrackCounts(serverId, channelId);
      const desiredByKind: Array<{ kind: "audio" | "video"; desired: number }> = [
        { kind: "audio", desired: desiredCounts.audio },
        { kind: "video", desired: desiredCounts.video }
      ];
      for (const target of desiredByKind) {
        let existing = this.countSubscribeRecvonlyTransceivers(peer.connection, target.kind);
        while (existing < target.desired) {
          try {
            peer.connection.addTransceiver(target.kind, { direction: "recvonly" });
            existing += 1;
            rtcLog("subscribe.transceiver.add", {
              serverId,
              channelId,
              reason,
              kind: target.kind,
              existing,
              desired: target.desired
            });
          } catch (error) {
            rtcLog("subscribe.transceiver.add.error", {
              serverId,
              channelId,
              reason,
              kind: target.kind,
              existing,
              desired: target.desired,
              message: (error as Error).message
            });
            return;
          }
        }
      }
    },
    scheduleSubscribeSyncFollowUp(serverId: string, channelId: string, reason: string, delayMs: number): void {
      const key = sessionKey(serverId, channelId);
      subscribeSyncFollowUpReasonByKey.set(key, reason);
      const existingTimer = subscribeSyncFollowUpTimerByKey.get(key);
      if (existingTimer) return;
      const timer = setTimeout(() => {
        subscribeSyncFollowUpTimerByKey.delete(key);
        const queuedReason = subscribeSyncFollowUpReasonByKey.get(key);
        subscribeSyncFollowUpReasonByKey.delete(key);
        if (!queuedReason) return;
        this.requestSubscribeSync(serverId, channelId, `queued:${queuedReason}`, 0);
      }, Math.max(0, delayMs));
      subscribeSyncFollowUpTimerByKey.set(key, timer);
    },
    restartSignalingSocket(serverId: string, channelId: string, reason: string, cooldownMs = 30_000): boolean {
      const key = sessionKey(serverId, channelId);
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        rtcLog("signaling.socket.restart.skip.closed", {
          serverId,
          channelId,
          reason
        });
        return false;
      }
      const now = Date.now();
      const lastRestartAt = signalingSocketRestartCooldownByKey.get(key) ?? 0;
      if (now - lastRestartAt < cooldownMs) {
        rtcLog("signaling.socket.restart.skip.cooldown", {
          serverId,
          channelId,
          reason,
          cooldownMs,
          elapsedMs: now - lastRestartAt
        });
        return false;
      }
      signalingSocketRestartCooldownByKey.set(key, now);
      rtcLog("signaling.socket.restart.requested", {
        serverId,
        channelId,
        reason
      });
      try {
        socket.close(4000, reason);
      } catch (_error) {
        socket.close();
      }
      return true;
    },
    scheduleSignalingReconnect(serverId: string, channelId: string, reason: string): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session || intentionallyClosed.has(key)) return;
      const existingTimer = reconnectTimerByKey.get(key);
      if (existingTimer) return;
      const context = joinContextByKey.get(key);
      if (!context) {
        session.state = "error";
        session.errorMessage = "Call signaling disconnected.";
        return;
      }
      const attempt = (reconnectAttemptByKey.get(key) ?? 0) + 1;
      reconnectAttemptByKey.set(key, attempt);
      const delayMs = Math.min(8_000, Math.max(1_000, 1_000 * 2 ** (attempt - 1)));
      rtcLog("signaling.socket.reconnect.scheduled", {
        serverId,
        channelId,
        reason,
        attempt,
        delayMs
      });
      session.state = transitionCallState(session.state, "signal_disconnected");
      session.errorMessage = "Call signaling disconnected. Reconnecting...";
      const timer = setTimeout(() => {
        reconnectTimerByKey.delete(key);
        if (intentionallyClosed.has(key)) return;
        if (this.activeVoiceChannelByServer[serverId] !== channelId) return;
        const activeSocket = socketsByKey.get(key);
        if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
          reconnectAttemptByKey.delete(key);
          return;
        }
        void this.joinChannel({
          serverId,
          channelId,
          backendUrl: context.backendUrl,
          userUID: context.userUID,
          deviceID: context.deviceID
        });
      }, delayMs);
      reconnectTimerByKey.set(key, timer);
    },
    requestSubscribeSync(serverId: string, channelId: string, reason: string, cooldownMs = 2_000): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session || session.state !== "active") {
        rtcLog("subscribe.sync.skip.inactive", {
          serverId,
          channelId,
          reason
        });
        return;
      }
      const now = Date.now();
      const lastSyncAt = subscribeSyncCooldownByKey.get(key) ?? 0;
      const subscribePeer = this.ensurePeerConnection(serverId, channelId, RTC_SFU_SUBSCRIBE_PEER_ID);
      if (!subscribePeer) {
        rtcLog("subscribe.sync.skip.no-peer", {
          serverId,
          channelId,
          reason
        });
        return;
      }
      this.ensureSubscribeRecvonlyTransceivers(serverId, channelId, subscribePeer, `sync:${reason}`);

      const peerBusy =
        subscribePeer.connection.signalingState !== "stable" ||
        subscribePeer.makingOffer ||
        subscribePeer.isSettingRemoteAnswerPending;
      const coolingDown = now - lastSyncAt < cooldownMs;
      const decision = decideSubscribeSync({
        coolingDown,
        peerBusy
      });
      if (!decision.sendImmediately && decision.queueFollowUp) {
        subscribeSyncFollowUpReasonByKey.set(key, reason);
        if (peerBusy && !coolingDown) {
          subscribePeer.pendingNegotiation = true;
          subscribePeer.pendingNegotiationReason = `subscribe-sync:${reason}`;
        }
        if (coolingDown) {
          const remainingMs = Math.max(0, cooldownMs - (now - lastSyncAt));
          this.scheduleSubscribeSyncFollowUp(serverId, channelId, reason, remainingMs);
        }
        rtcLog("subscribe.sync.queued", {
          serverId,
          channelId,
          reason,
          coolingDown,
          peerBusy,
          cooldownMs,
          elapsedMs: now - lastSyncAt,
          signalingState: subscribePeer.connection.signalingState,
          makingOffer: subscribePeer.makingOffer,
          isSettingRemoteAnswerPending: subscribePeer.isSettingRemoteAnswerPending
        });
        return;
      }
      subscribeSyncFollowUpReasonByKey.delete(key);
      const followUpTimer = subscribeSyncFollowUpTimerByKey.get(key);
      if (followUpTimer) {
        clearTimeout(followUpTimer);
        subscribeSyncFollowUpTimerByKey.delete(key);
      }
      subscribeSyncCooldownByKey.set(key, now);
      rtcLog("subscribe.sync.requested.internal", {
        serverId,
        channelId,
        reason
      });
      void this.createAndSendOffer(serverId, channelId, subscribePeer.peerId, "sync-subscribe");
    },
    resetSubscribePeerConnection(serverId: string, channelId: string, reason: string, cooldownMs = 12_000): boolean {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session || session.state !== "active") {
        rtcLog("subscribe.peer.reset.skip.inactive", {
          serverId,
          channelId,
          reason
        });
        return false;
      }
      const now = Date.now();
      const lastResetAt = subscribePeerResetCooldownByKey.get(key) ?? 0;
      if (now - lastResetAt < cooldownMs) {
        rtcLog("subscribe.peer.reset.skip.cooldown", {
          serverId,
          channelId,
          reason,
          cooldownMs,
          elapsedMs: now - lastResetAt
        });
        return false;
      }
      subscribePeerResetCooldownByKey.set(key, now);
      rtcLog("subscribe.peer.reset", {
        serverId,
        channelId,
        reason
      });
      this.stopRemoteVideoStatsProbesForSession(serverId, channelId);
      this.closePeerConnection(serverId, channelId, RTC_SFU_SUBSCRIBE_PEER_ID);
      const subscribePeer = this.ensurePeerConnection(serverId, channelId, RTC_SFU_SUBSCRIBE_PEER_ID);
      if (!subscribePeer) {
        rtcLog("subscribe.peer.reset.skip.no-peer", {
          serverId,
          channelId,
          reason
        });
        return false;
      }
      void this.createAndSendOffer(serverId, channelId, subscribePeer.peerId, `reset:${reason}`);
      return true;
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
    trackOwnersForSession(key: string): Map<string, string> {
      const existing = videoTrackOwnerByKey.get(key);
      if (existing) return existing;
      const created = new Map<string, string>();
      videoTrackOwnerByKey.set(key, created);
      return created;
    },
    streamOwnersForSession(key: string): Map<string, string> {
      const existing = videoStreamOwnerByKey.get(key);
      if (existing) return existing;
      const created = new Map<string, string>();
      videoStreamOwnerByKey.set(key, created);
      return created;
    },
    streamKindsForSession(key: string): Map<string, CallVideoStreamKind> {
      const existing = videoStreamKindByKey.get(key);
      if (existing) return existing;
      const created = new Map<string, CallVideoStreamKind>();
      videoStreamKindByKey.set(key, created);
      return created;
    },
    remoteTrackMetaForSession(key: string): Map<string, RemoteTrackMeta> {
      const existing = remoteTrackMetaByKey.get(key);
      if (existing) return existing;
      const created = new Map<string, RemoteTrackMeta>();
      remoteTrackMetaByKey.set(key, created);
      return created;
    },
    pendingRemoteTracksForSession(key: string): Map<string, PendingRemoteTrack> {
      const existing = pendingRemoteTracksByKey.get(key);
      if (existing) return existing;
      const created = new Map<string, PendingRemoteTrack>();
      pendingRemoteTracksByKey.set(key, created);
      return created;
    },
    upsertRemoteTrackMeta(serverId: string, channelId: string, meta: RemoteTrackMeta): void {
      const key = sessionKey(serverId, channelId);
      const metaMap = this.remoteTrackMetaForSession(key);
      metaMap.set(meta.trackId, meta);
      if (meta.mediaKind === RTC_MEDIA_KIND_VIDEO) {
        const streamKind = meta.streamKind === RTC_VIDEO_SCREEN_KIND ? "screen" : "camera";
        this.updateVideoHint(serverId, channelId, meta.participantId, meta.trackId, streamKind, meta.streamId);
        this.reclassifyBoundVideoStreamKind(serverId, channelId, meta.participantId, meta.trackId, meta.streamId);
      }
      const pendingMap = this.pendingRemoteTracksForSession(key);
      const pendingResolution = findPendingRemoteTrackForMeta({
        pending: pendingRemoteTrackCandidates(pendingMap),
        meta
      });
      if (!pendingResolution) return;

      pendingMap.delete(pendingResolution.key);
      const pending = pendingResolution.value;
      if (pending.observedTrackId && pending.observedTrackId !== meta.trackId) {
        metaMap.set(pending.observedTrackId, meta);
      }
      if (pendingResolution.strategy === "stream") {
        rtcLog("track.meta.resolve.by_stream", {
          serverId,
          channelId,
          participantId: meta.participantId,
          mediaKind: meta.mediaKind,
          signaledTrackId: meta.trackId,
          signaledStreamId: meta.streamId || null,
          observedTrackId: pending.observedTrackId,
          observedStreamId: pending.observedStreamId
        });
      } else if (pendingResolution.strategy === "heuristic") {
        rtcLog("track.meta.resolve.by_heuristic", {
          serverId,
          channelId,
          participantId: meta.participantId,
          mediaKind: meta.mediaKind,
          signaledTrackId: meta.trackId,
          signaledStreamId: meta.streamId || null,
          observedTrackId: pending.observedTrackId,
          observedStreamId: pending.observedStreamId
        });
      }
      if (meta.mediaKind === RTC_MEDIA_KIND_VIDEO) {
        this.handleRemoteVideoTrack({
          serverId,
          channelId,
          participantId: meta.participantId,
          signalStreamID: meta.streamId || pending.observedStreamId || pending.mediaStream.id,
          connection: pending.connection,
          mediaStream: pending.mediaStream,
          track: pending.track
        });
        return;
      }
      this.handleRemoteAudioTrack({
        serverId,
        channelId,
        participantId: meta.participantId,
        streamId: meta.streamId || pending.observedStreamId || pending.mediaStream.id,
        trackId: pending.observedTrackId || meta.trackId,
        mediaStream: pending.mediaStream,
        track: pending.track
      });
    },
    removeRemoteTrackMeta(params: {
      serverId: string;
      channelId: string;
      trackId?: string;
      streamId?: string;
      mediaKind?: typeof RTC_MEDIA_KIND_AUDIO | typeof RTC_MEDIA_KIND_VIDEO;
    }): void {
      const trackId = String(params.trackId ?? "").trim();
      const streamId = String(params.streamId ?? "").trim();
      if (!trackId && !streamId) return;
      const key = sessionKey(params.serverId, params.channelId);
      const metaMap = remoteTrackMetaByKey.get(key);
      if (metaMap) {
        const canonicalTrackID = trackId && metaMap.get(trackId) ? metaMap.get(trackId)?.trackId ?? trackId : trackId;
        const removalTargets = selectRemoteTrackMetaForRemoval({
          metas: uniqueRemoteTrackMetas(metaMap),
          trackId: canonicalTrackID || undefined,
          streamId: streamId || undefined,
          mediaKind: params.mediaKind
        });
        for (const target of removalTargets) {
          const relatedTrackIDs = [...metaMap.entries()]
            .filter(([, mappedMeta]) => mappedMeta.trackId === target.trackId)
            .map(([mappedTrackID]) => mappedTrackID);

          if (target.mediaKind === RTC_MEDIA_KIND_VIDEO) {
            for (const relatedTrackID of relatedTrackIDs) {
              this.removeVideoStream(params.serverId, params.channelId, `${target.participantId}:${relatedTrackID}`);
              this.deleteVideoHint(params.serverId, params.channelId, target.participantId, relatedTrackID);
            }
            if (target.streamId) {
              this.removeVideoStreamsBySignalStreamID(params.serverId, params.channelId, target.streamId);
            }
          } else {
            for (const relatedTrackID of relatedTrackIDs) {
              this.removeRemoteAudioTrack(params.serverId, params.channelId, target.participantId, relatedTrackID);
            }
            if (target.streamId) {
              this.removeRemoteAudioByStreamID(params.serverId, params.channelId, target.participantId, target.streamId);
            }
          }

          for (const relatedTrackID of relatedTrackIDs) {
            metaMap.delete(relatedTrackID);
          }
        }
        if (metaMap.size === 0) {
          remoteTrackMetaByKey.delete(key);
        }
      }
      const pending = pendingRemoteTracksByKey.get(key);
      if (pending) {
        for (const [pendingTrackID, pendingTrack] of pending.entries()) {
          const matchesTrack = !!trackId && (pendingTrackID === trackId || pendingTrack.observedTrackId === trackId);
          const matchesStream =
            !!streamId &&
            pendingTrack.observedStreamId === streamId &&
            (!params.mediaKind || pendingTrack.mediaKind === params.mediaKind);
          if (matchesTrack || matchesStream) {
            pending.delete(pendingTrackID);
          }
        }
        if (pending.size === 0) {
          pendingRemoteTracksByKey.delete(key);
        }
      }
    },
    removeRemoteTrackMetaByParticipant(serverId: string, channelId: string, participantId: string): void {
      if (!participantId) return;
      const key = sessionKey(serverId, channelId);
      const metaMap = remoteTrackMetaByKey.get(key);
      if (!metaMap) return;
      const trackIDs = uniqueRemoteTrackMetas(metaMap)
        .filter((meta) => meta.participantId === participantId)
        .map((meta) => meta.trackId);
      for (const trackID of trackIDs) {
        this.removeRemoteTrackMeta({
          serverId,
          channelId,
          trackId: trackID
        });
      }
    },
    updateVideoHint(
      serverId: string,
      channelId: string,
      participantId: string,
      trackId: string,
      kind: CallVideoStreamKind,
      streamId?: string
    ): void {
      if (!participantId) return;
      const key = sessionKey(serverId, channelId);
      if (trackId) {
        this.videoHintsForSession(key).set(videoHintKey(participantId, trackId), kind);
        this.trackOwnersForSession(key).set(trackId, participantId);
      }
      if (streamId) {
        this.streamOwnersForSession(key).set(streamId, participantId);
        this.streamKindsForSession(key).set(streamId, kind);
      }
    },
    deleteVideoHint(serverId: string, channelId: string, participantId: string, trackId: string): void {
      if (!participantId || !trackId) return;
      const key = sessionKey(serverId, channelId);
      const hintMap = videoHintByKey.get(key);
      if (!hintMap) return;
      hintMap.delete(videoHintKey(participantId, trackId));
      const trackOwners = videoTrackOwnerByKey.get(key);
      if (trackOwners?.get(trackId) === participantId) {
        trackOwners.delete(trackId);
        if (trackOwners.size === 0) {
          videoTrackOwnerByKey.delete(key);
        }
      }
      if (hintMap.size === 0) {
        videoHintByKey.delete(key);
      }
    },
    deleteVideoHintsForParticipant(serverId: string, channelId: string, participantId: string): void {
      if (!participantId) return;
      const key = sessionKey(serverId, channelId);
      const hintMap = videoHintByKey.get(key);
      if (hintMap) {
        const prefix = `${participantId}:`;
        for (const hintKey of hintMap.keys()) {
          if (hintKey.startsWith(prefix)) {
            hintMap.delete(hintKey);
          }
        }
        if (hintMap.size === 0) {
          videoHintByKey.delete(key);
        }
      }
      const trackOwners = videoTrackOwnerByKey.get(key);
      if (trackOwners) {
        for (const [trackId, ownerParticipantId] of trackOwners.entries()) {
          if (ownerParticipantId === participantId) {
            trackOwners.delete(trackId);
          }
        }
        if (trackOwners.size === 0) {
          videoTrackOwnerByKey.delete(key);
        }
      }
      const streamOwners = videoStreamOwnerByKey.get(key);
      if (streamOwners) {
        for (const [streamId, ownerParticipantId] of streamOwners.entries()) {
          if (ownerParticipantId === participantId) {
            streamOwners.delete(streamId);
          }
        }
        if (streamOwners.size === 0) {
          videoStreamOwnerByKey.delete(key);
        }
      }
      const streamKinds = videoStreamKindByKey.get(key);
      if (streamKinds) {
        const activeStreamOwners = videoStreamOwnerByKey.get(key);
        for (const streamId of streamKinds.keys()) {
          if (!activeStreamOwners || !activeStreamOwners.has(streamId)) {
            streamKinds.delete(streamId);
          }
        }
        if (streamKinds.size === 0) {
          videoStreamKindByKey.delete(key);
        }
      }
    },
    resolveParticipantIDForSignalStream(serverId: string, channelId: string, streamId: string): string | null {
      if (!streamId) return null;
      const key = sessionKey(serverId, channelId);
      return videoStreamOwnerByKey.get(key)?.get(streamId) ?? null;
    },
    resolveVideoKindForSignalStream(serverId: string, channelId: string, streamId: string): CallVideoStreamKind | null {
      if (!streamId) return null;
      const key = sessionKey(serverId, channelId);
      return videoStreamKindByKey.get(key)?.get(streamId) ?? null;
    },
    reclassifyBoundVideoStreamKind(
      serverId: string,
      channelId: string,
      participantId: string,
      trackId: string,
      signalStreamID: string
    ): void {
      if (!participantId) return;
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;

      const hintByTrack = trackId ? this.videoHintsForSession(key).get(videoHintKey(participantId, trackId)) : null;
      const hintByStream = signalStreamID ? this.resolveVideoKindForSignalStream(serverId, channelId, signalStreamID) : null;
      const nextKind = hintByTrack ?? hintByStream;
      if (!nextKind) return;

      const streamIndex = session.videoStreams.findIndex((entry) => {
        if (entry.participantId !== participantId) return false;
        if (trackId && entry.trackId === trackId) return true;
        if (signalStreamID && entry.mediaStream.id === signalStreamID) return true;
        return false;
      });
      if (streamIndex < 0) return;

      const current = session.videoStreams[streamIndex];
      if (!current || current.kind === nextKind) return;
      session.videoStreams.splice(streamIndex, 1, {
        ...current,
        kind: nextKind
      });
      rtcLog("video.stream.reclassified", {
        serverId,
        channelId,
        participantId,
        trackId: current.trackId,
        streamId: current.mediaStream.id,
        previousKind: current.kind,
        nextKind
      });
    },
    resolveParticipantIDForTrack(serverId: string, channelId: string, trackId: string): string | null {
      if (!trackId) return null;
      const key = sessionKey(serverId, channelId);
      const trackOwners = videoTrackOwnerByKey.get(key);
      const ownerParticipantId = trackOwners?.get(trackId);
      if (ownerParticipantId) return ownerParticipantId;

      const hintMap = videoHintByKey.get(key);
      if (!hintMap) return null;
      for (const hintKey of hintMap.keys()) {
        if (!hintKey.endsWith(`:${trackId}`)) continue;
        const separatorIndex = hintKey.indexOf(":");
        if (separatorIndex <= 0) continue;
        const participantId = hintKey.slice(0, separatorIndex).trim();
        if (participantId) return participantId;
      }
      return null;
    },
    resolveParticipantIDForIncomingVideo(
      serverId: string,
      channelId: string,
      trackId: string,
      streamId: string,
      kind: CallVideoStreamKind,
      options?: { allowHeuristic?: boolean }
    ): string {
      const byTrack = this.resolveParticipantIDForTrack(serverId, channelId, trackId);
      if (byTrack) return byTrack;
      const byStream = this.resolveParticipantIDForSignalStream(serverId, channelId, streamId);
      if (byStream) return byStream;
      if (!options?.allowHeuristic) {
        return "participant_unknown";
      }
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return "participant_unknown";
      const remoteParticipants = session.participants.filter((item) => item.participantId && !item.isLocal);
      if (remoteParticipants.length === 1) {
        return remoteParticipants[0].participantId;
      }

      const missingKindCandidates = remoteParticipants.filter((participant) => {
        return !session.videoStreams.some((stream) => stream.participantId === participant.participantId && stream.kind === kind);
      });
      if (missingKindCandidates.length === 1) {
        return missingKindCandidates[0].participantId;
      }
      return "participant_unknown";
    },
    remoteVideoProbeKey(serverId: string, channelId: string, trackId: string): string {
      return `${sessionKey(serverId, channelId)}:${trackId}`;
    },
    stopRemoteVideoStatsProbe(serverId: string, channelId: string, trackId: string): void {
      if (!trackId) return;
      const key = this.remoteVideoProbeKey(serverId, channelId, trackId);
      const timer = remoteVideoStatsProbeByKey.get(key);
      if (!timer) return;
      clearInterval(timer);
      remoteVideoStatsProbeByKey.delete(key);
      remoteVideoStallCountByProbeKey.delete(key);
    },
    stopRemoteVideoStatsProbesForSession(serverId: string, channelId: string): void {
      const prefix = `${sessionKey(serverId, channelId)}:`;
      for (const [probeKey, timer] of remoteVideoStatsProbeByKey.entries()) {
        if (!probeKey.startsWith(prefix)) continue;
        clearInterval(timer);
        remoteVideoStatsProbeByKey.delete(probeKey);
      }
      for (const probeKey of remoteVideoStallCountByProbeKey.keys()) {
        if (!probeKey.startsWith(prefix)) continue;
        remoteVideoStallCountByProbeKey.delete(probeKey);
      }
    },
    startRemoteVideoStatsProbe(params: {
      serverId: string;
      channelId: string;
      participantId: string;
      signalStreamID: string;
      kind: CallVideoStreamKind;
      connection: RTCPeerConnection;
      track: MediaStreamTrack;
    }): void {
      if (!rtcDebugEnabled || params.track.kind !== "video") return;
      this.stopRemoteVideoStatsProbe(params.serverId, params.channelId, params.track.id);

      const probeKey = this.remoteVideoProbeKey(params.serverId, params.channelId, params.track.id);
      let sampleCount = 0;
      let lastBytesReceived = 0;
      let zeroDeltaStreak = 0;
      const poll = async (): Promise<void> => {
        const key = sessionKey(params.serverId, params.channelId);
        const session = this.sessionsByKey[key];
        const stillTracked = Boolean(
          session?.videoStreams.some(
            (entry) => entry.trackId === params.track.id && entry.participantId === params.participantId
          )
        );
        if (!stillTracked) {
          this.stopRemoteVideoStatsProbe(params.serverId, params.channelId, params.track.id);
          return;
        }
        if (params.connection.signalingState === "closed" || params.connection.connectionState === "closed") {
          this.stopRemoteVideoStatsProbe(params.serverId, params.channelId, params.track.id);
          return;
        }
        try {
          const stats = await params.connection.getStats(params.track);
          const inboundVideoReports: RTCInboundRtpStreamStats[] = [];
          let trackVideo: RTCTrackStatsLike | null = null;
          let fallbackTrackVideo: RTCTrackStatsLike | null = null;
          stats.forEach((report) => {
            if (report.type === "inbound-rtp") {
              const inbound = report as RTCInboundRtpStreamStats;
              if (inbound.kind === "video") {
                inboundVideoReports.push(inbound);
              }
              return;
            }
            if (report.type === "track") {
              const trackReport = report as RTCTrackStatsLike;
              if (trackReport.kind === "video") {
                if (!fallbackTrackVideo) {
                  fallbackTrackVideo = trackReport;
                }
                const trackIdentifier = String(
                  (trackReport as unknown as Record<string, unknown>).trackIdentifier ?? ""
                );
                if (trackIdentifier === params.track.id) {
                  trackVideo = trackReport;
                }
              }
            }
          });
          if (!trackVideo) {
            trackVideo = fallbackTrackVideo;
          }
          let inboundVideo: RTCInboundRtpStreamStats | null = null;
          if (inboundVideoReports.length === 1) {
            inboundVideo = inboundVideoReports[0];
          } else if (inboundVideoReports.length > 1) {
            const trackStatsID = String((trackVideo as unknown as Record<string, unknown> | null)?.id ?? "");
            if (trackStatsID) {
              inboundVideo =
                inboundVideoReports.find((report) => {
                  const reportTrackID = String((report as unknown as Record<string, unknown>).trackId ?? "");
                  return reportTrackID === trackStatsID;
                }) ?? null;
            }
            if (!inboundVideo) {
              inboundVideo = inboundVideoReports.reduce<RTCInboundRtpStreamStats | null>((best, report) => {
                if (!best) return report;
                const currentBytes = Number(report.bytesReceived ?? 0);
                const bestBytes = Number(best.bytesReceived ?? 0);
                return currentBytes > bestBytes ? report : best;
              }, null);
            }
          }

          sampleCount += 1;
          const bytesReceived = Number(inboundVideo?.bytesReceived ?? 0);
          const bytesDelta = bytesReceived - lastBytesReceived;
          lastBytesReceived = bytesReceived;
          if (
            bytesDelta <= 0 &&
            params.connection.connectionState === "connected" &&
            params.connection.iceConnectionState === "connected" &&
            params.track.readyState !== "ended" &&
            !params.track.muted
          ) {
            zeroDeltaStreak += 1;
          } else {
            zeroDeltaStreak = 0;
            if (bytesDelta > 0) {
              remoteVideoStallCountByProbeKey.delete(probeKey);
            }
          }
          rtcLog("track.stats", {
            serverId: params.serverId,
            channelId: params.channelId,
            participantId: params.participantId,
            signalStreamID: params.signalStreamID,
            trackId: params.track.id,
            kind: params.kind,
            sampleCount,
            bytesReceived,
            bytesDelta,
            packetsReceived: inboundVideo?.packetsReceived ?? null,
            packetsLost: inboundVideo?.packetsLost ?? null,
            framesReceived: inboundVideo?.framesReceived ?? null,
            framesDecoded: inboundVideo?.framesDecoded ?? null,
            keyFramesDecoded: inboundVideo?.keyFramesDecoded ?? null,
            pliCount: inboundVideo?.pliCount ?? null,
            firCount: inboundVideo?.firCount ?? null,
            nackCount: inboundVideo?.nackCount ?? null,
            frameWidth: Number((trackVideo as unknown as Record<string, unknown> | null)?.frameWidth ?? 0) || null,
            frameHeight: Number((trackVideo as unknown as Record<string, unknown> | null)?.frameHeight ?? 0) || null,
            zeroDeltaStreak,
            connectionState: params.connection.connectionState,
            iceConnectionState: params.connection.iceConnectionState
          });
          if (zeroDeltaStreak >= 5) {
            const stallCount = (remoteVideoStallCountByProbeKey.get(probeKey) ?? 0) + 1;
            remoteVideoStallCountByProbeKey.set(probeKey, stallCount);
            rtcLog("track.stats.stalled", {
              serverId: params.serverId,
              channelId: params.channelId,
              participantId: params.participantId,
              signalStreamID: params.signalStreamID,
              trackId: params.track.id,
              kind: params.kind,
              sampleCount,
              bytesReceived,
              stallCount
            });
            this.requestSubscribeSync(params.serverId, params.channelId, "stalled-video", 5_000);
            const packetsReceived = Number(inboundVideo?.packetsReceived ?? 0);
            const framesReceived = Number(inboundVideo?.framesReceived ?? 0);
            const hadMediaFlow = bytesReceived > 0 || packetsReceived > 0 || framesReceived > 0;
            if (stallCount >= 3 && hadMediaFlow) {
              this.requestSubscribeSync(params.serverId, params.channelId, "stalled-repeat", 8_000);
            }
            if (stallCount >= 3 && !hadMediaFlow) {
              const socket = socketsByKey.get(key);
              const signalingOpen = Boolean(socket && socket.readyState === WebSocket.OPEN);
              rtcLog("track.stats.stalled.zero-inbound", {
                serverId: params.serverId,
                channelId: params.channelId,
                participantId: params.participantId,
                signalStreamID: params.signalStreamID,
                trackId: params.track.id,
                kind: params.kind,
                stallCount,
                signalingOpen
              });
              if (signalingOpen) {
                this.requestSubscribeSync(params.serverId, params.channelId, "stalled-zero-inbound", 8_000);
                if (stallCount >= 6) {
                  this.restartSignalingSocket(params.serverId, params.channelId, "stalled-zero-inbound", 30_000);
                }
              } else {
                this.scheduleSignalingReconnect(params.serverId, params.channelId, "stalled-zero-inbound");
              }
            }
            zeroDeltaStreak = 0;
          }
        } catch (error) {
          rtcLog("track.stats.error", {
            serverId: params.serverId,
            channelId: params.channelId,
            participantId: params.participantId,
            trackId: params.track.id,
            message: (error as Error).message
          });
          this.stopRemoteVideoStatsProbe(params.serverId, params.channelId, params.track.id);
        }
      };

      const timer = setInterval(() => {
        void poll();
      }, 1000);
      remoteVideoStatsProbeByKey.set(probeKey, timer);
      void poll();
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
        const replaced = session.videoStreams[sameKindIndex];
        if (replaced.trackId !== next.trackId) {
          this.stopRemoteVideoStatsProbe(params.serverId, params.channelId, replaced.trackId);
          this.deleteVideoHint(params.serverId, params.channelId, replaced.participantId, replaced.trackId);
        }
        session.videoStreams.splice(sameKindIndex, 1, next);
        return;
      }
      session.videoStreams.push(next);
    },
    removeVideoStream(
      serverId: string,
      channelId: string,
      streamKeyToRemove: string,
      options?: { stopProbe?: boolean }
    ): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const removed = session.videoStreams.find((entry) => entry.streamKey === streamKeyToRemove);
      session.videoStreams = session.videoStreams.filter((entry) => entry.streamKey !== streamKeyToRemove);
      if (removed && options?.stopProbe !== false) {
        this.stopRemoteVideoStatsProbe(serverId, channelId, removed.trackId);
      }
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
      const removed = session.videoStreams.filter((entry) => {
        if (entry.participantId !== participantId) return false;
        if (!kind) return true;
        return entry.kind === kind;
      });
      session.videoStreams = session.videoStreams.filter((entry) => {
        if (entry.participantId !== participantId) return true;
        if (!kind) return false;
        return entry.kind !== kind;
      });
      for (const entry of removed) {
        this.stopRemoteVideoStatsProbe(serverId, channelId, entry.trackId);
      }
    },
    removeVideoStreamsBySignalStreamID(serverId: string, channelId: string, signalStreamID: string): void {
      if (!signalStreamID) return;
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const removed = session.videoStreams.filter((entry) => entry.mediaStream.id === signalStreamID);
      session.videoStreams = session.videoStreams.filter((entry) => entry.mediaStream.id !== signalStreamID);
      for (const entry of removed) {
        this.stopRemoteVideoStatsProbe(serverId, channelId, entry.trackId);
      }
    },
    rebindVideoStreamParticipant(serverId: string, channelId: string, trackId: string, participantId: string): void {
      if (!trackId || !participantId) return;
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const existing = session.videoStreams.find((entry) => entry.trackId === trackId);
      if (!existing || existing.participantId === participantId) return;
      const participant = session.participants.find((item) => item.participantId === participantId);
      this.removeVideoStream(serverId, channelId, existing.streamKey, { stopProbe: false });
      this.upsertVideoStream({
        serverId,
        channelId,
        participantId,
        userUID: participant?.userUID ?? existing.userUID,
        deviceID: participant?.deviceID ?? existing.deviceID,
        kind: existing.kind,
        mediaStream: existing.mediaStream,
        trackId: existing.trackId,
        isLocal: session.localParticipantId === participantId
      });
    },
    rebindVideoStreamsBySignalStreamID(serverId: string, channelId: string, signalStreamID: string, participantId: string): void {
      if (!signalStreamID || !participantId) return;
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const participant = session.participants.find((item) => item.participantId === participantId);
      const candidates = session.videoStreams.filter(
        (entry) => entry.participantId === "participant_unknown" && entry.mediaStream.id === signalStreamID
      );
      for (const existing of candidates) {
        this.removeVideoStream(serverId, channelId, existing.streamKey, { stopProbe: false });
        this.upsertVideoStream({
          serverId,
          channelId,
          participantId,
          userUID: participant?.userUID ?? existing.userUID,
          deviceID: participant?.deviceID ?? existing.deviceID,
          kind: existing.kind,
          mediaStream: existing.mediaStream,
          trackId: existing.trackId,
          isLocal: session.localParticipantId === participantId
        });
      }
    },
    rebindUnknownVideoStreamByKind(serverId: string, channelId: string, participantId: string, kind: CallVideoStreamKind): void {
      if (!participantId) return;
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const existing = session.videoStreams.find((entry) => entry.participantId === "participant_unknown" && entry.kind === kind);
      if (!existing) return;
      this.rebindVideoStreamParticipant(serverId, channelId, existing.trackId, participantId);
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
    hasLocalPublishableVideoTrack(serverId: string, channelId: string): boolean {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return false;
      const cameraTrack = localCameraStreamsByKey.get(key)?.getVideoTracks()[0];
      if (session.cameraEnabled && cameraTrack) return true;
      const screenTrack = localScreenStreamsByKey.get(key)?.getVideoTracks()[0];
      if (session.screenShareEnabled && screenTrack) return true;
      return false;
    },
    hasLocalPublishableTrack(serverId: string, channelId: string): boolean {
      const key = sessionKey(serverId, channelId);
      if (this.hasLocalPublishableVideoTrack(serverId, channelId)) return true;
      const micTrack = localMicStreamsByKey.get(key)?.getAudioTracks()[0];
      return Boolean(micTrack);
    },
    async syncPeerVideoTracks(serverId: string, channelId: string, peerId = RTC_SFU_PUBLISH_PEER_ID): Promise<void> {
      const direction = directionForPeerId(peerId);
      if (direction !== RTC_DIRECTION_PUBLISH) return;
      const key = sessionKey(serverId, channelId);
      const peer = peerConnectionsByKey.get(key)?.get(peerId);
      if (!peer) return;
      const session = this.sessionsByKey[key];
      if (!session || peer.connection.signalingState === "closed") return;

      const desiredTracks: Array<{ label: string; track: MediaStreamTrack; stream: MediaStream }> = [];
      const micStream = localMicStreamsByKey.get(key);
      const micTrack = micStream?.getAudioTracks()[0];
      if (micTrack && micStream) {
        micTrack.enabled = !session.micMuted && !session.deafened;
        desiredTracks.push({
          label: RTC_AUDIO_MICROPHONE_KIND,
          track: micTrack,
          stream: micStream
        });
      }

      const cameraStream = localCameraStreamsByKey.get(key);
      const cameraTrack = cameraStream?.getVideoTracks()[0];
      if (cameraTrack && session.cameraEnabled) {
        desiredTracks.push({
          label: RTC_VIDEO_CAMERA_KIND,
          track: cameraTrack,
          stream: cameraStream
        });
      }

      const screenStream = localScreenStreamsByKey.get(key);
      const screenTrack = screenStream?.getVideoTracks()[0];
      if (screenTrack && session.screenShareEnabled) {
        desiredTracks.push({
          label: RTC_VIDEO_SCREEN_KIND,
          track: screenTrack,
          stream: screenStream
        });
      }

      const pendingTrackIDs = new Set(desiredTracks.map((entry) => entry.track.id));
      peer.connection.getSenders().forEach((sender) => {
        const senderTrack = sender.track;
        if (!senderTrack) return;
        if (senderTrack.kind !== "audio" && senderTrack.kind !== "video") return;
        if (pendingTrackIDs.has(senderTrack.id)) {
          pendingTrackIDs.delete(senderTrack.id);
          return;
        }
        try {
          peer.connection.removeTrack(sender);
          rtcLog("media.sender.remove", {
            serverId,
            channelId,
            direction,
            signalingState: peer.connection.signalingState,
            kind: senderTrack.kind,
            trackId: senderTrack.id
          });
        } catch (_error) {
          // No-op
        }
      });

      desiredTracks.forEach((entry) => {
        if (!pendingTrackIDs.has(entry.track.id)) return;
        peer.connection.addTrack(entry.track, entry.stream);
        rtcLog("media.sender.add", {
          serverId,
          channelId,
          direction,
          signalingState: peer.connection.signalingState,
          kind: entry.track.kind,
          streamKind: entry.label,
          trackId: entry.track.id
        });
      });
    },
    async syncAllPeerVideoTracks(serverId: string, channelId: string): Promise<void> {
      if (!this.hasLocalPublishableTrack(serverId, channelId)) return;
      const publishPeer = this.ensurePeerConnection(serverId, channelId, RTC_SFU_PUBLISH_PEER_ID);
      if (!publishPeer) return;
      await this.syncPeerVideoTracks(serverId, channelId, publishPeer.peerId);
      if (publishPeer.connection.signalingState === "stable") {
        void this.createAndSendOffer(serverId, channelId, publishPeer.peerId, "sync-all-video");
      }
    },
    async createAndSendOffer(serverId: string, channelId: string, peerId: string, reason = "unspecified"): Promise<void> {
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      const peer = peers?.get(peerId);
      if (!peer) return;
      if (peer.direction === RTC_DIRECTION_PUBLISH && !this.hasLocalPublishableTrack(serverId, channelId)) {
        rtcLog("offer.skip.no-publishable-tracks", {
          serverId,
          channelId,
          peerId,
          reason
        });
        return;
      }
      const session = this.sessionsByKey[key];
      if (!session || session.state !== "active") return;
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (peer.connection.signalingState === "closed") return;
      if (peer.direction === RTC_DIRECTION_SUBSCRIBE) {
        subscribeSyncFollowUpReasonByKey.delete(key);
        const followUpTimer = subscribeSyncFollowUpTimerByKey.get(key);
        if (followUpTimer) {
          clearTimeout(followUpTimer);
          subscribeSyncFollowUpTimerByKey.delete(key);
        }
        this.ensureSubscribeRecvonlyTransceivers(serverId, channelId, peer, `offer:${reason}`);
      }
      if (
        shouldDeferOffer({
          makingOffer: peer.makingOffer,
          signalingState: peer.connection.signalingState,
          isSettingRemoteAnswerPending: peer.isSettingRemoteAnswerPending
        })
      ) {
        peer.pendingNegotiation = true;
        peer.pendingNegotiationReason = reason;
        rtcLog("offer.defer", {
          serverId,
          channelId,
          peerId,
          direction: peer.direction,
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
          peerId,
          direction: peer.direction,
          reason,
          signalingState: peer.connection.signalingState
        });
        const createdOffer = await peer.connection.createOffer();
        if (!createdOffer.sdp || createdOffer.sdp.trim().length === 0) {
          rtcLog("offer.skip.empty-created-sdp", {
            serverId,
            channelId,
            peerId,
            direction: peer.direction,
            reason
          });
          return;
        }
        const createdOfferSDP = createdOffer.sdp.trim();
        if (!createdOfferSDP.startsWith("v=0") || !createdOfferSDP.includes("\nm=")) {
          rtcLog("offer.skip.malformed-created-sdp", {
            serverId,
            channelId,
            peerId,
            direction: peer.direction,
            reason,
            prefix: createdOfferSDP.slice(0, 16),
            length: createdOfferSDP.length
          });
          return;
        }
        await peer.connection.setLocalDescription(createdOffer);
        const localDescription = peer.connection.localDescription ?? createdOffer;
        if (localDescription.type !== "offer") {
          rtcLog("offer.skip", {
            serverId,
            channelId,
            peerId,
            direction: peer.direction,
            reason,
            signalingState: peer.connection.signalingState,
            localDescriptionType: localDescription?.type ?? null
          });
          return;
        }
        if (!localDescription.sdp || localDescription.sdp.trim().length === 0) {
          rtcLog("offer.skip.empty-sdp", {
            serverId,
            channelId,
            peerId,
            direction: peer.direction,
            reason
          });
          return;
        }
        const finalOfferSDP = localDescription.sdp.trim();
        if (!finalOfferSDP.startsWith("v=0") || !finalOfferSDP.includes("\nm=")) {
          rtcLog("offer.skip.malformed-sdp", {
            serverId,
            channelId,
            peerId,
            direction: peer.direction,
            reason,
            prefix: finalOfferSDP.slice(0, 16),
            length: finalOfferSDP.length
          });
          return;
        }
        sendSignal(socket, {
          type: offerTypeForDirection(peer.direction),
          request_id: `offer_${Date.now()}_${peer.direction}`,
          channel_id: channelId,
          payload: {
            type: localDescription.type,
            sdp: localDescription.sdp,
            direction: peer.direction
          }
        });
        rtcLog("offer.sent", {
          serverId,
          channelId,
          peerId,
          direction: peer.direction,
          reason,
          signalingState: peer.connection.signalingState
        });
      } catch (error) {
        session.errorMessage = `Offer negotiation failed: ${(error as Error).message}`;
        rtcLog("offer.error", {
          serverId,
          channelId,
          peerId,
          direction: peer.direction,
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
          void Promise.resolve().then(() => this.createAndSendOffer(serverId, channelId, peerId, `flush:${pendingReason}`));
        }
      }
    },
    async flushPendingRemoteICECandidates(serverId: string, channelId: string, peer: PeerConnectionEntry): Promise<void> {
      if (peer.pendingRemoteCandidates.length === 0) return;
      const pending = [...peer.pendingRemoteCandidates];
      peer.pendingRemoteCandidates = [];
      for (const candidate of pending) {
        try {
          await peer.connection.addIceCandidate(candidate);
          rtcLog("ice.remote.flush", {
            serverId,
            channelId,
            peerId: peer.peerId,
            direction: peer.direction,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null
          });
        } catch (error) {
          rtcLog("ice.remote.flush.error", {
            serverId,
            channelId,
            peerId: peer.peerId,
            direction: peer.direction,
            message: (error as Error).message
          });
        }
      }
    },
    ensurePeerConnection(serverId: string, channelId: string, peerId: string): PeerConnectionEntry | null {
      const direction = directionForPeerId(peerId);
      if (!direction) return null;
      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return null;

      const peers = this.peerConnectionsForSession(key);
      const existing = peers.get(peerId);
      if (existing) return existing;

      const connection = new RTCPeerConnection({
        iceServers: iceServersByKey.get(key) ?? []
      });
      const entry: PeerConnectionEntry = {
        connection,
        peerId,
        channelId,
        direction,
        makingOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingNegotiation: false,
        pendingNegotiationReason: null,
        pendingRemoteCandidates: []
      };
      peers.set(peerId, entry);
      rtcLog("peer.create", {
        serverId,
        channelId,
        peerId,
        direction
      });

      if (direction === RTC_DIRECTION_SUBSCRIBE) {
        this.ensureSubscribeRecvonlyTransceivers(serverId, channelId, entry, "peer-create");
      }

      connection.onicecandidate = (event) => {
        if (!event.candidate) return;
        const socket = socketsByKey.get(key);
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const candidate = event.candidate.toJSON();
        const payload: Record<string, unknown> = {
          candidate: candidate.candidate,
          direction
        };
        if (candidate.sdpMid != null) {
          payload.sdp_mid = candidate.sdpMid;
        }
        if (candidate.sdpMLineIndex != null) {
          payload.sdp_mline_index = candidate.sdpMLineIndex;
        }
        sendSignal(socket, {
          type: "rtc.ice.candidate",
          request_id: `ice_${Date.now()}_${direction}`,
          channel_id: channelId,
          payload
        });
      };

      connection.onnegotiationneeded = () => {
        rtcLog("negotiation.needed", {
          serverId,
          channelId,
          peerId,
          direction,
          signalingState: connection.signalingState
        });
        void this.createAndSendOffer(serverId, channelId, peerId, "onnegotiationneeded");
      };

      connection.ontrack = (event) => {
        if (direction !== RTC_DIRECTION_SUBSCRIBE) return;
        const mediaStream = event.streams[0] ?? new MediaStream([event.track]);
        const observedTrackId = event.track.id;
        const observedMediaKind =
          event.track.kind === "audio" ? RTC_MEDIA_KIND_AUDIO : RTC_MEDIA_KIND_VIDEO;
        const metaMap = this.remoteTrackMetaForSession(key);
        const metaResolution = resolveRemoteMetaForObservedTrack({
          metas: uniqueRemoteTrackMetas(metaMap),
          observedTrackId,
          observedStreamId: mediaStream.id,
          observedMediaKind
        });
        const meta = metaResolution?.meta ?? null;
        if (!meta) {
          const pendingMap = this.pendingRemoteTracksForSession(key);
          pendingMap.set(observedTrackId, {
            connection,
            mediaStream,
            track: event.track,
            observedTrackId,
            observedStreamId: mediaStream.id,
            mediaKind: observedMediaKind
          });
          this.requestSubscribeSync(serverId, channelId, "track-meta-missing", 1_000);
          rtcLog("track.meta.unresolved", {
            serverId,
            channelId,
            peerId,
            direction,
            observedTrackId,
            observedStreamId: mediaStream.id,
            observedMediaKind: event.track.kind,
            label: event.track.label
          });
          event.track.onended = () => {
            const pendingEntry = pendingMap.get(observedTrackId);
            if (pendingEntry?.track === event.track) {
              pendingMap.delete(observedTrackId);
            }
          };
          return;
        }
        if (metaResolution?.strategy === "stream") {
          rtcLog("track.meta.resolve.by_stream", {
            serverId,
            channelId,
            peerId,
            direction,
            participantId: meta.participantId,
            mediaKind: meta.mediaKind,
            signaledTrackId: meta.trackId,
            signaledStreamId: meta.streamId || null,
            observedTrackId,
            observedStreamId: mediaStream.id
          });
        }
        if (observedTrackId && observedTrackId !== meta.trackId) {
          metaMap.set(observedTrackId, meta);
        }

        if (meta.mediaKind === RTC_MEDIA_KIND_AUDIO || event.track.kind === "audio") {
          this.handleRemoteAudioTrack({
            serverId,
            channelId,
            participantId: meta.participantId,
            streamId: meta.streamId || mediaStream.id,
            trackId: observedTrackId,
            mediaStream,
            track: event.track
          });
          return;
        }
        this.handleRemoteVideoTrack({
          serverId,
          channelId,
          participantId: meta.participantId,
          signalStreamID: meta.streamId || mediaStream.id,
          connection,
          mediaStream,
          track: event.track
        });
      };

      connection.onsignalingstatechange = () => {
        rtcLog("signaling.state", {
          serverId,
          channelId,
          peerId,
          direction,
          signalingState: connection.signalingState,
          pendingNegotiation: entry.pendingNegotiation
        });
        if (connection.signalingState !== "stable" || !entry.pendingNegotiation) return;
        const pendingReason = entry.pendingNegotiationReason ?? "signaling-stable";
        if (pendingReason.includes("onnegotiationneeded")) {
          entry.pendingNegotiation = false;
          entry.pendingNegotiationReason = null;
          rtcLog("offer.skip.pending.onnegotiationneeded", {
            serverId,
            channelId,
            peerId,
            direction,
            reason: pendingReason,
            signalingState: connection.signalingState
          });
          return;
        }
        entry.pendingNegotiation = false;
        entry.pendingNegotiationReason = null;
        void this.createAndSendOffer(serverId, channelId, peerId, `stable:${pendingReason}`);
      };

      connection.oniceconnectionstatechange = () => {
        rtcLog("ice.state", {
          serverId,
          channelId,
          peerId,
          direction,
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
          peerId,
          direction,
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
          peerId,
          direction,
          connectionState: connection.connectionState
        });
        if (connection.connectionState !== "failed" && connection.connectionState !== "closed") return;
        if (direction === RTC_DIRECTION_SUBSCRIBE) {
          const localSession = this.sessionsByKey[key];
          if (localSession) {
            localSession.videoStreams = localSession.videoStreams.filter((entry) => entry.isLocal);
          }
          this.clearRemoteAudioForSession(serverId, channelId);
        }
      };

      if (direction === RTC_DIRECTION_PUBLISH) {
        void this.syncPeerVideoTracks(serverId, channelId, peerId);
      }
      return entry;
    },
    closePeerConnection(serverId: string, channelId: string, peerId: string): void {
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      const peer = peers?.get(peerId);
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
      peers?.delete(peerId);
      if (peers && peers.size === 0) {
        peerConnectionsByKey.delete(key);
      }
    },
    closePeerConnectionsForSession(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      if (peers) {
        for (const peerId of peers.keys()) {
          this.closePeerConnection(serverId, channelId, peerId);
        }
      }
      peerConnectionsByKey.delete(key);
      iceServersByKey.delete(key);
      videoHintByKey.delete(key);
      videoTrackOwnerByKey.delete(key);
      videoStreamOwnerByKey.delete(key);
      videoStreamKindByKey.delete(key);
      remoteTrackMetaByKey.delete(key);
      pendingRemoteTracksByKey.delete(key);
      subscribeSyncCooldownByKey.delete(key);
      subscribeSyncFollowUpReasonByKey.delete(key);
      const followUpTimer = subscribeSyncFollowUpTimerByKey.get(key);
      if (followUpTimer) {
        clearTimeout(followUpTimer);
        subscribeSyncFollowUpTimerByKey.delete(key);
      }
      subscribePeerResetCooldownByKey.delete(key);
      subscribeReceivePolicyByKey.delete(key);
      this.stopRemoteVideoStatsProbesForSession(serverId, channelId);
      this.clearRemoteAudioForSession(serverId, channelId);
    },
    connectParticipantMesh(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session || !session.localParticipantId || session.state !== "active") return;
      const subscribePeer = this.ensurePeerConnection(serverId, channelId, RTC_SFU_SUBSCRIBE_PEER_ID);
      if (subscribePeer) {
        void this.createAndSendOffer(serverId, channelId, subscribePeer.peerId, "sync-subscribe");
      }
      if (this.hasLocalPublishableTrack(serverId, channelId)) {
        const publishPeer = this.ensurePeerConnection(serverId, channelId, RTC_SFU_PUBLISH_PEER_ID);
        if (publishPeer) {
          void this.createAndSendOffer(serverId, channelId, publishPeer.peerId, "sync-publish");
        }
      }
    },
    handleRemoteAudioTrack(params: {
      serverId: string;
      channelId: string;
      participantId: string;
      streamId: string;
      trackId: string;
      mediaStream: MediaStream;
      track: MediaStreamTrack;
    }): void {
      const key = sessionKey(params.serverId, params.channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const remoteEntries = audioEntriesForSession(key);
      const entryKey = `${params.participantId}:${params.trackId}`;
      const existing = remoteEntries.get(entryKey);
      if (existing) {
        existing.mediaStream = params.mediaStream;
        if (existing.audioElement.srcObject !== params.mediaStream) {
          existing.audioElement.srcObject = params.mediaStream;
        }
        applyAudioElementPlayback(existing.audioElement);
      } else {
        const audioElement = new Audio();
        audioElement.autoplay = true;
        audioElement.preload = "auto";
        audioElement.srcObject = params.mediaStream;
        applyAudioElementPlayback(audioElement);
        remoteEntries.set(entryKey, {
          entryKey,
          participantId: params.participantId,
          trackId: params.trackId,
          streamId: params.streamId,
          mediaStream: params.mediaStream,
          audioElement
        });
      }
      if (this.selectedOutputDeviceId) {
        void setPlaybackSinkDevice(this.selectedOutputDeviceId).catch(() => {});
      }

      startAudioActivityProbe({
        probeMap: remoteAudioProbeByKey,
        probeKey: `${key}:${params.trackId}`,
        mediaStream: params.mediaStream,
        onSpeaking: () => {
          this.markParticipantSpeaking(params.serverId, params.channelId, params.participantId);
        }
      });

      params.track.onended = () => {
        this.removeRemoteAudioTrack(params.serverId, params.channelId, params.participantId, params.trackId);
      };
    },
    removeRemoteAudioTrack(serverId: string, channelId: string, participantId: string, trackId: string): void {
      const key = sessionKey(serverId, channelId);
      const entries = remoteAudioEntriesByKey.get(key);
      if (!entries) return;
      const entryKey = `${participantId}:${trackId}`;
      const entry = entries.get(entryKey);
      if (!entry) return;
      entry.audioElement.srcObject = null;
      entries.delete(entryKey);
      if (entries.size === 0) {
        remoteAudioEntriesByKey.delete(key);
      }
      stopAudioProbe(remoteAudioProbeByKey, `${key}:${trackId}`);
    },
    removeRemoteAudioByStreamID(serverId: string, channelId: string, participantId: string, streamId: string): void {
      if (!streamId) return;
      const key = sessionKey(serverId, channelId);
      const entries = remoteAudioEntriesByKey.get(key);
      if (!entries) return;
      for (const [entryKey, entry] of entries.entries()) {
        if (entry.participantId !== participantId || entry.streamId !== streamId) continue;
        entry.audioElement.srcObject = null;
        entries.delete(entryKey);
        stopAudioProbe(remoteAudioProbeByKey, `${key}:${entry.trackId}`);
      }
      if (entries.size === 0) {
        remoteAudioEntriesByKey.delete(key);
      }
    },
    clearRemoteAudioForSession(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const entries = remoteAudioEntriesByKey.get(key);
      if (entries) {
        for (const entry of entries.values()) {
          entry.audioElement.srcObject = null;
          stopAudioProbe(remoteAudioProbeByKey, `${key}:${entry.trackId}`);
        }
      }
      remoteAudioEntriesByKey.delete(key);
    },
    handleRemoteVideoTrack(params: {
      serverId: string;
      channelId: string;
      participantId: string;
      signalStreamID: string;
      connection: RTCPeerConnection;
      mediaStream: MediaStream;
      track: MediaStreamTrack;
    }): void {
      const key = this.ensureSession(params.serverId, params.channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const participant = session.participants.find((item) => item.participantId === params.participantId);
      const hintMap = this.videoHintsForSession(key);
      const hint = hintMap.get(videoHintKey(params.participantId, params.track.id));
      const streamHint = this.resolveVideoKindForSignalStream(params.serverId, params.channelId, params.signalStreamID);
      const kind = hint ?? streamHint ?? inferVideoKindFromTrackLabel(params.track.label);
      this.updateVideoHint(
        params.serverId,
        params.channelId,
        params.participantId,
        params.track.id,
        kind,
        params.signalStreamID || params.mediaStream.id || undefined
      );
      rtcLog("video.track.apply", {
        serverId: params.serverId,
        channelId: params.channelId,
        participantId: params.participantId,
        signalStreamID: params.signalStreamID,
        streamId: params.mediaStream.id,
        trackId: params.track.id,
        inferredKind: kind,
        hintKind: hint ?? null,
        hintSource: hint ? "track" : streamHint ? "stream" : "track_label",
        trackLabel: params.track.label,
        muted: params.track.muted,
        readyState: params.track.readyState
      });

      const staleTrackBindings = session.videoStreams.filter(
        (entry) => entry.trackId === params.track.id && entry.participantId !== params.participantId
      );
      for (const stale of staleTrackBindings) {
        rtcLog("video.track.rebind.same-track-id", {
          serverId: params.serverId,
          channelId: params.channelId,
          trackId: params.track.id,
          fromParticipantId: stale.participantId,
          toParticipantId: params.participantId,
          fromSignalStreamID: stale.mediaStream.id,
          toSignalStreamID: params.signalStreamID || params.mediaStream.id
        });
        this.removeVideoStream(params.serverId, params.channelId, stale.streamKey, { stopProbe: false });
        this.deleteVideoHint(params.serverId, params.channelId, stale.participantId, stale.trackId);
      }

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
      this.startRemoteVideoStatsProbe({
        serverId: params.serverId,
        channelId: params.channelId,
        participantId: params.participantId,
        signalStreamID: params.signalStreamID,
        kind,
        connection: params.connection,
        track: params.track
      });

      params.track.onended = () => {
        rtcLog("video.track.ended", {
          serverId: params.serverId,
          channelId: params.channelId,
          participantId: params.participantId,
          trackId: params.track.id,
          kind
        });
        this.stopRemoteVideoStatsProbe(params.serverId, params.channelId, params.track.id);
        this.removeVideoStream(params.serverId, params.channelId, `${params.participantId}:${params.track.id}`);
        this.deleteVideoHint(params.serverId, params.channelId, params.participantId, params.track.id);
      };
    },
    async handleOfferSignal(
      serverId: string,
      channelId: string,
      signalType: "rtc.offer.publish" | "rtc.offer.subscribe",
      payload: Record<string, unknown>
    ): Promise<void> {
      const directionFromSignal = signalType === "rtc.offer.subscribe" ? RTC_DIRECTION_SUBSCRIBE : RTC_DIRECTION_PUBLISH;
      const direction = toSignalDirection(payload.direction) ?? directionFromSignal;
      const sdp = String(payload.sdp ?? "");
      const descriptionType = toDescriptionType(payload.type ?? payload.description_type ?? "offer");
      if (!sdp || descriptionType !== "offer") return;

      const key = this.ensureSession(serverId, channelId);
      const session = this.sessionsByKey[key];
      if (!session) return;
      const peerId = peerIdForDirection(direction);
      const peer = this.ensurePeerConnection(serverId, channelId, peerId);
      if (!peer) return;
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      try {
        if (peer.connection.signalingState !== "stable") {
          await peer.connection.setLocalDescription({ type: "rollback" });
        }
        await peer.connection.setRemoteDescription({ type: "offer", sdp });
        await this.flushPendingRemoteICECandidates(serverId, channelId, peer);
        if (direction === RTC_DIRECTION_PUBLISH) {
          await this.syncPeerVideoTracks(serverId, channelId, peerId);
        }
        await peer.connection.setLocalDescription();
        const localDescription = peer.connection.localDescription;
        if (!localDescription || localDescription.type !== "answer") return;

        sendSignal(socket, {
          type: answerTypeForDirection(direction),
          request_id: `answer_${Date.now()}_${direction}`,
          channel_id: channelId,
          payload: {
            type: localDescription.type,
            sdp: localDescription.sdp,
            direction
          }
        });
        rtcLog("offer.applied", {
          serverId,
          channelId,
          peerId,
          direction,
          signalingState: peer.connection.signalingState
        });
      } catch (error) {
        session.errorMessage = `Offer handling failed: ${(error as Error).message}`;
        rtcLog("offer.error", {
          serverId,
          channelId,
          peerId,
          direction,
          signalingState: peer.connection.signalingState,
          message: (error as Error).message
        });
      }
    },
    async handleAnswerSignal(
      serverId: string,
      channelId: string,
      signalType: "rtc.answer.publish" | "rtc.answer.subscribe",
      payload: Record<string, unknown>
    ): Promise<void> {
      const directionFromSignal = signalType === "rtc.answer.subscribe" ? RTC_DIRECTION_SUBSCRIBE : RTC_DIRECTION_PUBLISH;
      const direction = toSignalDirection(payload.direction) ?? directionFromSignal;
      const sdp = String(payload.sdp ?? "");
      const descriptionType = toDescriptionType(payload.type ?? payload.description_type ?? "answer");
      if (!sdp || descriptionType !== "answer") return;

      const key = sessionKey(serverId, channelId);
      const peer = peerConnectionsByKey.get(key)?.get(peerIdForDirection(direction));
      if (!peer) return;
      const session = this.sessionsByKey[key];
      if (!session) return;
      rtcLog("answer.received", {
        serverId,
        channelId,
        peerId: peer.peerId,
        direction,
        signalingState: peer.connection.signalingState
      });
      peer.isSettingRemoteAnswerPending = true;
      try {
        await peer.connection.setRemoteDescription({
          type: "answer",
          sdp
        });
        await this.flushPendingRemoteICECandidates(serverId, channelId, peer);
        rtcLog("answer.applied", {
          serverId,
          channelId,
          peerId: peer.peerId,
          direction,
          signalingState: peer.connection.signalingState
        });
      } catch (error) {
        session.errorMessage = `Answer handling failed: ${(error as Error).message}`;
        rtcLog("answer.error", {
          serverId,
          channelId,
          peerId: peer.peerId,
          direction,
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
          void this.createAndSendOffer(serverId, channelId, peer.peerId, `answer:${pendingReason}`);
        }
      }
    },
    async handleIceCandidateSignal(serverId: string, channelId: string, payload: Record<string, unknown>): Promise<void> {
      const candidatePayload = payload.candidate;
      let candidate: RTCIceCandidateInit | null = null;
      if (typeof candidatePayload === "string" && candidatePayload.trim()) {
        candidate = {
          candidate: candidatePayload,
          sdpMid: payload.sdp_mid != null ? String(payload.sdp_mid) : undefined,
          sdpMLineIndex:
            payload.sdp_mline_index != null && Number.isFinite(Number(payload.sdp_mline_index))
              ? Number(payload.sdp_mline_index)
              : undefined
        };
      } else if (candidatePayload && typeof candidatePayload === "object") {
        candidate = candidatePayload as RTCIceCandidateInit;
      }
      if (!candidate) return;
      const addToPeer = async (
        peer: PeerConnectionEntry,
        direction: PeerSignalDirection,
        sourceDirection: PeerSignalDirection | null
      ): Promise<boolean> => {
        if (!peer.connection.remoteDescription) {
          peer.pendingRemoteCandidates.push(candidate as RTCIceCandidateInit);
          rtcLog("ice.remote.queue", {
            serverId,
            channelId,
            peerId: peer.peerId,
            direction,
            sourceDirection: sourceDirection ?? "missing",
            queueSize: peer.pendingRemoteCandidates.length
          });
          return true;
        }

        try {
          await peer.connection.addIceCandidate(candidate);
          rtcLog("ice.remote.add", {
            serverId,
            channelId,
            peerId: peer.peerId,
            direction,
            sourceDirection: sourceDirection ?? "missing",
            signalingState: peer.connection.signalingState,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null
          });
          return true;
        } catch (error) {
          rtcLog("ice.remote.error", {
            serverId,
            channelId,
            peerId: peer.peerId,
            direction,
            sourceDirection: sourceDirection ?? "missing",
            signalingState: peer.connection.signalingState,
            message: (error as Error).message
          });
          return false;
        }
      };

      const sourceDirection = toSignalDirection(payload.direction);
      if (sourceDirection) {
        const peer = this.ensurePeerConnection(serverId, channelId, peerIdForDirection(sourceDirection));
        if (!peer) return;
        await addToPeer(peer, sourceDirection, sourceDirection);
        return;
      }

      // If direction is absent, attempt both existing peers so we don't starve
      // the subscribe PC due misrouted ICE metadata.
      const key = sessionKey(serverId, channelId);
      const peers = peerConnectionsByKey.get(key);
      if (!peers || peers.size === 0) return;
      rtcLog("ice.remote.direction.missing", {
        serverId,
        channelId,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null
      });
      const subscribePeer = peers.get(RTC_SFU_SUBSCRIBE_PEER_ID);
      const publishPeer = peers.get(RTC_SFU_PUBLISH_PEER_ID);
      if (subscribePeer) {
        await addToPeer(subscribePeer, RTC_DIRECTION_SUBSCRIBE, null);
      }
      if (publishPeer) {
        await addToPeer(publishPeer, RTC_DIRECTION_PUBLISH, null);
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
          rtcLog("video.local.track.ended", {
            serverId,
            channelId,
            kind: "camera",
            trackId: track.id,
            streamId: mediaStream.id,
            readyState: track.readyState
          });
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
          rtcLog("video.local.track.ended", {
            serverId,
            channelId,
            kind: "screen",
            trackId: track.id,
            streamId: mediaStream.id,
            readyState: track.readyState
          });
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
        const baseAudioConstraints = buildMicrophoneConstraints(this.selectedInputDeviceId, DEFAULT_OUTPUT_DEVICE_ID);
        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: baseAudioConstraints
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
        const activeSession = this.sessionsByKey[key];
        const activeSocket = socketsByKey.get(key);
        if (!activeSession || activeSession.state !== "active" || !activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
          mediaStream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }

        const track = mediaStream.getAudioTracks()[0];
        if (!track) {
          throw new Error("No microphone track available.");
        }
        track.enabled = !activeSession.micMuted && !activeSession.deafened;

        const uplink: MicUplink = {
          channelId,
          streamId: `mic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          mediaStream,
          track
        };
        micUplinksByKey.set(key, uplink);
        localMicStreamsByKey.set(key, mediaStream);
        session.errorMessage = null;

        startAudioActivityProbe({
          probeMap: localMicProbeByKey,
          probeKey: key,
          mediaStream,
          onSpeaking: () => {
            const localSession = this.sessionsByKey[key];
            if (!localSession || localSession.micMuted || localSession.deafened) return;
            const localParticipantId = localSession.localParticipantId;
            if (!localParticipantId) return;
            this.markParticipantSpeaking(serverId, channelId, localParticipantId);
          }
        });

        sendSignal(activeSocket, {
          type: "rtc.media.state",
          request_id: `mic_start_${Date.now()}`,
          channel_id: channelId,
          payload: {
            stream_id: mediaStream.id,
            track_id: track.id,
            stream_kind: RTC_AUDIO_MICROPHONE_KIND,
            action: "start",
            mic_muted: activeSession.micMuted,
            deafened: activeSession.deafened
          }
        });
        await this.syncAllPeerVideoTracks(serverId, channelId);
      } catch (error) {
        session.errorMessage = `Microphone unavailable: ${(error as Error).message}`;
      }
    },
    stopMicUplink(serverId: string, channelId: string): void {
      const key = sessionKey(serverId, channelId);
      const uplink = micUplinksByKey.get(key);
      if (!uplink) return;
      const socket = socketsByKey.get(key);
      if (socket && socket.readyState === WebSocket.OPEN) {
        sendSignal(socket, {
          type: "rtc.media.state",
          request_id: `mic_stop_${Date.now()}`,
          channel_id: channelId,
          payload: {
            stream_id: uplink.mediaStream.id,
            track_id: uplink.track.id,
            stream_kind: RTC_AUDIO_MICROPHONE_KIND,
            action: "stop"
          }
        });
      }
      stopAudioProbe(localMicProbeByKey, key);
      uplink.mediaStream.getTracks().forEach((track) => {
        track.stop();
      });
      micUplinksByKey.delete(key);
      localMicStreamsByKey.delete(key);
      void this.syncAllPeerVideoTracks(serverId, channelId);
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
      session.state = transitionCallState(session.state, "join_requested");
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
      joinContextByKey.set(key, {
        backendUrl: params.backendUrl,
        userUID: params.userUID,
        deviceID: params.deviceID
      });
      const pendingReconnect = reconnectTimerByKey.get(key);
      if (pendingReconnect) {
        clearTimeout(pendingReconnect);
        reconnectTimerByKey.delete(key);
      }
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
        const defaultSubscribeReceivePolicy = resolveSubscribeReceivePolicy({
          capabilitiesPolicy: capabilities.rtc.subscribeReceivePolicy
        });
        subscribeReceivePolicyByServer.set(params.serverId, defaultSubscribeReceivePolicy);
        const joinTicket = await requestJoinTicket({
          backendUrl: params.backendUrl,
          channelId: params.channelId,
          userUID: params.userUID,
          deviceID: params.deviceID,
          serverID: params.serverId
        });
        const effectiveSubscribeReceivePolicy = resolveSubscribeReceivePolicy({
          capabilitiesPolicy: defaultSubscribeReceivePolicy,
          joinTicketPolicy: joinTicket.subscribe_receive_policy
        });
        subscribeReceivePolicyByKey.set(key, effectiveSubscribeReceivePolicy);
        iceServersByKey.set(key, toRTCIceServers(joinTicket.ice_servers));
        session.canSendVideo = Boolean(joinTicket.permissions.video);
        session.canShareScreen = Boolean(joinTicket.permissions.screenshare);

        intentionallyClosed.delete(key);
        const socket = new WebSocket(joinTicket.signaling_url);
        socketsByKey.set(key, socket);
        this.activeVoiceChannelByServer[params.serverId] = params.channelId;

        socket.addEventListener("open", () => {
          reconnectAttemptByKey.delete(key);
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

        socket.addEventListener("close", (event: CloseEvent) => {
          rtcLog("signaling.socket.close", {
            serverId: params.serverId,
            channelId: params.channelId,
            code: event.code,
            reason: event.reason || null,
            wasClean: event.wasClean
          });
          const activeSocket = socketsByKey.get(key);
          if (activeSocket === socket) {
            socketsByKey.delete(key);
          }
          this.stopMicUplink(params.serverId, params.channelId);
          const localSession = this.sessionsByKey[key];
          if (!localSession) return;
          localSession.lastEventAt = new Date().toISOString();
          if (intentionallyClosed.has(key)) {
            intentionallyClosed.delete(key);
            this.clearReconnectState(params.serverId, params.channelId);
            localSession.state = transitionCallState(localSession.state, "left");
            localSession.participants = [];
            localSession.localParticipantId = null;
            localSession.videoStreams = [];
            localSession.cameraEnabled = false;
            localSession.screenShareEnabled = false;
            this.clearSpeakingForSession(params.serverId, params.channelId);
            localSession.errorMessage = null;
            return;
          }
          this.scheduleSignalingReconnect(params.serverId, params.channelId, `close:${event.code}`);
        });

        socket.addEventListener("error", () => {
          rtcLog("signaling.socket.error", {
            serverId: params.serverId,
            channelId: params.channelId
          });
          this.stopMicUplink(params.serverId, params.channelId);
          const localSession = this.sessionsByKey[key];
          if (!localSession) return;
          localSession.lastEventAt = new Date().toISOString();
          this.scheduleSignalingReconnect(params.serverId, params.channelId, "socket-error");
        });
      } catch (error) {
        session.state = transitionCallState(session.state, "join_failed");
        session.errorMessage = (error as Error).message;
        session.videoStreams = [];
        session.cameraEnabled = false;
        session.screenShareEnabled = false;
        this.stopAllLocalVideo(params.serverId, params.channelId, { notify: false });
        this.closePeerConnectionsForSession(params.serverId, params.channelId);
        const shouldReconnect =
          !intentionallyClosed.has(key) && this.activeVoiceChannelByServer[params.serverId] === params.channelId;
        if (shouldReconnect) {
          this.scheduleSignalingReconnect(params.serverId, params.channelId, "join-failed");
          return;
        }
        this.activeVoiceChannelByServer[params.serverId] = null;
        this.clearReconnectState(params.serverId, params.channelId);
        localJoinIdentityByKey.delete(key);
        joinContextByKey.delete(key);
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
          const participantSignature = [...participants]
            .map((item) => item.participantId)
            .sort()
            .join("|");
          const existingParticipantSignature = [...session.participants]
            .map((item) => item.participantId)
            .sort()
            .join("|");
          const duplicateJoinedEvent =
            session.state === "active" &&
            (session.localParticipantId ?? "") === (localParticipantID || "") &&
            participantSignature === existingParticipantSignature;
          if (duplicateJoinedEvent) {
            session.participants = participants;
            session.localParticipantId = localParticipantID || null;
            setPlaybackMuted(session.deafened);
            rtcLog("joined.duplicate", {
              serverId: params.serverId,
              channelId: params.channelId,
              localParticipantId: localParticipantID || null,
              participants: participants.length
            });
            return;
          }
          session.state = transitionCallState(session.state, "join_succeeded");
          session.participants = participants;
          session.localParticipantId = localParticipantID || null;
          session.activeSpeakerParticipantIds = [];
          session.videoStreams = session.videoStreams.filter((entry) => entry.isLocal);
          this.clearRemoteAudioForSession(params.serverId, params.channelId);
          remoteTrackMetaByKey.delete(key);
          pendingRemoteTracksByKey.delete(key);
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
          const alreadyPresent = session.participants.some((item) => item.participantId === participant.participantId);
          if (!alreadyPresent) {
            session.participants.push(participant);
            this.connectParticipantMesh(params.serverId, params.channelId);
          }
          return;
        }
        case "rtc.participant.left": {
          const participantPayload = payload.participant as Record<string, unknown> | undefined;
          if (!participantPayload) return;
          const leavingParticipantID = String(participantPayload.participant_id ?? "");
          const hadParticipant = session.participants.some((item) => item.participantId === leavingParticipantID);
          if (!hadParticipant) return;
          session.participants = session.participants.filter((item) => item.participantId !== leavingParticipantID);
          this.removeVideoStreamsForParticipant(params.serverId, params.channelId, leavingParticipantID);
          this.removeRemoteTrackMetaByParticipant(params.serverId, params.channelId, leavingParticipantID);
          this.clearParticipantSpeaking(params.serverId, params.channelId, leavingParticipantID);
          this.deleteVideoHintsForParticipant(params.serverId, params.channelId, leavingParticipantID);
          this.connectParticipantMesh(params.serverId, params.channelId);
          return;
        }
        case "rtc.subscribe.refresh": {
          rtcLog("subscribe.refresh.received", {
            serverId: params.serverId,
            channelId: params.channelId,
            reason: String(payload.reason ?? "unspecified")
          });
          this.requestSubscribeSync(params.serverId, params.channelId, "subscribe-refresh", 800);
          return;
        }
        case "rtc.track.published": {
          const parsed = parseRemoteTrackLifecyclePayload(payload);
          if (!parsed) return;
          const mediaKind = toRemoteTrackMediaKind(parsed.mediaKind);
          if (!mediaKind) return;
          const participantID = parsed.participantId;
          if (session.localParticipantId && participantID === session.localParticipantId) {
            return;
          }
          const streamKind = parsed.streamKind || (mediaKind === RTC_MEDIA_KIND_AUDIO ? RTC_AUDIO_MICROPHONE_KIND : RTC_VIDEO_CAMERA_KIND);
          const participant = session.participants.find((item) => item.participantId === participantID);
          this.upsertRemoteTrackMeta(params.serverId, params.channelId, {
            participantId: participantID,
            userUID: participant?.userUID ?? parsed.userUID,
            deviceID: participant?.deviceID ?? parsed.deviceID,
            trackId: parsed.trackId,
            streamId: parsed.streamId,
            mediaKind,
            streamKind
          });
          this.requestSubscribeSync(params.serverId, params.channelId, "track-published", 800);
          return;
        }
        case "rtc.track.unpublished": {
          const parsed = parseRemoteTrackLifecyclePayload(payload);
          if (!parsed) return;
          this.removeRemoteTrackMeta({
            serverId: params.serverId,
            channelId: params.channelId,
            trackId: parsed.trackId,
            streamId: parsed.streamId,
            mediaKind: parsed.mediaKind
          });
          return;
        }
        case "rtc.error": {
          const code = String(payload.code ?? "").trim().toLowerCase();
          const message = String(payload.message ?? "Signaling error");
          const retryable = Boolean(payload.retryable);
          const isClosedPeerNegotiationError =
            code === "rtc_negotiation_failed" && message.toLowerCase().includes("connection closed");
          if (retryable && isClosedPeerNegotiationError && session.state === "active") {
            rtcLog("rtc.error.transient", {
              serverId: params.serverId,
              channelId: params.channelId,
              code,
              message
            });
            this.requestSubscribeSync(params.serverId, params.channelId, "rtc-error-closed-peer", 2_000);
            return;
          }
          session.state = transitionCallState(session.state, "fatal_error");
          session.errorMessage = message;
          return;
        }
        case "rtc.media.state": {
          const streamKind = String(payload.stream_kind ?? "");
          const participantID = String(payload.participant_id ?? "");
          if (!participantID) return;
          if (!streamKind.trim()) {
            // Ignore presence-only rtc.media.state packets for video mapping.
            return;
          }

          const streamKindVideo = toVideoKindFromSignal(streamKind);
          if (streamKindVideo) {
            if (session.localParticipantId && participantID === session.localParticipantId) {
              return;
            }

            const action = String(payload.action ?? "start").trim().toLowerCase();
            const trackID = String(payload.track_id ?? "");
            const signalStreamID = String(payload.stream_id ?? "");
            if (action === "stop") {
              if (trackID) {
                this.removeVideoStream(params.serverId, params.channelId, `${participantID}:${trackID}`);
                this.removeVideoStream(params.serverId, params.channelId, `participant_unknown:${trackID}`);
                this.deleteVideoHint(params.serverId, params.channelId, participantID, trackID);
              } else if (signalStreamID) {
                this.removeVideoStreamsBySignalStreamID(params.serverId, params.channelId, signalStreamID);
              } else {
                this.removeVideoStreamsForParticipant(params.serverId, params.channelId, participantID, streamKindVideo);
              }
              return;
            }

            if (action === "start") {
              const staleEntries = session.videoStreams.filter((entry) => {
                if (entry.participantId !== participantID || entry.kind !== streamKindVideo) return false;
                if (trackID && entry.trackId !== trackID) return true;
                if (signalStreamID && entry.mediaStream.id !== signalStreamID) return true;
                return false;
              });
              for (const stale of staleEntries) {
                rtcLog("video.stream.stale.remove", {
                  serverId: params.serverId,
                  channelId: params.channelId,
                  participantId: participantID,
                  kind: streamKindVideo,
                  staleTrackId: stale.trackId,
                  staleSignalStreamID: stale.mediaStream.id,
                  nextTrackId: trackID || null,
                  nextSignalStreamID: signalStreamID || null
                });
                this.removeVideoStream(params.serverId, params.channelId, stale.streamKey);
                this.deleteVideoHint(params.serverId, params.channelId, participantID, stale.trackId);
              }
              const hasExactTrackBinding =
                !!trackID &&
                session.videoStreams.some(
                  (entry) => entry.participantId === participantID && entry.trackId === trackID
                );
              const hasExactStreamBinding =
                !!signalStreamID &&
                session.videoStreams.some(
                  (entry) => entry.participantId === participantID && entry.mediaStream.id === signalStreamID
                );
              const shouldSyncSubscribe = !(hasExactTrackBinding || hasExactStreamBinding);
              rtcLog("subscribe.sync.requested", {
                serverId: params.serverId,
                channelId: params.channelId,
                participantId: participantID,
                trackId: trackID || null,
                signalStreamID: signalStreamID || null,
                streamKind: streamKindVideo,
                shouldSyncSubscribe
              });
              if (shouldSyncSubscribe) {
                this.requestSubscribeSync(params.serverId, params.channelId, "media-state-start", 3_500);
              }
            }

            if (trackID || signalStreamID) {
              this.updateVideoHint(
                params.serverId,
                params.channelId,
                participantID,
                trackID,
                streamKindVideo,
                signalStreamID || undefined
              );
              this.reclassifyBoundVideoStreamKind(
                params.serverId,
                params.channelId,
                participantID,
                trackID,
                signalStreamID
              );
              if (signalStreamID) {
                this.rebindVideoStreamsBySignalStreamID(params.serverId, params.channelId, signalStreamID, participantID);
              }
            }
            if (trackID) {
              this.rebindVideoStreamParticipant(params.serverId, params.channelId, trackID, participantID);
            } else {
              this.rebindUnknownVideoStreamByKind(params.serverId, params.channelId, participantID, streamKindVideo);
            }
            return;
          }

          return;
        }
        case "rtc.offer.publish":
        case "rtc.offer.subscribe": {
          void this.handleOfferSignal(
            params.serverId,
            params.channelId,
            params.envelope.type as "rtc.offer.publish" | "rtc.offer.subscribe",
            payload
          );
          return;
        }
        case "rtc.answer.publish":
        case "rtc.answer.subscribe": {
          void this.handleAnswerSignal(
            params.serverId,
            params.channelId,
            params.envelope.type as "rtc.answer.publish" | "rtc.answer.subscribe",
            payload
          );
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
      const micTrack = localMicStreamsByKey.get(key)?.getAudioTracks()[0];
      if (micTrack) {
        micTrack.enabled = !session.micMuted && !session.deafened;
      }
      if (!session.micMuted && session.state === "active") {
        void this.startMicUplink(serverId, channelId);
      }
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const micStream = localMicStreamsByKey.get(key);
      const activeMicTrack = micStream?.getAudioTracks()[0];
      sendSignal(socket, {
        type: "rtc.media.state",
        request_id: `media_${Date.now()}`,
        channel_id: channelId,
        payload: {
          mic_muted: session.micMuted,
          deafened: session.deafened,
          ...(activeMicTrack
            ? {
                stream_id: micStream?.id ?? "",
                track_id: activeMicTrack.id,
                stream_kind: RTC_AUDIO_MICROPHONE_KIND
              }
            : {})
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
      const micTrack = localMicStreamsByKey.get(key)?.getAudioTracks()[0];
      if (micTrack) {
        micTrack.enabled = !session.micMuted && !session.deafened;
      }
      audioPrefs.deafened = session.deafened;
      audioPrefs.micMuted = session.micMuted;
      setPlaybackMuted(session.deafened);
      const socket = socketsByKey.get(key);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const micStream = localMicStreamsByKey.get(key);
      const activeMicTrack = micStream?.getAudioTracks()[0];
      sendSignal(socket, {
        type: "rtc.media.state",
        request_id: `media_${Date.now()}`,
        channel_id: channelId,
        payload: {
          mic_muted: session.micMuted,
          deafened: session.deafened,
          ...(activeMicTrack
            ? {
                stream_id: micStream?.id ?? "",
                track_id: activeMicTrack.id,
                stream_kind: RTC_AUDIO_MICROPHONE_KIND
              }
            : {})
        }
      });
    },
    leaveChannel(serverId: string, channelId: string, options?: { reason?: string }): void {
      const key = sessionKey(serverId, channelId);
      this.clearReconnectState(serverId, channelId);
      this.stopMicUplink(serverId, channelId);
      this.stopAllLocalVideo(serverId, channelId);
      this.closePeerConnectionsForSession(serverId, channelId);
      localJoinIdentityByKey.delete(key);
      joinContextByKey.delete(key);
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
        session.state = options?.reason
          ? transitionCallState(session.state, "fatal_error")
          : transitionCallState(session.state, "left");
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
        this.clearReconnectState(serverId, channelId);
        this.stopMicUplink(serverId, channelId);
        this.stopAllLocalVideo(serverId, channelId, { notify: false });
        this.closePeerConnectionsForSession(serverId, channelId);
        localJoinIdentityByKey.delete(key);
        joinContextByKey.delete(key);
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
      subscribeReceivePolicyByServer.delete(serverId);
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
