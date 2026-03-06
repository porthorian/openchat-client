export type RemoteTrackLifecyclePayload = {
  participantId: string;
  userUID: string;
  deviceID: string;
  trackId: string;
  streamId: string;
  mediaKind: "audio" | "video";
  streamKind: string;
};

export type RemoteTrackMetaMatchStrategy = "track" | "stream" | "heuristic";

export type RemoteTrackPendingCandidate<TValue> = {
  key: string;
  value: TValue;
  trackId: string;
  streamId: string;
  mediaKind: "audio" | "video";
};

function normalizeTrackIdentity(value: string | undefined): string {
  return String(value ?? "").trim();
}

function uniqueTrackMetasByTrackId<TMeta extends { trackId: string }>(metas: TMeta[]): TMeta[] {
  const uniqueByTrackId = new Map<string, TMeta>();
  for (const meta of metas) {
    const trackId = normalizeTrackIdentity(meta.trackId);
    if (!trackId || uniqueByTrackId.has(trackId)) continue;
    uniqueByTrackId.set(trackId, meta);
  }
  return [...uniqueByTrackId.values()];
}

export function resolveRemoteMetaForObservedTrack<TMeta extends { trackId: string; streamId: string; mediaKind: "audio" | "video" }>(params: {
  metas: TMeta[];
  observedTrackId: string;
  observedStreamId: string;
  observedMediaKind: "audio" | "video";
}): { meta: TMeta; strategy: "track" | "stream" } | null {
  const observedTrackId = normalizeTrackIdentity(params.observedTrackId);
  if (observedTrackId) {
    const byTrack = params.metas.find((meta) => normalizeTrackIdentity(meta.trackId) === observedTrackId);
    if (byTrack) {
      return {
        meta: byTrack,
        strategy: "track"
      };
    }
  }

  const observedStreamId = normalizeTrackIdentity(params.observedStreamId);
  if (!observedStreamId) return null;

  const byStream = uniqueTrackMetasByTrackId(params.metas).filter((meta) => {
    return normalizeTrackIdentity(meta.streamId) === observedStreamId && meta.mediaKind === params.observedMediaKind;
  });
  if (byStream.length !== 1) return null;

  return {
    meta: byStream[0],
    strategy: "stream"
  };
}

export function findPendingRemoteTrackForMeta<TValue, TMeta extends { trackId: string; streamId: string; mediaKind: "audio" | "video" }>(params: {
  pending: Array<RemoteTrackPendingCandidate<TValue>>;
  meta: TMeta;
}): { key: string; value: TValue; strategy: RemoteTrackMetaMatchStrategy } | null {
  const metaTrackId = normalizeTrackIdentity(params.meta.trackId);
  if (metaTrackId) {
    const byTrack = params.pending.find((candidate) => normalizeTrackIdentity(candidate.trackId) === metaTrackId);
    if (byTrack) {
      return {
        key: byTrack.key,
        value: byTrack.value,
        strategy: "track"
      };
    }
  }

  const metaStreamId = normalizeTrackIdentity(params.meta.streamId);
  if (metaStreamId) {
    const byStream = params.pending.filter((candidate) => {
      return normalizeTrackIdentity(candidate.streamId) === metaStreamId && candidate.mediaKind === params.meta.mediaKind;
    });
    if (byStream.length === 1) {
      return {
        key: byStream[0].key,
        value: byStream[0].value,
        strategy: "stream"
      };
    }
  }

  const byHeuristic = params.pending.filter((candidate) => candidate.mediaKind === params.meta.mediaKind);
  if (byHeuristic.length !== 1) return null;
  return {
    key: byHeuristic[0].key,
    value: byHeuristic[0].value,
    strategy: "heuristic"
  };
}

export function selectRemoteTrackMetaForRemoval<TMeta extends { trackId: string; streamId: string; mediaKind: "audio" | "video" }>(params: {
  metas: TMeta[];
  trackId?: string;
  streamId?: string;
  mediaKind?: "audio" | "video";
}): TMeta[] {
  const trackId = normalizeTrackIdentity(params.trackId);
  const streamId = normalizeTrackIdentity(params.streamId);
  if (!trackId && !streamId) return [];

  return uniqueTrackMetasByTrackId(params.metas).filter((meta) => {
    if (trackId && normalizeTrackIdentity(meta.trackId) === trackId) return true;
    if (!streamId) return false;
    if (normalizeTrackIdentity(meta.streamId) !== streamId) return false;
    if (params.mediaKind && meta.mediaKind !== params.mediaKind) return false;
    return true;
  });
}

export function parseRemoteTrackLifecyclePayload(payload: Record<string, unknown>): RemoteTrackLifecyclePayload | null {
  const participantId = String(payload.participant_id ?? "").trim();
  const trackId = String(payload.track_id ?? "").trim();
  const mediaKindRaw = String(payload.media_kind ?? "").trim().toLowerCase();
  if (!participantId || !trackId) return null;
  if (mediaKindRaw !== "audio" && mediaKindRaw !== "video") return null;

  return {
    participantId,
    userUID: String(payload.user_uid ?? "uid_unknown"),
    deviceID: String(payload.device_id ?? "device_unknown"),
    trackId,
    streamId: String(payload.stream_id ?? ""),
    mediaKind: mediaKindRaw,
    streamKind: String(payload.stream_kind ?? "")
  };
}
