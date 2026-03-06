import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePersistedCallMediaPreferences,
  parsePersistedCallMediaPreferences,
  type PersistedCallMediaPreferencesDefaults
} from "./preferences.ts";

const defaults: PersistedCallMediaPreferencesDefaults = {
  defaultInputDeviceId: "default-input",
  defaultOutputDeviceId: "default-output",
  defaultCameraDeviceId: "default-camera",
  defaultInputVolume: 100,
  defaultOutputVolume: 50
};

test("parsePersistedCallMediaPreferences returns null for empty or invalid payloads", () => {
  assert.equal(parsePersistedCallMediaPreferences(null, defaults), null);
  assert.equal(parsePersistedCallMediaPreferences("", defaults), null);
  assert.equal(parsePersistedCallMediaPreferences("not-json", defaults), null);
});

test("parsePersistedCallMediaPreferences clamps ranges and applies defaults", () => {
  const parsed = parsePersistedCallMediaPreferences(
    JSON.stringify({
      selectedInputDeviceId: "mic-1",
      selectedOutputDeviceId: "",
      selectedCameraDeviceId: "cam-1",
      inputVolume: 260,
      outputVolume: -5
    }),
    defaults
  );

  assert.deepEqual(parsed, {
    selectedInputDeviceId: "mic-1",
    selectedOutputDeviceId: "default-output",
    selectedCameraDeviceId: "cam-1",
    inputVolume: 200,
    outputVolume: 0
  });
});

test("normalizePersistedCallMediaPreferences rounds volumes and falls back to default ids", () => {
  const normalized = normalizePersistedCallMediaPreferences(
    {
      selectedInputDeviceId: " ",
      selectedOutputDeviceId: "speaker-2",
      selectedCameraDeviceId: "",
      inputVolume: 74.6,
      outputVolume: 18.2
    },
    defaults
  );

  assert.deepEqual(normalized, {
    selectedInputDeviceId: "default-input",
    selectedOutputDeviceId: "speaker-2",
    selectedCameraDeviceId: "default-camera",
    inputVolume: 75,
    outputVolume: 18
  });
});
