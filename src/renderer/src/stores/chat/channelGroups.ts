import type { Channel, ChannelGroup, ChannelLayoutGroupInput } from "../../types/chat.ts";

export type ChannelCreatedPatch = {
  groupId: string;
  channel: Channel;
};

export type ChannelCreationDefaultSelection = {
  selectedType: "text" | "voice";
  selectedGroupId: string | null;
};

export type CategoryCreatedPatch = {
  group: ChannelGroup;
};

export type CategoryUpdatedPatch = {
  group: ChannelGroup;
};

export type CategoryRenamePatch = {
  groupId: string;
  label: string;
};

export type CategoryDeletePatch = {
  groupId: string;
};

export type ChannelLayoutUpdatedPatch = {
  groups: ChannelGroup[];
};

export type CategoryMovePatch = {
  groupId: string;
  targetIndex: number;
};

export type ChannelMovePatch = {
  channelId: string;
  targetGroupId: string;
  targetIndex: number;
};

function cloneChannel(channel: Channel): Channel {
  return {
    ...channel
  };
}

export function cloneChannelGroups(groups: ChannelGroup[]): ChannelGroup[] {
  return groups.map((group) => ({
    ...group,
    channels: group.channels.map((channel) => cloneChannel(channel))
  }));
}

function clampIndex(index: number, max: number): number {
  const normalized = Number.isFinite(index) ? Math.trunc(index) : 0;
  if (normalized < 0) return 0;
  if (normalized > max) return max;
  return normalized;
}

export function applyChannelCreatedToGroups(
  groups: ChannelGroup[],
  patch: ChannelCreatedPatch
): { groups: ChannelGroup[]; inserted: boolean } {
  const groupId = patch.groupId.trim();
  if (!groupId) {
    return { groups, inserted: false };
  }
  if (groups.some((group) => group.channels.some((channel) => channel.id === patch.channel.id))) {
    return { groups, inserted: false };
  }

  let inserted = false;
  const nextGroups = groups.map((group) => {
    if (group.id !== groupId) return group;
    inserted = true;
    return {
      ...group,
      channels: [...group.channels, patch.channel]
    };
  });

  if (!inserted) {
    return { groups, inserted: false };
  }
  return { groups: nextGroups, inserted: true };
}

export function applyCategoryCreatedToGroups(
  groups: ChannelGroup[],
  patch: CategoryCreatedPatch
): { groups: ChannelGroup[]; inserted: boolean } {
  const groupID = patch.group.id.trim();
  if (!groupID) {
    return { groups, inserted: false };
  }
  if (groups.some((group) => group.id === groupID)) {
    return { groups, inserted: false };
  }
  return {
    groups: [...groups, patch.group],
    inserted: true
  };
}

export function applyCategoryUpdatedToGroups(
  groups: ChannelGroup[],
  patch: CategoryUpdatedPatch
): { groups: ChannelGroup[]; updated: boolean } {
  const groupID = patch.group.id.trim();
  if (!groupID) {
    return { groups, updated: false };
  }

  let updated = false;
  const nextGroups = groups.map((group) => {
    if (group.id !== groupID) return group;
    updated = true;
    const replacementChannels = patch.group.channels.length > 0 || group.channels.length === 0 ? patch.group.channels : group.channels;
    return {
      ...group,
      ...patch.group,
      channels: replacementChannels
    };
  });

  if (!updated) {
    return { groups, updated: false };
  }
  return {
    groups: nextGroups,
    updated: true
  };
}

export function applyCategoryRenamedToGroups(
  groups: ChannelGroup[],
  patch: CategoryRenamePatch
): { groups: ChannelGroup[]; updated: boolean } {
  const groupID = patch.groupId.trim();
  const label = patch.label.trim();
  if (!groupID || !label) {
    return { groups, updated: false };
  }

  let updated = false;
  const nextGroups = groups.map((group) => {
    if (group.id !== groupID) return group;
    updated = true;
    return {
      ...group,
      label
    };
  });

  if (!updated) {
    return { groups, updated: false };
  }
  return {
    groups: nextGroups,
    updated: true
  };
}

export function applyCategoryDeletedToGroups(
  groups: ChannelGroup[],
  patch: CategoryDeletePatch
): { groups: ChannelGroup[]; deleted: boolean } {
  const groupID = patch.groupId.trim();
  if (!groupID) {
    return { groups, deleted: false };
  }

  const target = groups.find((group) => group.id === groupID) ?? null;
  if (!target || target.channels.length > 0) {
    return { groups, deleted: false };
  }

  return {
    groups: groups.filter((group) => group.id !== groupID),
    deleted: true
  };
}

export function applyChannelLayoutUpdatedToGroups(
  groups: ChannelGroup[],
  patch: ChannelLayoutUpdatedPatch
): { groups: ChannelGroup[]; updated: boolean } {
  const nextGroups = patch.groups;
  if (nextGroups.length === 0 && groups.length > 0) {
    return { groups, updated: false };
  }

  const seenGroups = new Set<string>();
  const seenChannels = new Set<string>();
  for (const group of nextGroups) {
    const groupID = group.id.trim();
    if (!groupID || seenGroups.has(groupID)) {
      return { groups, updated: false };
    }
    seenGroups.add(groupID);
    for (const channel of group.channels) {
      const channelID = channel.id.trim();
      if (!channelID || seenChannels.has(channelID)) {
        return { groups, updated: false };
      }
      seenChannels.add(channelID);
    }
  }

  return {
    groups: cloneChannelGroups(nextGroups),
    updated: true
  };
}

export function moveCategoryInGroups(
  groups: ChannelGroup[],
  patch: CategoryMovePatch
): { groups: ChannelGroup[]; moved: boolean } {
  const sourceIndex = groups.findIndex((group) => group.id === patch.groupId);
  if (sourceIndex < 0) {
    return { groups, moved: false };
  }

  const next = [...groups];
  const [group] = next.splice(sourceIndex, 1);
  let targetIndex = Number.isFinite(patch.targetIndex) ? Math.trunc(patch.targetIndex) : 0;
  if (sourceIndex < patch.targetIndex) {
    targetIndex = Math.max(0, targetIndex - 1);
  }
  targetIndex = clampIndex(targetIndex, next.length);

  if (targetIndex === sourceIndex) {
    return { groups, moved: false };
  }

  next.splice(targetIndex, 0, group);
  return {
    groups: next,
    moved: true
  };
}

export function moveChannelInGroups(
  groups: ChannelGroup[],
  patch: ChannelMovePatch
): { groups: ChannelGroup[]; moved: boolean } {
  let sourceGroupIndex = -1;
  let sourceChannelIndex = -1;
  let sourceChannel: Channel | null = null;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const channelIndex = groups[groupIndex].channels.findIndex((channel) => channel.id === patch.channelId);
    if (channelIndex < 0) continue;
    sourceGroupIndex = groupIndex;
    sourceChannelIndex = channelIndex;
    sourceChannel = groups[groupIndex].channels[channelIndex] ?? null;
    break;
  }

  if (!sourceChannel || sourceGroupIndex < 0 || sourceChannelIndex < 0) {
    return { groups, moved: false };
  }

  const targetGroupIndex = groups.findIndex((group) => group.id === patch.targetGroupId);
  if (targetGroupIndex < 0) {
    return { groups, moved: false };
  }

  const next = cloneChannelGroups(groups);
  const [movedChannel] = next[sourceGroupIndex].channels.splice(sourceChannelIndex, 1);
  if (!movedChannel) {
    return { groups, moved: false };
  }

  const sameGroupMove = sourceGroupIndex === targetGroupIndex;
  let targetIndex = Number.isFinite(patch.targetIndex) ? Math.trunc(patch.targetIndex) : 0;
  if (sameGroupMove && sourceChannelIndex < patch.targetIndex) {
    targetIndex = Math.max(0, targetIndex - 1);
  }
  targetIndex = clampIndex(targetIndex, next[targetGroupIndex].channels.length);

  if (sameGroupMove && targetIndex === sourceChannelIndex) {
    return { groups, moved: false };
  }

  next[targetGroupIndex].channels.splice(targetIndex, 0, movedChannel);
  return {
    groups: next,
    moved: true
  };
}

export function toChannelLayoutInput(groups: ChannelGroup[]): ChannelLayoutGroupInput[] {
  return groups.map((group) => ({
    id: group.id,
    channelIds: group.channels.map((channel) => channel.id)
  }));
}

type SelectDefaultsInput = {
  groups: ChannelGroup[];
  initialGroupId?: string | null;
  initialType?: "text" | "voice" | null;
};

export function selectCreateChannelDefaults(input: SelectDefaultsInput): ChannelCreationDefaultSelection {
  const groups = input.groups;
  const requestedGroupID = input.initialGroupId?.trim() ?? "";
  if (requestedGroupID) {
    const selectedGroup = groups.find((group) => group.id === requestedGroupID);
    if (selectedGroup) {
      return {
        selectedType: input.initialType ?? "text",
        selectedGroupId: selectedGroup.id
      };
    }
  }

  const preferredType = input.initialType ?? "text";
  const firstGroup = groups[0] ?? null;
  if (firstGroup) {
    return {
      selectedType: preferredType,
      selectedGroupId: firstGroup.id
    };
  }

  return {
    selectedType: preferredType,
    selectedGroupId: null
  };
}
