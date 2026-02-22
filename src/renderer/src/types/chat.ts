export type ChannelType = "text" | "voice";

export type Channel = {
  id: string;
  name: string;
  type: ChannelType;
  unreadCount?: number;
  mentionCount?: number;
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

export type MessageReplyReference = {
  messageId: string;
  authorUID: string | null;
  authorDisplayName: string | null;
  previewText: string | null;
  isUnavailable: boolean;
};

export type MessageMentionType = "user" | "channel";

export type MessageMentionRange = {
  start: number;
  end: number;
};

export type MessageMention = {
  type: MessageMentionType;
  token: string | null;
  targetId: string | null;
  displayText: string | null;
  range: MessageMentionRange | null;
};

export type MentionCandidate = {
  type: MessageMentionType;
  token: string | null;
  targetId: string | null;
  displayText: string;
};

export type ChannelReadAck = {
  channelId: string;
  userUID: string | null;
  lastReadMessageId: string | null;
  ackedAt: string | null;
  cursorIndex: number | null;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  authorUID: string;
  body: string;
  createdAt: string;
  replyTo?: MessageReplyReference | null;
  mentions?: MessageMention[];
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
