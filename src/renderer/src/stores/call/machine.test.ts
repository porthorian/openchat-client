import assert from "node:assert/strict";
import test from "node:test";
import { transitionCallState } from "./machine.ts";

test("call state transitions cover join/reconnect/leave", () => {
  assert.equal(transitionCallState("idle", "join_requested"), "joining");
  assert.equal(transitionCallState("joining", "join_succeeded"), "active");
  assert.equal(transitionCallState("active", "signal_disconnected"), "reconnecting");
  assert.equal(transitionCallState("reconnecting", "signal_reconnected"), "active");
  assert.equal(transitionCallState("active", "left"), "idle");
});
