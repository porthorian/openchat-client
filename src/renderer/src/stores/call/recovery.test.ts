import assert from "node:assert/strict";
import test from "node:test";
import {
  isRetryableHTTPStatus,
  isRetryableSignalError,
  nextPeerRecoveryAction,
  normalizeRTCConnectionPolicy,
  reconnectDelay,
  restoredCaptureAfterJoin
} from "./recovery.ts";

test("advertised timeouts and backoff respect per-attempt minimums and stop after five attempts", () => {
  const policy = normalizeRTCConnectionPolicy({
    joinTimeoutMs: 8_000,
    answerTimeoutMs: 6_000,
    iceRestartEnabled: false,
    reconnectBackoffMs: [100, 400]
  });
  assert.equal(policy.joinTimeoutMs, 8_000);
  assert.equal(policy.answerTimeoutMs, 6_000);
  assert.equal(policy.iceRestartEnabled, false);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => reconnectDelay(policy, i)), [1_000, 2_000, 4_000, 8_000, 15_000, null]);
  const longer = normalizeRTCConnectionPolicy({ ...policy, reconnectBackoffMs: [3_000, 35_000, 5_500, 9_000, 20_000] });
  assert.deepEqual(longer.reconnectBackoffMs, [3_000, 30_000, 5_500, 9_000, 20_000]);
  const short = normalizeRTCConnectionPolicy({ ...policy, reconnectBackoffMs: [100, 7_000] });
  assert.deepEqual(short.reconnectBackoffMs, [1_000, 7_000, 7_000, 8_000, 15_000]);
});

test("peer recovery escalates from ICE restart to rebuild and full rejoin", () => {
  assert.equal(nextPeerRecoveryAction(0, true), "restart_ice");
  assert.equal(nextPeerRecoveryAction(1, true), "rebuild_peer");
  assert.equal(nextPeerRecoveryAction(2, true), "rejoin");
  assert.equal(nextPeerRecoveryAction(0, false), "rebuild_peer");
});

test("permission errors stay terminal and expired tickets permit a new-ticket retry", () => {
  assert.equal(isRetryableHTTPStatus(403), false);
  assert.equal(isRetryableHTTPStatus(503), true);
  assert.equal(isRetryableSignalError("rtc_join_denied", true), false);
  assert.equal(isRetryableSignalError("rtc_ticket_replayed", true), false);
  assert.equal(isRetryableSignalError("rtc_ticket_expired", false), true);
  assert.equal(isRetryableSignalError("rtc_negotiation_failed", true), true);
});

test("rejoin restores microphone permission only", () => {
  assert.deepEqual(restoredCaptureAfterJoin(true), { microphone: true, camera: false, screen: false });
  assert.deepEqual(restoredCaptureAfterJoin(false), { microphone: false, camera: false, screen: false });
});
