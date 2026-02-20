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

export type MessageActionPermissions = {
  canReact?: boolean;
  canReply?: boolean;
  canMarkUnread?: boolean;
  canPin?: boolean;
  canDelete?: boolean;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  authorUID: string;
  body: string;
  createdAt: string;
  linkPreviews?: LinkPreview[];
  attachments?: MessageAttachment[];
  permalink?: string | null;
  actionPermissions?: MessageActionPermissions;
};

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
};

export type MessageAttachment = {
  attachmentId: string;
  fileName: string;
  url: string;
  width: number;
  height: number;
  contentType: string;
  bytes: number;
};

export type ChannelPresenceMember = {
  clientId: string;
  userUID: string;
  deviceID: string;
};
