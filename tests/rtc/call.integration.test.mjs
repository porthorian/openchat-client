import assert from "node:assert/strict";
import path from "node:path";
import { createServer as createHTTPServer } from "node:http";
import test, { after } from "node:test";
import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";

const vite = await createServer({
  configFile: false,
  mode: "test",
  plugins: [vue()],
  resolve: { alias: { "@renderer": path.resolve("src/renderer/src"), "@shared": path.resolve("src/shared") } },
  server: { middlewareMode: true, hmr: { server: createHTTPServer() } },
  appType: "custom"
});

const { useCallStore } = await vite.ssrLoadModule("/src/renderer/src/stores/call.ts");
const { default: VoiceCard } = await vite.ssrLoadModule("/src/renderer/src/components/ChannelVoiceConnectedCard.vue");

const original = {
  fetch: globalThis.fetch,
  navigator: globalThis.navigator,
  HTMLMediaElement: globalThis.HTMLMediaElement,
  WebSocket: globalThis.WebSocket,
  AudioContext: globalThis.AudioContext,
  RTCPeerConnection: globalThis.RTCPeerConnection
};

after(async () => {
  await vite.close();
  globalThis.fetch = original.fetch;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: original.navigator });
  globalThis.HTMLMediaElement = original.HTMLMediaElement;
  globalThis.WebSocket = original.WebSocket;
  globalThis.AudioContext = original.AudioContext;
  globalThis.RTCPeerConnection = original.RTCPeerConnection;
});

function installBrowserFakes() {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { enumerateDevices: async () => [] } }
  });
  globalThis.HTMLMediaElement = class {};
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    readyState = 0;
    listeners = new Map();
    sent = [];
    constructor(url) {
      this.url = url;
      FakeSocket.instances.push(this);
    }
    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) ?? [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }
    dispatch(type, event = {}) {
      for (const callback of this.listeners.get(type) ?? []) callback(event);
    }
    send(payload) { this.sent.push(JSON.parse(payload)); }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeSocket;
  return FakeSocket;
}

function capabilities(serverId) {
  return {
    server_name: serverId, server_id: serverId, api_version: "1",
    identity_handshake_modes: [], user_uid_policy: "either", profile_data_policy: "uid_only",
    transport: { websocket: true, sse: false, polling: false }, features: {}, limits: {},
    security: { https_required: false, certificate_pinning: "optional" },
    rtc: {
      protocol_version: "1", signaling_url: "ws://localhost/rtc", signaling_transport: "websocket",
      topologies: ["sfu"], features: { voice: true, video: true, screenshare: true, simulcast: false },
      ice_servers: [], connection_policy: {
        join_timeout_ms: 3_000, answer_timeout_ms: 3_000, ice_restart_enabled: true,
        reconnect_backoff_ms: [1_000, 2_000, 4_000, 8_000, 15_000]
      }, subscribe_receive_policy: { max_video_tracks: 4, max_audio_tracks: 4 }
    }
  };
}

function joinParams(serverId, channelId) {
  return { serverId, channelId, backendUrl: `https://${serverId}.test`, userUID: "uid", deviceID: "device" };
}

function installCaptureFakes(mediaDevices) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices } });
  globalThis.AudioContext = class {
    state = "running";
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData() {}, disconnect() {} }; }
    close() { this.state = "closed"; return Promise.resolve(); }
  };
}

async function connectedCall(call, FakeSocket, speak) {
  await call.joinChannel(joinParams("one", "voice"));
  const socket = FakeSocket.instances.at(-1);
  socket.readyState = FakeSocket.OPEN;
  socket.dispatch("open");
  call.connectParticipantMesh = () => {};
  call.syncAllPeerVideoTracks = async () => {};
  call.handleSignalEnvelope({
    serverId: "one", channelId: "voice",
    envelope: { type: "rtc.joined", payload: { participant_id: "self", participants: [] } }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(call.sessionFor("one", "voice").canSpeak, speak);
  return socket;
}

test("one app-wide call cancels prior join and ignores late capabilities", async () => {
  installBrowserFakes();
  setActivePinia(createPinia());
  const call = useCallStore();
  const pending = [];
  globalThis.fetch = (url, options) => new Promise((resolve) => pending.push({ url, options, resolve }));

  const first = call.joinChannel(joinParams("one", "voice-a"));
  assert.equal(call.activeCall.serverId, "one");
  const second = call.joinChannel(joinParams("two", "voice-b"));
  assert.deepEqual(call.activeCall, { serverId: "two", channelId: "voice-b" });
  assert.equal(pending[0].options.signal.aborted, true);
  pending[0].resolve({ ok: true, json: async () => capabilities("one") });
  await first;
  assert.equal(call.sessionFor("one", "voice-a").state, "idle");
  call.leaveChannel("two", "voice-b");
  assert.equal(pending[1].options.signal.aborted, true);
  pending[1].resolve({ ok: true, json: async () => capabilities("two") });
  await second;
  assert.equal(call.activeCall, null);
});

test("old socket callbacks cannot revive a switched call", async () => {
  const FakeSocket = installBrowserFakes();
  setActivePinia(createPinia());
  const call = useCallStore();
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => url.includes("join-ticket")
      ? {
          ticket: `ticket-${url}`, server_id: url.includes("one.test") ? "one" : "two",
          channel_id: "voice", signaling_url: "ws://localhost/rtc", ice_servers: [],
          permissions: { speak: false, video: false, screenshare: false }
        }
      : capabilities(url.includes("one.test") ? "one" : "two")
  });
  await call.joinChannel(joinParams("one", "voice"));
  const oldSocket = FakeSocket.instances[0];
  await call.joinChannel(joinParams("two", "voice"));
  oldSocket.readyState = FakeSocket.OPEN;
  oldSocket.dispatch("open");
  oldSocket.dispatch("message", { data: JSON.stringify({ type: "rtc.joined", payload: { participant_id: "stale" } }) });
  oldSocket.dispatch("close", { code: 1006, reason: "", wasClean: false });
  assert.equal(oldSocket.sent.length, 0);
  assert.deepEqual(call.activeCall, { serverId: "two", channelId: "voice" });
  assert.equal(call.sessionFor("one", "voice").state, "idle");
  assert.equal(call.sessionFor("two", "voice").state, "joining");
  call.leaveChannel("two", "voice");
});

test("join permissions prevent mic capture and leave keeps late capture stopped", async () => {
  const FakeSocket = installBrowserFakes();
  let captureCount = 0;
  let releaseCapture;
  const pendingCapture = new Promise((resolve) => { releaseCapture = resolve; });
  installCaptureFakes({
    enumerateDevices: async () => [],
    getUserMedia: () => { captureCount++; return pendingCapture; }
  });
  setActivePinia(createPinia());
  const call = useCallStore();
  let speak = false;
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => url.includes("join-ticket")
      ? { ticket: "fresh", server_id: "one", channel_id: "voice", signaling_url: "ws://localhost/rtc", ice_servers: [],
          permissions: { speak, video: false, screenshare: false } }
      : capabilities("one")
  });
  await connectedCall(call, FakeSocket, false);
  assert.equal(captureCount, 0);
  assert.match(call.sessionFor("one", "voice").errorMessage, /Listen-only/);
  call.leaveChannel("one", "voice");

  speak = true;
  await connectedCall(call, FakeSocket, true);
  assert.equal(captureCount, 1);
  call.leaveChannel("one", "voice");
  let stopped = false;
  releaseCapture({ getTracks: () => [{ stop() { stopped = true; } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, true);
  assert.equal(call.activeCall, null);
});

test("a lost selected microphone falls back to default and preserves mute", async () => {
  const FakeSocket = installBrowserFakes();
  let devices = [{ kind: "audioinput", deviceId: "custom", label: "USB Mic" }];
  const tracks = [];
  const constraints = [];
  installCaptureFakes({
    enumerateDevices: async () => devices,
    getUserMedia: async ({ audio }) => {
      constraints.push(audio);
      const track = { id: `mic-${tracks.length}`, enabled: true, onended: null, stop() {} };
      tracks.push(track);
      return { id: `stream-${tracks.length}`, getTracks: () => [track], getAudioTracks: () => [track] };
    }
  });
  setActivePinia(createPinia());
  const call = useCallStore();
  call.selectedInputDeviceId = "custom";
  call.audioPrefsByServer.one = { micMuted: true, deafened: false };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => url.includes("join-ticket")
      ? { ticket: "fresh", server_id: "one", channel_id: "voice", signaling_url: "ws://localhost/rtc", ice_servers: [],
          permissions: { speak: true, video: true, screenshare: true } }
      : capabilities("one")
  });
  await connectedCall(call, FakeSocket, true);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].enabled, false);
  devices = [];
  await call.handleMediaDeviceChange();
  assert.equal(call.selectedInputDeviceId, "default");
  assert.equal(tracks.length, 2);
  assert.equal(tracks[1].enabled, false);
  assert.equal(call.sessionFor("one", "voice").cameraEnabled, false);
  assert.equal(call.sessionFor("one", "voice").screenShareEnabled, false);
  assert.equal(constraints.length, 2);
  call.leaveChannel("one", "voice");
});

test("camera replacement keeps the working track until new capture succeeds", async () => {
  const FakeSocket = installBrowserFakes();
  const tracks = [];
  let releaseReplacement;
  let captures = 0;
  const stream = () => {
    const track = { id: `camera-${tracks.length}`, onended: null, stop() { this.stopped = true; } };
    tracks.push(track);
    return { id: `video-${tracks.length}`, getTracks: () => [track], getVideoTracks: () => [track] };
  };
  installCaptureFakes({
    enumerateDevices: async () => [],
    getUserMedia: () => {
      captures++;
      if (captures === 1) return Promise.resolve(stream());
      return new Promise((resolve) => { releaseReplacement = resolve; });
    }
  });
  setActivePinia(createPinia());
  const call = useCallStore();
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => url.includes("join-ticket")
      ? { ticket: "fresh", server_id: "one", channel_id: "voice", signaling_url: "ws://localhost/rtc", ice_servers: [],
          permissions: { speak: false, video: true, screenshare: false } }
      : capabilities("one")
  });
  await connectedCall(call, FakeSocket, false);
  await call.enableCamera("one");
  assert.equal(call.sessionFor("one", "voice").cameraEnabled, true);
  const switching = call.selectCameraDevice("camera-two");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tracks[0].stopped, undefined);
  assert.equal(call.sessionFor("one", "voice").cameraEnabled, true);
  releaseReplacement(stream());
  await switching;
  assert.equal(tracks[0].stopped, true);
  assert.equal(tracks[1].stopped, undefined);
  assert.equal(call.sessionFor("one", "voice").screenShareEnabled, false);
  call.scheduleSignalingReconnect("one", "voice", "test-disconnect");
  assert.equal(tracks[1].stopped, true);
  assert.equal(call.sessionFor("one", "voice").cameraEnabled, false);
  assert.equal(captures, 2);
  call.leaveChannel("one", "voice");
});

test("join deadline and terminal permission denial produce failed call state", (t) => {
  installBrowserFakes();
  setActivePinia(createPinia());
  const call = useCallStore();
  const key = call.ensureSession("one", "voice");
  call.activeCall = { serverId: "one", channelId: "voice" };
  const generation = call.invalidateJoinAttempt("one", "voice");
  call.sessionsByKey[key].state = "joining";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  call.armJoinDeadline("one", "voice", generation, 12_000);
  t.mock.timers.tick(11_999);
  assert.equal(call.sessionsByKey[key].state, "joining");
  t.mock.timers.tick(1);
  assert.equal(call.sessionsByKey[key].state, "error");
  assert.equal(call.sessionsByKey[key].canRetry, true);
  t.mock.timers.reset();

  call.sessionsByKey[key].state = "joining";
  call.handleSignalEnvelope({ serverId: "one", channelId: "voice", envelope: {
    type: "rtc.error", payload: { code: "rtc_join_denied", message: "No membership", retryable: true }
  } });
  assert.equal(call.sessionsByKey[key].state, "error");
  assert.equal(call.sessionsByKey[key].canRetry, false);
  call.leaveChannel("one", "voice");
});

test("capability permission denial stops without probing a fallback endpoint", async () => {
  installBrowserFakes();
  setActivePinia(createPinia());
  const call = useCallStore();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return { ok: false, status: 403 }; };
  await call.joinChannel(joinParams("one", "voice"));
  assert.equal(requests, 1);
  assert.equal(call.sessionFor("one", "voice").state, "error");
  assert.equal(call.sessionFor("one", "voice").canRetry, false);
  call.leaveChannel("one", "voice");
});

test("five automatic reconnects each request a fresh ticket, then Retry remains available", async (t) => {
  installBrowserFakes();
  setActivePinia(createPinia());
  const call = useCallStore();
  let tickets = 0;
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    const advertised = capabilities("one");
    advertised.rtc.connection_policy.reconnect_backoff_ms = [250, 500, 1_000, 2_000, 5_000];
    return { ok: true, json: async () => url.includes("join-ticket")
      ? { ticket: `ticket-${++tickets}`, server_id: "one", channel_id: "voice", signaling_url: "ws://localhost/rtc",
          ice_servers: [], permissions: { speak: false, video: false, screenshare: false } }
      : advertised };
  };
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  await call.joinChannel(joinParams("one", "voice"));
  assert.equal(tickets, 1);
  let elapsed = 0;
  for (const [index, delay] of [1_000, 2_000, 4_000, 8_000, 15_000].entries()) {
    call.scheduleSignalingReconnect("one", "voice", "test-network-drop");
    const session = call.sessionFor("one", "voice");
    assert.equal(session.reconnectAttempt, index + 1);
    assert.equal(session.reconnectPhase, "waiting");
    assert.equal(session.nextRetryAt, Date.now() + delay);
    const requestsBeforeDelay = requests;
    t.mock.timers.tick(delay - 1);
    assert.equal(requests, requestsBeforeDelay);
    assert.equal(session.reconnectPhase, "waiting");
    t.mock.timers.tick(1);
    elapsed += delay;
    assert.equal(session.reconnectPhase, "attempting");
    assert.equal(session.nextRetryAt, null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(tickets, index + 2);
    if (index === 4) assert.equal(elapsed, 30_000);
  }
  call.scheduleSignalingReconnect("one", "voice", "test-network-drop");
  assert.equal(call.sessionFor("one", "voice").state, "error");
  assert.equal(call.sessionFor("one", "voice").canRetry, true);
  assert.equal(call.sessionFor("one", "voice").reconnectPhase, null);
  assert.equal(call.sessionFor("one", "voice").nextRetryAt, null);
  assert.equal(tickets, 6);
  const retry = call.retryCall();
  assert.equal(retry, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tickets, 7);
  assert.equal(call.sessionFor("one", "voice").reconnectAttempt, 0);
  call.leaveChannel("one", "voice");
  t.mock.timers.reset();
});

test("socket error and close share one failure, and a successful retry clears the countdown", async (t) => {
  const FakeSocket = installBrowserFakes();
  setActivePinia(createPinia());
  const call = useCallStore();
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    return { ok: true, json: async () => url.includes("join-ticket")
      ? { ticket: `ticket-${requests}`, server_id: "one", channel_id: "voice", signaling_url: "ws://localhost/rtc",
          ice_servers: [], permissions: { speak: false, video: false, screenshare: false } }
      : capabilities("one") };
  };
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const socket = await connectedCall(call, FakeSocket, false);
  socket.dispatch("error");
  socket.dispatch("close", { code: 1006, reason: "", wasClean: false });
  const session = call.sessionFor("one", "voice");
  assert.equal(session.reconnectAttempt, 1);
  assert.equal(session.reconnectPhase, "waiting");
  assert.equal(session.nextRetryAt, Date.now() + 1_000);
  t.mock.timers.tick(999);
  assert.equal(requests, 2);
  t.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 4);
  assert.equal(session.reconnectPhase, "attempting");
  const retrySocket = FakeSocket.instances.at(-1);
  retrySocket.readyState = FakeSocket.OPEN;
  retrySocket.dispatch("open");
  retrySocket.dispatch("message", { data: JSON.stringify({ type: "rtc.joined", payload: { participant_id: "self", participants: [] } }) });
  assert.equal(session.state, "active");
  assert.equal(session.reconnectAttempt, 0);
  assert.equal(session.reconnectPhase, null);
  assert.equal(session.nextRetryAt, null);
  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 4);
  call.leaveChannel("one", "voice");
  t.mock.timers.reset();
});

test("Leave and channel switch cancel a scheduled retry", async (t) => {
  installBrowserFakes();
  setActivePinia(createPinia());
  const call = useCallStore();
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    const serverId = url.includes("two.test") ? "two" : "one";
    return { ok: true, json: async () => url.includes("join-ticket")
      ? { ticket: `ticket-${requests}`, server_id: serverId, channel_id: "voice", signaling_url: "ws://localhost/rtc",
          ice_servers: [], permissions: { speak: false, video: false, screenshare: false } }
      : capabilities(serverId) };
  };
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  await call.joinChannel(joinParams("one", "voice"));
  call.scheduleSignalingReconnect("one", "voice", "test-drop");
  call.leaveChannel("one", "voice");
  assert.equal(call.sessionFor("one", "voice").nextRetryAt, null);
  t.mock.timers.tick(30_000);
  assert.equal(requests, 2);

  await call.joinChannel(joinParams("one", "voice"));
  call.scheduleSignalingReconnect("one", "voice", "test-drop");
  await call.joinChannel(joinParams("two", "voice"));
  assert.equal(call.sessionFor("one", "voice").reconnectPhase, null);
  assert.deepEqual(call.activeCall, { serverId: "two", channelId: "voice" });
  t.mock.timers.tick(30_000);
  assert.equal(requests, 6);
  call.leaveChannel("two", "voice");
  t.mock.timers.reset();
});

test("disconnected peer gets five seconds then ICE restart, rebuild, and rejoin", (t) => {
  installBrowserFakes();
  class FakePeer {
    static instances = [];
    signalingState = "stable";
    iceConnectionState = "connected";
    connectionState = "connected";
    restarts = 0;
    constructor() { FakePeer.instances.push(this); }
    restartIce() { this.restarts++; }
    close() { this.signalingState = "closed"; }
  }
  globalThis.RTCPeerConnection = FakePeer;
  setActivePinia(createPinia());
  const call = useCallStore();
  const key = call.ensureSession("one", "voice");
  call.activeCall = { serverId: "one", channelId: "voice" };
  call.invalidateJoinAttempt("one", "voice");
  call.sessionsByKey[key].state = "active";
  call.ensureSubscribeRecvonlyTransceivers = () => {};
  call.syncPeerVideoTracks = async () => {};
  const offers = [];
  call.createAndSendOffer = async (_serverId, _channelId, _peerId, reason) => { offers.push(reason); };
  const peer = call.ensurePeerConnection("one", "voice", "__sfu_subscribe__");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  peer.connection.iceConnectionState = "disconnected";
  peer.connection.oniceconnectionstatechange();
  t.mock.timers.tick(4_999);
  assert.equal(peer.connection.restarts, 0);
  t.mock.timers.tick(1);
  assert.equal(peer.connection.restarts, 1);
  assert.match(offers[0], /ice-restart/);
  call.armAnswerDeadline("one", "voice", "__sfu_subscribe__", peer);
  call.recoverPeer("one", "voice", "__sfu_subscribe__", "peer-failed");
  t.mock.timers.tick(9_999);
  assert.equal(FakePeer.instances.length, 1);
  t.mock.timers.tick(1);
  assert.equal(FakePeer.instances.length, 2);
  assert.match(offers[1], /peer-rebuild/);
  const rebuilt = call.ensurePeerConnection("one", "voice", "__sfu_subscribe__");
  call.armAnswerDeadline("one", "voice", "__sfu_subscribe__", rebuilt);
  t.mock.timers.tick(10_000);
  assert.equal(call.sessionsByKey[key].state, "error");
  t.mock.timers.reset();
  call.leaveChannel("one", "voice");
});

test("voice card announces receive-only, reconnecting, and failed states with retry controls", async () => {
  const base = {
    serverName: "Community", activeVoiceChannelName: "General", callParticipantCount: 0,
    cameraEnabled: false, screenShareEnabled: false, cameraAvailable: true, screenShareAvailable: true,
    canRetry: true, receiveOnly: false, reconnectAttempt: 0, reconnectPhase: null, nextRetryAt: null
  };
  const render = (props) => renderToString(createSSRApp(VoiceCard, { ...base, ...props }));
  const receiveOnly = await render({ callState: "active", receiveOnly: true });
  assert.match(receiveOnly, /role="status"[^>]*aria-live="polite"/);
  assert.match(receiveOnly, /Receive-only call/);
  const waiting = await render({ callState: "reconnecting", reconnectAttempt: 2, reconnectPhase: "waiting", nextRetryAt: Date.now() + 2_000 });
  assert.match(waiting, /Waiting to retry 2 of 5/);
  assert.match(waiting, /aria-hidden="true">Retry 2 of 5 in 2s/);
  assert.ok(waiting.indexOf('role="status"') < waiting.indexOf('aria-hidden="true">Retry 2 of 5 in 2s'));
  const trying = await render({ callState: "reconnecting", reconnectAttempt: 2, reconnectPhase: "attempting" });
  assert.match(trying, /Trying 2 of 5/);
  assert.doesNotMatch(trying, /Retry 2 of 5 in/);
  const failed = await render({ callState: "error", callErrorMessage: "Network unavailable" });
  assert.match(failed, /Call failed/);
  assert.match(failed, />\s*Retry\s*<\/button>/);
  assert.match(failed, /aria-label="Leave voice channel"/);
  assert.match(failed, /role="alert">Network unavailable/);
  const denied = await render({ callState: "error", canRetry: false });
  assert.doesNotMatch(denied, />\s*Retry\s*<\/button>/);
});
