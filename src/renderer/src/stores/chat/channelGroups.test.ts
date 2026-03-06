import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelGroup } from "../../types/chat.ts";
import { applyCategoryCreatedToGroups, applyChannelCreatedToGroups, selectCreateChannelDefaults } from "./channelGroups.ts";

const groupsFixture: ChannelGroup[] = [
  {
    id: "grp_text",
    label: "Text Channels",
    kind: "text",
    channels: [{ id: "ch_general", name: "general", type: "text" }]
  },
  {
    id: "grp_voice",
    label: "Voice Channels",
    kind: "voice",
    channels: [{ id: "vc_general", name: "General Voice", type: "voice" }]
  }
];

test("applyChannelCreatedToGroups inserts when id is new and kind matches", () => {
  const result = applyChannelCreatedToGroups(groupsFixture, {
    groupId: "grp_text",
    channel: {
      id: "ch_created",
      name: "created",
      type: "text"
    }
  });

  assert.equal(result.inserted, true);
  const textGroup = result.groups.find((group) => group.id === "grp_text");
  assert.ok(textGroup);
  assert.equal(textGroup.channels.some((channel) => channel.id === "ch_created"), true);
});

test("applyChannelCreatedToGroups ignores duplicate channel ids", () => {
  const result = applyChannelCreatedToGroups(groupsFixture, {
    groupId: "grp_text",
    channel: {
      id: "ch_general",
      name: "general",
      type: "text"
    }
  });

  assert.equal(result.inserted, false);
  assert.equal(result.groups, groupsFixture);
});

test("applyChannelCreatedToGroups allows mixed category channel kinds", () => {
  const result = applyChannelCreatedToGroups(groupsFixture, {
    groupId: "grp_text",
    channel: {
      id: "vc_created",
      name: "voice-created",
      type: "voice"
    }
  });

  assert.equal(result.inserted, true);
  const targetGroup = result.groups.find((group) => group.id === "grp_text");
  assert.ok(targetGroup);
  assert.equal(targetGroup.channels.some((channel) => channel.id === "vc_created"), true);
});

test("applyCategoryCreatedToGroups appends category and dedupes by id", () => {
  const appended = applyCategoryCreatedToGroups(groupsFixture, {
    group: {
      id: "grp_new",
      label: "New Category",
      kind: "voice",
      channels: []
    }
  });
  assert.equal(appended.inserted, true);
  assert.equal(appended.groups.some((group) => group.id === "grp_new"), true);

  const deduped = applyCategoryCreatedToGroups(appended.groups, {
    group: {
      id: "grp_new",
      label: "Duplicate Category",
      kind: "text",
      channels: []
    }
  });
  assert.equal(deduped.inserted, false);
});

test("selectCreateChannelDefaults prioritizes explicit category", () => {
  const defaults = selectCreateChannelDefaults({
    groups: groupsFixture,
    initialGroupId: "grp_voice",
    initialType: "text"
  });

  assert.deepEqual(defaults, {
    selectedType: "text",
    selectedGroupId: "grp_voice"
  });
});

test("selectCreateChannelDefaults falls back to preferred type first match", () => {
  const defaults = selectCreateChannelDefaults({
    groups: groupsFixture,
    initialType: "text"
  });

  assert.deepEqual(defaults, {
    selectedType: "text",
    selectedGroupId: "grp_text"
  });
});
