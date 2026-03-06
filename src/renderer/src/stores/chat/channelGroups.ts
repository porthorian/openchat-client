import type { Channel, ChannelGroup } from "../../types/chat.ts";

export type ChannelCreatedPatch = {
  groupId: string;
  channel: Channel;
};

export type ChannelCreationDefaultSelection = {
  selectedType: "text" | "voice";
  selectedGroupId: string | null;
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
    const expectedKind = patch.channel.type;
    if (group.kind !== expectedKind) return group;
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
        selectedType: selectedGroup.kind,
        selectedGroupId: selectedGroup.id
      };
    }
  }

  const preferredType = input.initialType ?? "text";
  const preferredGroup = groups.find((group) => group.kind === preferredType) ?? null;
  if (preferredGroup) {
    return {
      selectedType: preferredType,
      selectedGroupId: preferredGroup.id
    };
  }

  const fallback = groups[0] ?? null;
  if (!fallback) {
    return {
      selectedType: preferredType,
      selectedGroupId: null
    };
  }
  return {
    selectedType: fallback.kind,
    selectedGroupId: fallback.id
  };
}
