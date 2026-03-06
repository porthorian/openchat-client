export function shouldDeferOffer(params: {
  makingOffer: boolean;
  signalingState: RTCSignalingState;
  isSettingRemoteAnswerPending: boolean;
}): boolean {
  return params.makingOffer || params.signalingState !== "stable" || params.isSettingRemoteAnswerPending;
}

export type RTCSubscribeReceivePolicy = {
  maxVideoTracks: number;
  maxAudioTracks: number;
};

export const DEFAULT_RTC_SUBSCRIBE_RECEIVE_POLICY: RTCSubscribeReceivePolicy = {
  maxVideoTracks: 8,
  maxAudioTracks: 16
};

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

export function normalizeSubscribeReceivePolicy(
  value: unknown,
  fallback = DEFAULT_RTC_SUBSCRIBE_RECEIVE_POLICY
): RTCSubscribeReceivePolicy {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    maxVideoTracks: normalizePositiveInteger(
      source.maxVideoTracks ?? source.max_video_tracks,
      normalizePositiveInteger(fallback.maxVideoTracks, DEFAULT_RTC_SUBSCRIBE_RECEIVE_POLICY.maxVideoTracks)
    ),
    maxAudioTracks: normalizePositiveInteger(
      source.maxAudioTracks ?? source.max_audio_tracks,
      normalizePositiveInteger(fallback.maxAudioTracks, DEFAULT_RTC_SUBSCRIBE_RECEIVE_POLICY.maxAudioTracks)
    )
  };
}

export function resolveSubscribeReceivePolicy(params: {
  capabilitiesPolicy?: unknown;
  joinTicketPolicy?: unknown;
  defaults?: RTCSubscribeReceivePolicy;
}): RTCSubscribeReceivePolicy {
  const defaults = normalizeSubscribeReceivePolicy(params.defaults ?? DEFAULT_RTC_SUBSCRIBE_RECEIVE_POLICY);
  const fromCapabilities = normalizeSubscribeReceivePolicy(params.capabilitiesPolicy, defaults);
  return normalizeSubscribeReceivePolicy(params.joinTicketPolicy, fromCapabilities);
}

export function desiredSubscribeReceiveTrackCount(params: {
  cap: number;
  announcedTracks: number;
  observedTracks: number;
  pendingTracks: number;
}): number {
  const cap = normalizePositiveInteger(params.cap, 1);
  const announcedTracks = normalizePositiveInteger(params.announcedTracks, 0);
  const observedTracks = normalizePositiveInteger(params.observedTracks, 0);
  const pendingTracks = normalizePositiveInteger(params.pendingTracks, 0);
  const desired = Math.max(announcedTracks, observedTracks + pendingTracks);
  return Math.max(1, Math.min(cap, desired));
}

export type SubscribeSyncDecision = {
  sendImmediately: boolean;
  queueFollowUp: boolean;
};

export function decideSubscribeSync(params: {
  coolingDown: boolean;
  peerBusy: boolean;
}): SubscribeSyncDecision {
  if (params.coolingDown || params.peerBusy) {
    return {
      sendImmediately: false,
      queueFollowUp: true
    };
  }
  return {
    sendImmediately: true,
    queueFollowUp: false
  };
}
