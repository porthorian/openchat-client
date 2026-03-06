import type { Channel, ChannelGroup } from "../../types/chat.ts";

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
