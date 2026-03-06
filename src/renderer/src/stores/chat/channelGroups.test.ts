import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelGroup } from "../../types/chat.ts";
import {
  applyCategoryCreatedToGroups,
  applyCategoryDeletedToGroups,
  applyCategoryUpdatedToGroups,
  applyChannelCreatedToGroups,
  applyChannelLayoutUpdatedToGroups,
  moveCategoryInGroups,
  moveChannelInGroups,
  selectCreateChannelDefaults,
  toChannelLayoutInput
} from "./channelGroups.ts";

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
  },
  {
    id: "grp_ops",
    label: "Ops",
    kind: "text",
    channels: [{ id: "ch_ops", name: "ops", type: "text" }]
  }
];

test("applyChannelCreatedToGroups inserts when id is new", () => {
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

test("applyCategoryUpdatedToGroups updates name and preserves channels when payload channels omitted", () => {
  const updated = applyCategoryUpdatedToGroups(groupsFixture, {
    group: {
      id: "grp_text",
      label: "Renamed",
      kind: "text",
      channels: []
    }
  });

  assert.equal(updated.updated, true);
  const target = updated.groups.find((group) => group.id === "grp_text");
  assert.ok(target);
  assert.equal(target.label, "Renamed");
  assert.equal(target.channels.length, 1);
  assert.equal(target.channels[0]?.id, "ch_general");
});

test("applyCategoryDeletedToGroups removes empty categories only", () => {
  const withEmpty: ChannelGroup[] = [
    ...groupsFixture,
    {
      id: "grp_empty",
      label: "Empty",
      kind: "text",
      channels: []
    }
  ];

  const deleted = applyCategoryDeletedToGroups(withEmpty, {
    groupId: "grp_empty"
  });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.groups.some((group) => group.id === "grp_empty"), false);

  const blocked = applyCategoryDeletedToGroups(groupsFixture, {
    groupId: "grp_text"
  });
  assert.equal(blocked.deleted, false);
  assert.equal(blocked.groups, groupsFixture);
});

test("applyChannelLayoutUpdatedToGroups accepts authoritative groups and rejects duplicate channel ids", () => {
  const accepted = applyChannelLayoutUpdatedToGroups(groupsFixture, {
    groups: [
      {
        id: "grp_voice",
        label: "Voice Channels",
        kind: "voice",
        channels: [{ id: "vc_general", name: "General Voice", type: "voice" }]
      },
      {
        id: "grp_text",
        label: "Text Channels",
        kind: "text",
        channels: [
          { id: "ch_general", name: "general", type: "text" },
          { id: "ch_ops", name: "ops", type: "text" }
        ]
      }
    ]
  });
  assert.equal(accepted.updated, true);
  assert.equal(accepted.groups[0]?.id, "grp_voice");

  const rejected = applyChannelLayoutUpdatedToGroups(groupsFixture, {
    groups: [
      {
        id: "grp_a",
        label: "A",
        kind: "text",
        channels: [{ id: "ch_dup", name: "dup", type: "text" }]
      },
      {
        id: "grp_b",
        label: "B",
        kind: "text",
        channels: [{ id: "ch_dup", name: "dup", type: "text" }]
      }
    ]
  });
  assert.equal(rejected.updated, false);
});

test("applyChannelLayoutUpdatedToGroups remains stable when applied repeatedly", () => {
  const layout = [
    {
      id: "grp_voice",
      label: "Voice Channels",
      kind: "voice" as const,
      channels: [{ id: "vc_general", name: "General Voice", type: "voice" as const }]
    },
    {
      id: "grp_text",
      label: "Text Channels",
      kind: "text" as const,
      channels: [
        { id: "ch_general", name: "general", type: "text" as const },
        { id: "ch_ops", name: "ops", type: "text" as const }
      ]
    }
  ];

  const first = applyChannelLayoutUpdatedToGroups(groupsFixture, { groups: layout });
  assert.equal(first.updated, true);
  const second = applyChannelLayoutUpdatedToGroups(first.groups, { groups: layout });
  assert.equal(second.updated, true);
  assert.deepEqual(second.groups, first.groups);
});

test("moveCategoryInGroups reorders categories deterministically", () => {
  const result = moveCategoryInGroups(groupsFixture, {
    groupId: "grp_ops",
    targetIndex: 0
  });

  assert.equal(result.moved, true);
  assert.deepEqual(
    result.groups.map((group) => group.id),
    ["grp_ops", "grp_text", "grp_voice"]
  );
});

test("moveChannelInGroups supports cross-category and same-category moves", () => {
  const crossGroup = moveChannelInGroups(groupsFixture, {
    channelId: "vc_general",
    targetGroupId: "grp_text",
    targetIndex: 1
  });
  assert.equal(crossGroup.moved, true);
  const textGroup = crossGroup.groups.find((group) => group.id === "grp_text");
  assert.ok(textGroup);
  assert.deepEqual(
    textGroup.channels.map((channel) => channel.id),
    ["ch_general", "vc_general"]
  );

  const sameGroup = moveChannelInGroups(
    [
      {
        id: "grp_text",
        label: "Text",
        kind: "text",
        channels: [
          { id: "ch_one", name: "one", type: "text" },
          { id: "ch_two", name: "two", type: "text" },
          { id: "ch_three", name: "three", type: "text" }
        ]
      }
    ],
    {
      channelId: "ch_one",
      targetGroupId: "grp_text",
      targetIndex: 3
    }
  );
  assert.equal(sameGroup.moved, true);
  assert.deepEqual(
    sameGroup.groups[0]?.channels.map((channel) => channel.id),
    ["ch_two", "ch_three", "ch_one"]
  );

  const intoEmpty = moveChannelInGroups(
    [
      {
        id: "grp_source",
        label: "Source",
        kind: "text",
        channels: [{ id: "ch_source", name: "source", type: "text" }]
      },
      {
        id: "grp_empty",
        label: "Empty",
        kind: "text",
        channels: []
      }
    ],
    {
      channelId: "ch_source",
      targetGroupId: "grp_empty",
      targetIndex: 0
    }
  );
  assert.equal(intoEmpty.moved, true);
  assert.deepEqual(intoEmpty.groups[1]?.channels.map((channel) => channel.id), ["ch_source"]);
});

test("toChannelLayoutInput maps groups to API payload shape", () => {
  const payload = toChannelLayoutInput(groupsFixture);
  assert.deepEqual(payload, [
    { id: "grp_text", channelIds: ["ch_general"] },
    { id: "grp_voice", channelIds: ["vc_general"] },
    { id: "grp_ops", channelIds: ["ch_ops"] }
  ]);
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

test("selectCreateChannelDefaults falls back to first group", () => {
  const defaults = selectCreateChannelDefaults({
    groups: groupsFixture,
    initialType: "text"
  });

  assert.deepEqual(defaults, {
    selectedType: "text",
    selectedGroupId: "grp_text"
  });
});
