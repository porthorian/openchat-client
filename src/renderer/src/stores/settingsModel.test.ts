import assert from "node:assert/strict";
import test from "node:test";
import { canonicalShortcut, defaultSettings, defaultShortcuts, normalizeSettings, shortcutConflict, shouldNotify } from "./settingsModel.ts";

test("settings migration keeps valid fields and maps old mutes to Off once", () => {
  const migrated = normalizeSettings(null, ["server-a"]);
  assert.equal(migrated.notificationPolicyByServer["server-a"], "off");
  assert.equal(migrated.notificationPreview, true);
  const normalized = normalizeSettings({ version: 1, theme: "light", textScale: 900, notificationPreview: false,
    notificationPolicyByServer: { "server-b": "mentions" } }, ["server-a"]);
  assert.equal(normalized.theme, "light");
  assert.equal(normalized.textScale, defaultSettings().textScale);
  assert.equal(normalized.notificationPreview, false);
  assert.equal(normalized.notificationPolicyByServer["server-a"], undefined);
  assert.equal(normalized.notificationPolicyByServer["server-b"], "mentions");
});

test("notifications honor global, DND, server policy, and active channel", () => {
  const base = { enabled: true, presence: "online" as const, policy: "all" as const,
    ownMessage: false, isMention: false, windowVisible: false, channelIsActive: false };
  assert.equal(shouldNotify(base), true);
  assert.equal(shouldNotify({ ...base, enabled: false }), false);
  assert.equal(shouldNotify({ ...base, presence: "busy" }), false);
  assert.equal(shouldNotify({ ...base, policy: "off" }), false);
  assert.equal(shouldNotify({ ...base, policy: "mentions" }), false);
  assert.equal(shouldNotify({ ...base, policy: "mentions", isMention: true }), true);
  assert.equal(shouldNotify({ ...base, windowVisible: true, channelIsActive: true }), false);
});

test("shortcuts reject conflict and unsupported system chords", () => {
  assert.equal(shortcutConflict(defaultShortcuts, "composer", "Mod+,"), "settings");
  const normalized = normalizeSettings({ version: 1, shortcuts: { composer: "Mod+Q" } });
  assert.equal(normalized.shortcuts.composer, defaultShortcuts.composer);
  const duplicate = normalizeSettings({ version: 1, shortcuts: { composer: "Mod+Shift+J", channelFilter: "Mod+Shift+J" } });
  assert.equal(duplicate.shortcuts.composer, "Mod+Shift+J");
  assert.equal(duplicate.shortcuts.channelFilter, defaultShortcuts.channelFilter);
  assert.equal(canonicalShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, true), "Mod+,");
  assert.equal(canonicalShortcut({ key: "m", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true }, false), "Mod+Shift+M");
});
