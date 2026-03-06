import assert from "node:assert/strict";
import test from "node:test";
import {
  decideSubscribeSync,
  desiredSubscribeReceiveTrackCount,
  resolveSubscribeReceivePolicy,
  shouldDeferOffer
} from "./negotiation.ts";

test("offer deferral logic only allows stable non-inflight offers", () => {
  assert.equal(
    shouldDeferOffer({
      makingOffer: false,
      signalingState: "stable",
      isSettingRemoteAnswerPending: false
    }),
    false
  );
  assert.equal(
    shouldDeferOffer({
      makingOffer: true,
      signalingState: "stable",
      isSettingRemoteAnswerPending: false
    }),
    true
  );
  assert.equal(
    shouldDeferOffer({
      makingOffer: false,
      signalingState: "have-local-offer",
      isSettingRemoteAnswerPending: false
    }),
    true
  );
});

test("subscribe receive policy resolves defaults -> capabilities -> join ticket", () => {
  const resolved = resolveSubscribeReceivePolicy({
    capabilitiesPolicy: {
      max_video_tracks: 6,
      max_audio_tracks: 10
    },
    joinTicketPolicy: {
      max_video_tracks: 3
    }
  });
  assert.deepEqual(resolved, {
    maxVideoTracks: 3,
    maxAudioTracks: 10
  });
});

test("desired subscribe receive track count is capped and at least one", () => {
  assert.equal(
    desiredSubscribeReceiveTrackCount({
      cap: 8,
      announcedTracks: 2,
      observedTracks: 1,
      pendingTracks: 0
    }),
    2
  );
  assert.equal(
    desiredSubscribeReceiveTrackCount({
      cap: 2,
      announcedTracks: 5,
      observedTracks: 0,
      pendingTracks: 0
    }),
    2
  );
  assert.equal(
    desiredSubscribeReceiveTrackCount({
      cap: 8,
      announcedTracks: 0,
      observedTracks: 0,
      pendingTracks: 0
    }),
    1
  );
});

test("subscribe sync decision queues follow-up while cooldown or peer busy", () => {
  assert.deepEqual(
    decideSubscribeSync({
      coolingDown: true,
      peerBusy: false
    }),
    {
      sendImmediately: false,
      queueFollowUp: true
    }
  );
  assert.deepEqual(
    decideSubscribeSync({
      coolingDown: false,
      peerBusy: true
    }),
    {
      sendImmediately: false,
      queueFollowUp: true
    }
  );
  assert.deepEqual(
    decideSubscribeSync({
      coolingDown: false,
      peerBusy: false
    }),
    {
      sendImmediately: true,
      queueFollowUp: false
    }
  );
});
