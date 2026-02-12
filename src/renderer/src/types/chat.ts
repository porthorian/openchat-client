export type ChannelType = "text" | "voice";

export type Channel = {
  id: string;
  name: string;
  type: ChannelType;
  unreadCount?: number;
};

export type ChannelGroup = {
  id: string;
  label: string;
  kind: "text" | "voice";
  channels: Channel[];
};

export type MemberItem = {
  id: string;
  name: string;
  status: "online" | "idle" | "dnd";
};

export type ChatMessage = {
  id: string;
  channelId: string;
  authorUID: string;
  body: string;
  createdAt: string;
};

export type ChannelPresenceMember = {
  clientId: string;
  userUID: string;
  deviceID: string;
};
