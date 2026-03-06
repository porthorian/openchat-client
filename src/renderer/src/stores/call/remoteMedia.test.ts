import assert from "node:assert/strict";
import test from "node:test";
import {
  findPendingRemoteTrackForMeta,
  parseRemoteTrackLifecyclePayload,
  resolveRemoteMetaForObservedTrack,
  selectRemoteTrackMetaForRemoval,
  type RemoteTrackLifecyclePayload
} from "./remoteMedia.ts";

test("remote track lifecycle payload parsing validates required fields", () => {
  const parsed = parseRemoteTrackLifecyclePayload({
    participant_id: "participant_a",
    user_uid: "uid_a",
    device_id: "dev_a",
    track_id: "track_1",
    stream_id: "stream_1",
    media_kind: "video",
    stream_kind: "video_screen"
  });
  assert.ok(parsed);
  assert.equal(parsed?.participantId, "participant_a");
  assert.equal(parsed?.mediaKind, "video");

  const invalid = parseRemoteTrackLifecyclePayload({
    participant_id: "participant_a",
    track_id: "",
    media_kind: "video"
  });
  assert.equal(invalid, null);
});

test("resolves observed track metadata by stream id when track id differs", () => {
  const metas: RemoteTrackLifecyclePayload[] = [
    {
      participantId: "participant_a",
      userUID: "uid_a",
      deviceID: "dev_a",
      trackId: "signaled_track_video",
      streamId: "stream_video_shared",
      mediaKind: "video",
      streamKind: "video_camera"
    }
  ];

  const resolved = resolveRemoteMetaForObservedTrack({
    metas,
    observedTrackId: "browser_track_video",
    observedStreamId: "stream_video_shared",
    observedMediaKind: "video"
  });
  assert.ok(resolved);
  assert.equal(resolved?.strategy, "stream");
  assert.equal(resolved?.meta.trackId, "signaled_track_video");
});

test("finds pending remote track by stream id when metadata arrives later", () => {
  const pending = [
    {
      key: "browser_track_video",
      value: { marker: "pending_video" },
      trackId: "browser_track_video",
      streamId: "stream_video_shared",
      mediaKind: "video" as const
    }
  ];
  const meta: RemoteTrackLifecyclePayload = {
    participantId: "participant_a",
    userUID: "uid_a",
    deviceID: "dev_a",
    trackId: "signaled_track_video",
    streamId: "stream_video_shared",
    mediaKind: "video",
    streamKind: "video_screen"
  };

  const resolved = findPendingRemoteTrackForMeta({
    pending,
    meta
  });
  assert.ok(resolved);
  assert.equal(resolved?.strategy, "stream");
  assert.equal(resolved?.key, "browser_track_video");
});

test("falls back to participant/media-kind heuristic when exactly one unmatched pending track exists", () => {
  const pending = [
    {
      key: "browser_track_audio",
      value: { marker: "pending_audio" },
      trackId: "browser_track_audio",
      streamId: "stream_audio_browser",
      mediaKind: "audio" as const
    },
    {
      key: "browser_track_video",
      value: { marker: "pending_video" },
      trackId: "browser_track_video",
      streamId: "stream_video_browser",
      mediaKind: "video" as const
    }
  ];
  const meta: RemoteTrackLifecyclePayload = {
    participantId: "participant_a",
    userUID: "uid_a",
    deviceID: "dev_a",
    trackId: "signaled_track_audio_other",
    streamId: "stream_audio_other",
    mediaKind: "audio",
    streamKind: "audio_microphone"
  };

  const resolved = findPendingRemoteTrackForMeta({
    pending,
    meta
  });
  assert.ok(resolved);
  assert.equal(resolved?.strategy, "heuristic");
  assert.equal(resolved?.key, "browser_track_audio");
});

test("selects removal targets by stream id when only stream mapping is available", () => {
  const metas: RemoteTrackLifecyclePayload[] = [
    {
      participantId: "participant_a",
      userUID: "uid_a",
      deviceID: "dev_a",
      trackId: "signaled_track_audio",
      streamId: "stream_audio_shared",
      mediaKind: "audio",
      streamKind: "audio_microphone"
    }
  ];

  const toRemove = selectRemoteTrackMetaForRemoval({
    metas,
    streamId: "stream_audio_shared",
    mediaKind: "audio"
  });
  assert.equal(toRemove.length, 1);
  assert.equal(toRemove[0]?.trackId, "signaled_track_audio");
});
