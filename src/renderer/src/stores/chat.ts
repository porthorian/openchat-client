import { defineStore } from "pinia";
import type { OpenGraphMetadata } from "@shared/ipc";
import {
  createMessage,
  fetchChannelReadAck,
  deleteMessage as deleteMessageRequest,
  fetchMyProfile,
  fetchProfilesBatch,
  fetchChannelGroups,
  fetchMembers,
  fetchMessages,
  getRealtimeURL,
  ProfileRequestError,
  resolveMentionCandidates,
  sendRealtime,
  type SyncedUserProfile,
  updateChannelReadAck,
  updateMyProfile,
  uploadProfileAvatar,
  type RealtimeEnvelope
} from "@renderer/services/chatClient";
import type { AvatarMode } from "@renderer/types/models";
import type {
  ChannelReadAck,
  Channel,
  ChannelGroup,
  ChannelPresenceMember,
  ChatMessage,
  LinkPreview,
  MentionCandidate,
  MemberItem,
  MessageActionPermissions,
  MessageAttachment,
  MessageMention,
  MessageReplyReference
} from "@renderer/types/chat";
import { extractMessageURLs } from "@renderer/utils/linkify";

type ServerRealtimeState = {
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  lastConnectedAt: string | null;
  errorMessage: string | null;
};

type ProfileSyncState = {
  syncing: boolean;
  lastSyncedAt: string | null;
  errorMessage: string | null;
};

type LocalProfileSyncInput = {
  serverId: string;
  backendUrl: string;
  userUID: string;
  deviceID: string;
  displayName: string;
  avatarMode: AvatarMode;
  avatarPresetId: string;
  avatarImageDataUrl: string | null;
};

type PendingLocalReplyHint = {
  authorUID: string;
  replyToMessageId: string;
  body: string;
  enqueuedAt: number;
};

type ChatStoreState = {
  groupsByServer: Record<string, ChannelGroup[]>;
  membersByServer: Record<string, MemberItem[]>;
  presenceByChannel: Record<string, ChannelPresenceMember[]>;
  typingByChannel: Record<string, ChannelPresenceMember[]>;
  messagesByChannel: Record<string, ChatMessage[]>;
  readAckByChannel: Record<string, ChannelReadAck>;
  loadingByServer: Record<string, boolean>;
  loadingMessagesByChannel: Record<string, boolean>;
  sendingByChannel: Record<string, boolean>;
  realtimeByServer: Record<string, ServerRealtimeState>;
  subscribedChannelByServer: Record<string, string | null>;
  unreadByChannel: Record<string, number>;
  mentionUnreadByChannel: Record<string, number>;
  currentUserUIDByServer: Record<string, string>;
  profilesByServer: Record<string, Record<string, SyncedUserProfile>>;
  profileSyncStateByServer: Record<string, ProfileSyncState>;
  profileSyncAvailableByServer: Record<string, boolean | null>;
  serverMutedById: Record<string, boolean>;
};

const socketsByServer = new Map<string, WebSocket>();
const intentionallyClosedSockets = new Set<string>();
const reconnectTimersByServer = new Map<string, ReturnType<typeof setTimeout>>();
const typingTimersByMember = new Map<string, ReturnType<typeof setTimeout>>();
const realtimeConnectParamsByServer = new Map<string, { serverId: string; backendUrl: string; userUID: string; deviceID: string }>();
const reconnectBackoffMS = [1000, 2000, 5000, 10000, 15000];
const typingExpiryMS = 6000;
const profileBatchLimit = 100;
const maxLinkPreviewsPerMessage = 3;
const linkPreviewCacheByURL = new Map<string, LinkPreview | null>();
const linkPreviewInFlightByURL = new Map<string, Promise<LinkPreview | null>>();
const pendingLocalReplyHintsByChannel = new Map<string, PendingLocalReplyHint[]>();
const pendingLocalReplyHintMaxAgeMS = 2 * 60 * 1000;
const pendingLocalReplyHintMaxPerChannel = 40;
const mentionAudienceTokens = new Set(["@here", "@channel"]);

function parseEnvelope(rawMessage: string): RealtimeEnvelope | null {
  try {
    return JSON.parse(rawMessage) as RealtimeEnvelope;
  } catch (_error) {
    return null;
  }
}

function hasMessage(messages: ChatMessage[], messageID: string): boolean {
  return messages.some((item) => item.id === messageID);
}

function hasReplyReference(replyTo: ChatMessage["replyTo"] | null | undefined): boolean {
  return Boolean(replyTo?.messageId && replyTo.messageId.trim().length > 0);
}

function normalizeComparableMessageBody(body: string): string {
  return body.replace(/\r/g, "").trim();
}

function prunePendingLocalReplyHints(channelId: string, now = Date.now()): void {
  const existing = pendingLocalReplyHintsByChannel.get(channelId);
  if (!existing || existing.length === 0) return;
  const next = existing.filter((item) => now - item.enqueuedAt <= pendingLocalReplyHintMaxAgeMS);
  if (next.length === 0) {
    pendingLocalReplyHintsByChannel.delete(channelId);
    return;
  }
  pendingLocalReplyHintsByChannel.set(channelId, next.slice(-pendingLocalReplyHintMaxPerChannel));
}

function enqueuePendingLocalReplyHint(params: {
  channelId: string;
  authorUID: string;
  replyToMessageId: string;
  body: string;
}): void {
  const channelId = params.channelId.trim();
  const authorUID = params.authorUID.trim();
  const replyToMessageId = params.replyToMessageId.trim();
  if (!channelId || !authorUID || !replyToMessageId) return;
  prunePendingLocalReplyHints(channelId);
  const existing = pendingLocalReplyHintsByChannel.get(channelId) ?? [];
  const next = [
    ...existing,
    {
      authorUID,
      replyToMessageId,
      body: normalizeComparableMessageBody(params.body),
      enqueuedAt: Date.now()
    }
  ];
  pendingLocalReplyHintsByChannel.set(channelId, next.slice(-pendingLocalReplyHintMaxPerChannel));
}

function takePendingLocalReplyHint(channelId: string, authorUID: string, body: string): PendingLocalReplyHint | null {
  const normalizedChannelID = channelId.trim();
  const normalizedAuthorUID = authorUID.trim();
  if (!normalizedChannelID || !normalizedAuthorUID) return null;
  prunePendingLocalReplyHints(normalizedChannelID);
  const existing = pendingLocalReplyHintsByChannel.get(normalizedChannelID);
  if (!existing || existing.length === 0) return null;

  const normalizedBody = normalizeComparableMessageBody(body);
  let index = existing.findIndex((item) => item.authorUID === normalizedAuthorUID && item.body === normalizedBody);
  if (index === -1 && normalizedBody.length === 0) {
    index = existing.findIndex((item) => item.authorUID === normalizedAuthorUID);
  }
  if (index === -1) return null;

  const [hint] = existing.splice(index, 1);
  if (existing.length === 0) {
    pendingLocalReplyHintsByChannel.delete(normalizedChannelID);
  } else {
    pendingLocalReplyHintsByChannel.set(normalizedChannelID, existing);
  }
  return hint;
}

function withPendingLocalReplyHint(message: ChatMessage, channelMessages: ChatMessage[]): ChatMessage {
  if (hasReplyReference(message.replyTo)) return message;
  const hint = takePendingLocalReplyHint(message.channelId, message.authorUID, message.body);
  if (!hint) return message;

  const fallbackReference = channelMessages.find((item) => item.id === hint.replyToMessageId);
  const replyTo: MessageReplyReference = {
    messageId: hint.replyToMessageId,
    authorUID: fallbackReference?.authorUID ?? null,
    authorDisplayName: null,
    previewText: fallbackReference ? normalizeReplyPreviewText(fallbackReference.body) : null,
    isUnavailable: !fallbackReference
  };
  return {
    ...message,
    replyTo
  };
}

function mergeChannelMessage(existing: ChatMessage, incoming: ChatMessage): ChatMessage {
  return {
    ...existing,
    ...incoming,
    replyTo: hasReplyReference(incoming.replyTo) ? incoming.replyTo : existing.replyTo ?? null,
    mentions: incoming.mentions && incoming.mentions.length > 0 ? incoming.mentions : existing.mentions,
    linkPreviews:
      incoming.linkPreviews && incoming.linkPreviews.length > 0 ? incoming.linkPreviews : existing.linkPreviews,
    attachments: incoming.attachments && incoming.attachments.length > 0 ? incoming.attachments : existing.attachments,
    actionPermissions: incoming.actionPermissions ?? existing.actionPermissions,
    permalink: incoming.permalink ?? existing.permalink ?? null
  };
}

function normalizeLinkPreview(input: unknown): LinkPreview | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const url = String(payload.url ?? "").trim();
  if (!url) return null;
  return {
    url,
    title: payload.title ? String(payload.title) : null,
    description: payload.description ? String(payload.description) : null,
    siteName: payload.site_name ? String(payload.site_name) : payload.siteName ? String(payload.siteName) : null,
    imageUrl: payload.image_url ? String(payload.image_url) : payload.imageUrl ? String(payload.imageUrl) : null
  };
}

function normalizeLinkPreviews(input: unknown): LinkPreview[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const previews = input
    .map((item) => normalizeLinkPreview(item))
    .filter((item): item is LinkPreview => item !== null);
  return previews.length > 0 ? previews : undefined;
}

function normalizeMessageAttachment(input: unknown): MessageAttachment | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const attachmentId = String(payload.attachment_id ?? "").trim();
  const url = String(payload.url ?? "").trim();
  if (!attachmentId || !url) return null;
  return {
    attachmentId,
    fileName: String(payload.file_name ?? "image.png"),
    url,
    width: Number(payload.width ?? 0),
    height: Number(payload.height ?? 0),
    contentType: String(payload.content_type ?? "application/octet-stream"),
    bytes: Number(payload.bytes ?? 0)
  };
}

function normalizeMessageAttachments(input: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const attachments = input
    .map((item) => normalizeMessageAttachment(item))
    .filter((item): item is MessageAttachment => item !== null);
  return attachments.length > 0 ? attachments : undefined;
}

function normalizeMessageMentionRange(input: unknown): { start: number; end: number } | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const start = Number(payload.start ?? payload.start_index ?? payload.startIndex);
  const end = Number(payload.end ?? payload.end_index ?? payload.endIndex);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const normalizedStart = Math.max(0, Math.trunc(start));
  const normalizedEnd = Math.max(normalizedStart, Math.trunc(end));
  return {
    start: normalizedStart,
    end: normalizedEnd
  };
}

function normalizeMessageMention(input: unknown): MessageMention | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const rawType = String(payload.type ?? "").trim().toLowerCase();
  if (rawType !== "user" && rawType !== "channel") return null;
  return {
    type: rawType,
    token: readOptionalString(payload, ["token", "raw_token", "rawToken"]),
    targetId: readOptionalString(payload, ["target_id", "targetId", "user_uid", "userUID"]),
    displayText: readOptionalString(payload, ["display_text", "displayText", "label", "name"]),
    range: normalizeMessageMentionRange(payload.range ?? payload.position ?? payload.offsets)
  };
}

function normalizeMessageMentions(input: unknown): MessageMention[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const mentions = input
    .map((item) => normalizeMessageMention(item))
    .filter((item): item is MessageMention => item !== null);
  return mentions.length > 0 ? mentions : undefined;
}

function readUnknown(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (!(key in source)) continue;
    return source[key];
  }
  return undefined;
}

function readOptionalString(source: Record<string, unknown>, keys: string[]): string | null {
  const value = readUnknown(source, keys);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function readOptionalBoolean(source: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (!(key in source)) continue;
    return Boolean(source[key]);
  }
  return undefined;
}

function normalizeMessageActionPermissions(input: unknown): MessageActionPermissions | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const payload = input as Record<string, unknown>;
  const canReact = readOptionalBoolean(payload, ["can_react", "canReact", "react"]);
  const canReply = readOptionalBoolean(payload, ["can_reply", "canReply", "reply"]);
  const canMarkUnread = readOptionalBoolean(payload, ["can_mark_unread", "canMarkUnread", "mark_unread", "markUnread"]);
  const canPin = readOptionalBoolean(payload, ["can_pin", "canPin", "pin"]);
  const canDelete = readOptionalBoolean(payload, ["can_delete", "canDelete", "delete"]);
  if (
    typeof canReact === "undefined" &&
    typeof canReply === "undefined" &&
    typeof canMarkUnread === "undefined" &&
    typeof canPin === "undefined" &&
    typeof canDelete === "undefined"
  ) {
    return undefined;
  }
  return {
    canReact,
    canReply,
    canMarkUnread,
    canPin,
    canDelete
  };
}

function normalizeOpenGraphMetadata(input: OpenGraphMetadata): LinkPreview | null {
  const url = input.url.trim();
  if (!url) return null;
  const title = input.title?.trim() || null;
  const description = input.description?.trim() || null;
  const siteName = input.siteName?.trim() || null;
  const imageUrl = input.imageUrl?.trim() || null;
  if (!title && !description && !siteName && !imageUrl) return null;
  return {
    url,
    title,
    description,
    siteName,
    imageUrl
  };
}

function normalizeMessageBodyText(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean" || typeof input === "bigint") {
    return String(input);
  }
  if (input === null || typeof input === "undefined") {
    return "";
  }
  if (typeof input === "object") {
    const payload = input as Record<string, unknown>;
    const candidate = payload.text ?? payload.markdown ?? payload.value ?? payload.body;
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  try {
    return JSON.stringify(input);
  } catch (_error) {
    return String(input);
  }
}

function normalizeReplyPreviewText(input: unknown): string | null {
  const raw = normalizeMessageBodyText(input).replace(/\r/g, "");
  const collapsed = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  if (!collapsed) return null;
  return collapsed.length > 220 ? `${collapsed.slice(0, 219)}…` : collapsed;
}

function normalizeMessageReplyReference(input: unknown): MessageReplyReference | undefined {
  if (typeof input === "string" || typeof input === "number" || typeof input === "bigint") {
    const messageId = String(input).trim();
    if (!messageId) return undefined;
    return {
      messageId,
      authorUID: null,
      authorDisplayName: null,
      previewText: null,
      isUnavailable: false
    };
  }
  if (typeof input !== "object" || input === null) return undefined;

  const payload = input as Record<string, unknown>;
  const referencedPayloadRaw =
    readUnknown(payload, [
      "referenced_message",
      "referencedMessage",
      "in_reply_to",
      "inReplyTo",
      "reply_to_message",
      "replyToMessage",
      "original_message",
      "originalMessage",
      "message",
      "target_message",
      "targetMessage"
    ]) ?? null;
  const referencedPayload =
    typeof referencedPayloadRaw === "object" && referencedPayloadRaw !== null
      ? (referencedPayloadRaw as Record<string, unknown>)
      : null;

  const messageId =
    readOptionalString(payload, [
      "message_id",
      "messageId",
      "reply_to_message_id",
      "replyToMessageId",
      "in_reply_to_message_id",
      "inReplyToMessageId",
      "referenced_message_id",
      "referencedMessageId",
      "parent_message_id",
      "parentMessageId",
      "id"
    ]) ??
    (referencedPayload ? readOptionalString(referencedPayload, ["id", "message_id", "messageId"]) : null);
  if (!messageId) return undefined;

  const previewSource =
    readUnknown(payload, ["preview_text", "previewText", "excerpt", "snippet", "summary", "preview", "body", "text", "value"]) ??
    (referencedPayload
      ? readUnknown(referencedPayload, ["preview_text", "previewText", "excerpt", "snippet", "summary", "preview", "body", "text", "value"])
      : undefined);
  const unavailableFromReferenced =
    referencedPayload?.deleted === true ||
    referencedPayload?.is_deleted === true ||
    typeof referencedPayload?.deleted_at === "string" ||
    typeof referencedPayload?.deletedAt === "string";

  return {
    messageId,
    authorUID:
      readOptionalString(payload, ["author_uid", "authorUID", "user_uid", "userUID", "uid"]) ??
      (referencedPayload ? readOptionalString(referencedPayload, ["author_uid", "authorUID", "user_uid", "userUID"]) : null),
    authorDisplayName:
      readOptionalString(payload, ["author_display_name", "authorDisplayName", "display_name", "displayName", "author_name", "authorName"]) ??
      (referencedPayload
        ? readOptionalString(
            referencedPayload,
            ["author_display_name", "authorDisplayName", "display_name", "displayName", "author_name", "authorName"]
          )
        : null),
    previewText: normalizeReplyPreviewText(previewSource),
    isUnavailable:
      Boolean(payload.is_unavailable ?? payload.unavailable ?? payload.is_deleted ?? payload.deleted) ||
      typeof payload.deleted_at === "string" ||
      typeof payload.deletedAt === "string" ||
      unavailableFromReferenced
  };
}

function isSameLinkPreview(left: LinkPreview, right: LinkPreview): boolean {
  return (
    left.url === right.url &&
    left.title === right.title &&
    left.description === right.description &&
    left.siteName === right.siteName &&
    left.imageUrl === right.imageUrl
  );
}

function areLinkPreviewListsEqual(current: LinkPreview[] | undefined, next: LinkPreview[]): boolean {
  const normalizedCurrent = current ?? [];
  if (normalizedCurrent.length !== next.length) return false;
  return normalizedCurrent.every((item, index) => isSameLinkPreview(item, next[index]));
}

async function fetchLinkPreviewForURL(url: string): Promise<LinkPreview | null> {
  if (linkPreviewCacheByURL.has(url)) {
    return linkPreviewCacheByURL.get(url) ?? null;
  }

  const existingRequest = linkPreviewInFlightByURL.get(url);
  if (existingRequest) {
    return existingRequest;
  }

  if (typeof window === "undefined") {
    linkPreviewCacheByURL.set(url, null);
    return null;
  }

  const bridge = window.openchat?.metadata?.scrapeOpenGraph;
  if (!bridge) {
    linkPreviewCacheByURL.set(url, null);
    return null;
  }

  const request = bridge(url)
    .then((payload) => {
      const preview = payload ? normalizeOpenGraphMetadata(payload) : null;
      linkPreviewCacheByURL.set(url, preview);
      return preview;
    })
    .catch(() => {
      linkPreviewCacheByURL.set(url, null);
      return null;
    })
    .finally(() => {
      linkPreviewInFlightByURL.delete(url);
    });
  linkPreviewInFlightByURL.set(url, request);
  return request;
}

function normalizeIncomingMessage(payload: Record<string, unknown>): ChatMessage | null {
  const messagePayload = payload.message as Record<string, unknown> | undefined;
  if (!messagePayload) return null;
  const id = String(messagePayload.id ?? "");
  const channelID = String(messagePayload.channel_id ?? "");
  if (!id || !channelID) return null;
  const actionPermissionPayload = messagePayload.action_permissions ?? messagePayload.actionPermissions ?? messagePayload.permissions;
  const actionPermissions = normalizeMessageActionPermissions(actionPermissionPayload);
  const permalinkRaw = messagePayload.permalink ?? messagePayload.message_link ?? messagePayload.messageLink;
  const permalink = typeof permalinkRaw === "string" ? permalinkRaw.trim() : "";
  const replyReferencePayload =
    messagePayload.reply_to ??
    messagePayload.replyTo ??
    messagePayload.in_reply_to ??
    messagePayload.inReplyTo ??
    messagePayload.reply ??
    messagePayload.reply_to_message ??
    messagePayload.replyToMessage ??
    messagePayload.message_reference ??
    messagePayload.messageReference ??
    messagePayload.referenced_message ??
    messagePayload.referencedMessage ??
    messagePayload.reply_reference ??
    messagePayload.replyReference ??
    messagePayload.reply_to_message_id ??
    messagePayload.replyToMessageId ??
    messagePayload.in_reply_to_message_id ??
    messagePayload.inReplyToMessageId ??
    messagePayload.referenced_message_id ??
    messagePayload.referencedMessageId ??
    messagePayload.parent_message_id ??
    messagePayload.parentMessageId;
  const replyTo = normalizeMessageReplyReference(replyReferencePayload);
  return {
    id,
    channelId: channelID,
    authorUID: String(messagePayload.author_uid ?? "uid_unknown"),
    body: normalizeMessageBodyText(messagePayload.body),
    createdAt: String(messagePayload.created_at ?? new Date().toISOString()),
    replyTo: replyTo ?? null,
    mentions: normalizeMessageMentions(messagePayload.mentions),
    linkPreviews: normalizeLinkPreviews(messagePayload.link_previews ?? messagePayload.linkPreviews),
    attachments: normalizeMessageAttachments(messagePayload.attachments),
    permalink: permalink || null,
    actionPermissions
  };
}

function normalizePresenceMember(input: unknown): ChannelPresenceMember | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const userUID = String(payload.user_uid ?? "").trim();
  if (!userUID) return null;
  return {
    clientId: String(payload.client_id ?? "").trim(),
    userUID,
    deviceID: String(payload.device_id ?? "").trim()
  };
}

function normalizeRealtimeProfile(input: unknown): SyncedUserProfile | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const userUID = String(payload.user_uid ?? "").trim();
  if (!userUID) return null;
  return {
    userUID,
    displayName: String(payload.display_name ?? userUID),
    avatarMode: payload.avatar_mode === "uploaded" ? "uploaded" : "generated",
    avatarPresetId: payload.avatar_preset_id ? String(payload.avatar_preset_id) : null,
    avatarAssetId: payload.avatar_asset_id ? String(payload.avatar_asset_id) : null,
    avatarUrl: payload.avatar_url ? String(payload.avatar_url) : null,
    profileVersion: Number(payload.profile_version ?? 0),
    updatedAt: String(payload.updated_at ?? new Date().toISOString())
  };
}

function chunkList<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0 || items.length === 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function normalizeUserUIDList(input: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  input.forEach((value) => {
    const userUID = value.trim();
    if (!userUID) return;
    if (seen.has(userUID)) return;
    seen.add(userUID);
    normalized.push(userUID);
  });
  return normalized;
}

function mentionTargetUserUIDs(message: ChatMessage): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  (message.mentions ?? []).forEach((mention) => {
    if (mention.type !== "user") return;
    const targetID = mention.targetId?.trim() ?? "";
    if (!targetID || seen.has(targetID)) return;
    seen.add(targetID);
    targets.push(targetID);
  });
  return targets;
}

function isProfileSyncUnsupportedError(error: unknown): boolean {
  if (!(error instanceof ProfileRequestError)) return false;
  return error.status === 404 || error.status === 405 || error.status === 501;
}

function presenceMemberKey(member: ChannelPresenceMember): string {
  if (member.clientId) return `client:${member.clientId}`;
  const userUID = member.userUID || "uid_unknown";
  const deviceID = member.deviceID || "device_unknown";
  return `user:${userUID}|device:${deviceID}`;
}

function firstTextChannel(groups: ChannelGroup[]): Channel | null {
  for (const group of groups) {
    for (const channel of group.channels) {
      if (channel.type === "text") {
        return channel;
      }
    }
  }
  return null;
}

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

function normalizeMentionToken(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function messageHasAudienceMention(message: ChatMessage): boolean {
  const mentions = message.mentions ?? [];
  for (const mention of mentions) {
    if (mention.type !== "channel") continue;
    const token = normalizeMentionToken(mention.token ?? mention.targetId ?? mention.displayText ?? "");
    if (mentionAudienceTokens.has(token)) {
      return true;
    }
  }
  return false;
}

function messageMentionsCurrentUser(message: ChatMessage, userUID: string): boolean {
  const normalizedUID = userUID.trim().toLowerCase();
  if (!normalizedUID) return false;
  const mentions = message.mentions ?? [];
  for (const mention of mentions) {
    if (mention.type !== "user") continue;
    const targetId = (mention.targetId ?? "").trim().toLowerCase();
    const token = normalizeMentionToken(mention.token ?? "");
    if (targetId === normalizedUID) return true;
    if (token === `@${normalizedUID}`) return true;
  }
  if (mentions.length === 0) {
    const normalizedBody = message.body.toLowerCase();
    return normalizedBody.includes(`@${normalizedUID}`) || normalizedBody.includes(normalizedUID);
  }
  return false;
}

function messageCountsAsMentionForUser(message: ChatMessage, userUID: string): boolean {
  return messageMentionsCurrentUser(message, userUID) || messageHasAudienceMention(message);
}

function messageCursorIndex(messages: ChatMessage[], messageID: string | null | undefined): number {
  const normalizedMessageID = messageID?.trim() ?? "";
  if (!normalizedMessageID) return -1;
  return messages.findIndex((message) => message.id === normalizedMessageID);
}

function computeChannelMentionUnread(messages: ChatMessage[], currentUID: string, readCursorIndex: number): number {
  if (!currentUID.trim()) return 0;
  let total = 0;
  messages.forEach((message, index) => {
    if (index <= readCursorIndex) return;
    if (message.authorUID === currentUID) return;
    if (messageCountsAsMentionForUser(message, currentUID)) {
      total += 1;
    }
  });
  return total;
}

function clearReconnectTimer(serverId: string): void {
  const timer = reconnectTimersByServer.get(serverId);
  if (!timer) return;
  clearTimeout(timer);
  reconnectTimersByServer.delete(serverId);
}

function typingMemberTimerKey(channelId: string, member: ChannelPresenceMember): string {
  return `${channelId}|${presenceMemberKey(member)}`;
}

const CHAT_NOTIFICATION_PREFS_STORAGE_KEY = "openchat.chat-notification-prefs.v1";

function readPersistedMutedServerIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_NOTIFICATION_PREFS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { mutedServerIds?: unknown };
    if (!Array.isArray(parsed.mutedServerIds)) return [];
    return parsed.mutedServerIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch (_error) {
    return [];
  }
}

function writePersistedMutedServerIds(serverMutedById: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  const mutedServerIds = Object.entries(serverMutedById)
    .filter(([, muted]) => muted)
    .map(([serverId]) => serverId);
  try {
    window.localStorage.setItem(CHAT_NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify({ mutedServerIds }));
  } catch (_error) {
    // Notification preferences persistence is best-effort.
  }
}

export const useChatStore = defineStore("chat", {
  state: (): ChatStoreState => ({
    groupsByServer: {},
    membersByServer: {},
    presenceByChannel: {},
    typingByChannel: {},
    messagesByChannel: {},
    readAckByChannel: {},
    loadingByServer: {},
    loadingMessagesByChannel: {},
    sendingByChannel: {},
    realtimeByServer: {},
    subscribedChannelByServer: {},
    unreadByChannel: {},
    mentionUnreadByChannel: {},
    currentUserUIDByServer: {},
    profilesByServer: {},
    profileSyncStateByServer: {},
    profileSyncAvailableByServer: {},
    serverMutedById: {}
  }),
  getters: {
    groupsFor:
      (state) =>
      (serverId: string): ChannelGroup[] => {
        return state.groupsByServer[serverId] ?? [];
      },
    membersFor:
      (state) =>
      (serverId: string): MemberItem[] => {
        return state.membersByServer[serverId] ?? [];
      },
    profilesForServer:
      (state) =>
      (serverId: string): Record<string, SyncedUserProfile> => {
        return state.profilesByServer[serverId] ?? {};
      },
    profileForUser:
      (state) =>
      (serverId: string, userUID: string): SyncedUserProfile | null => {
        const profiles = state.profilesByServer[serverId];
        if (!profiles) return null;
        return profiles[userUID] ?? null;
      },
    channelPresenceFor:
      (state) =>
      (channelId: string): ChannelPresenceMember[] => {
        return state.presenceByChannel[channelId] ?? [];
      },
    typingForChannel:
      (state) =>
      (channelId: string): ChannelPresenceMember[] => {
        return state.typingByChannel[channelId] ?? [];
      },
    messagesFor:
      (state) =>
      (channelId: string): ChatMessage[] => {
        return state.messagesByChannel[channelId] ?? [];
      },
    isServerLoading:
      (state) =>
      (serverId: string): boolean => {
        return state.loadingByServer[serverId] ?? false;
      },
    isMessagesLoading:
      (state) =>
      (channelId: string): boolean => {
        return state.loadingMessagesByChannel[channelId] ?? false;
      },
    isSendingInChannel:
      (state) =>
      (channelId: string): boolean => {
        return state.sendingByChannel[channelId] ?? false;
      },
    subscribedChannelFor:
      (state) =>
      (serverId: string): string | null => {
        return state.subscribedChannelByServer[serverId] ?? null;
      },
    unreadCountForChannel:
      (state) =>
      (channelId: string): number => {
        return state.unreadByChannel[channelId] ?? 0;
      },
    mentionCountForChannel:
      (state) =>
      (channelId: string): number => {
        return state.mentionUnreadByChannel[channelId] ?? 0;
      },
    unreadCountForServer:
      (state) =>
      (serverId: string): number => {
        const groups = state.groupsByServer[serverId] ?? [];
        let total = 0;
        groups.forEach((group) => {
          group.channels.forEach((channel) => {
            if (channel.type !== "text") return;
            total += state.unreadByChannel[channel.id] ?? 0;
          });
        });
        return total;
      },
    mentionCountForServer:
      (state) =>
      (serverId: string): number => {
        const groups = state.groupsByServer[serverId] ?? [];
        let total = 0;
        groups.forEach((group) => {
          group.channels.forEach((channel) => {
            if (channel.type !== "text") return;
            total += state.mentionUnreadByChannel[channel.id] ?? 0;
          });
        });
        return total;
      },
    realtimeStateFor:
      (state) =>
      (serverId: string): ServerRealtimeState => {
        return (
          state.realtimeByServer[serverId] ?? {
            connected: false,
            reconnecting: false,
            reconnectAttempt: 0,
            lastConnectedAt: null,
            errorMessage: null
          }
        );
      },
    serverMutedFor:
      (state) =>
      (serverId: string): boolean => {
        return state.serverMutedById[serverId] ?? false;
      }
  },
  actions: {
    hydrateNotificationPreferences(): void {
      const mutedServerIds = readPersistedMutedServerIds();
      const next: Record<string, boolean> = {};
      mutedServerIds.forEach((serverId) => {
        next[serverId] = true;
      });
      this.serverMutedById = next;
    },
    persistNotificationPreferences(): void {
      writePersistedMutedServerIds(this.serverMutedById);
    },
    setServerMuted(serverId: string, muted: boolean): void {
      if (!serverId.trim()) return;
      if (muted) {
        this.serverMutedById[serverId] = true;
      } else {
        delete this.serverMutedById[serverId];
      }
      this.persistNotificationPreferences();
    },
    toggleServerMuted(serverId: string): void {
      this.setServerMuted(serverId, !this.serverMutedById[serverId]);
    },
    async loadServerData(params: {
      serverId: string;
      backendUrl: string;
      userUID: string;
      deviceID: string;
    }): Promise<string | null> {
      this.loadingByServer[params.serverId] = true;
      this.ensureRealtimeState(params.serverId);
      try {
        const [groups, members] = await Promise.all([
          fetchChannelGroups(params.backendUrl, params.serverId),
          fetchMembers(params.backendUrl, params.serverId)
        ]);
        this.groupsByServer[params.serverId] = groups;
        this.membersByServer[params.serverId] = members;
        groups.forEach((group) => {
          group.channels.forEach((channel) => {
            if (channel.type !== "text") return;
            const currentUnread = this.unreadByChannel[channel.id] ?? 0;
            this.unreadByChannel[channel.id] = channel.unreadCount ?? currentUnread;
          });
        });
        await this.connectRealtime(params);
        void this.ensureProfilesForUIDs({
          serverId: params.serverId,
          backendUrl: params.backendUrl,
          userUID: params.userUID,
          deviceID: params.deviceID,
          targetUserUIDs: [params.userUID]
        });
        return firstTextChannel(groups)?.id ?? null;
      } finally {
        this.loadingByServer[params.serverId] = false;
      }
    },
    async loadMessages(params: {
      serverId: string;
      backendUrl: string;
      channelId: string;
      userUID: string;
      deviceID: string;
    }): Promise<void> {
      if (!params.channelId) return;
      this.loadingMessagesByChannel[params.channelId] = true;
      try {
        const messages = await fetchMessages(params.backendUrl, params.channelId, 150);
        this.messagesByChannel[params.channelId] = messages;
        try {
          const readAck = await fetchChannelReadAck({
            backendUrl: params.backendUrl,
            channelId: params.channelId,
            userUID: params.userUID,
            deviceID: params.deviceID
          });
          this.readAckByChannel[params.channelId] = readAck;
        } catch (_error) {
          // Backward-compatible fallback for servers without read-ack endpoints.
        }
        this.recomputeMentionUnreadForChannel(params.serverId, params.channelId);
        void this.hydrateLinkPreviewsForMessages(params.channelId, messages);
        void this.ensureProfilesForUIDs({
          serverId: params.serverId,
          backendUrl: params.backendUrl,
          userUID: params.userUID,
          deviceID: params.deviceID,
          targetUserUIDs: messages.flatMap((message) => {
            const mentionTargets = mentionTargetUserUIDs(message);
            if (message.replyTo?.authorUID) {
              return [message.authorUID, message.replyTo.authorUID, ...mentionTargets];
            }
            return [message.authorUID, ...mentionTargets];
          })
        });
      } finally {
        this.loadingMessagesByChannel[params.channelId] = false;
      }
    },
    async sendMessage(params: {
      backendUrl: string;
      channelId: string;
      body: string;
      attachments?: File[];
      replyToMessageId?: string | null;
      userUID: string;
      deviceID: string;
      maxMessageBytes?: number | null;
      maxUploadBytes?: number | null;
    }): Promise<void> {
      this.sendingByChannel[params.channelId] = true;
      const replyToMessageId = params.replyToMessageId?.trim() ?? "";
      if (replyToMessageId) {
        enqueuePendingLocalReplyHint({
          channelId: params.channelId,
          authorUID: params.userUID,
          replyToMessageId,
          body: params.body
        });
      }
      try {
        const createdMessage = await createMessage(params);
        const existing = this.messagesByChannel[createdMessage.channelId] ?? [];
        const fallbackReplyMessageId = replyToMessageId;
        const fallbackReference = fallbackReplyMessageId ? existing.find((item) => item.id === fallbackReplyMessageId) : null;
        const messageWithFallback: ChatMessage =
          createdMessage.replyTo || !fallbackReplyMessageId
            ? createdMessage
            : {
                ...createdMessage,
                replyTo: {
                  messageId: fallbackReplyMessageId,
                  authorUID: fallbackReference?.authorUID ?? null,
                  authorDisplayName: null,
                  previewText: fallbackReference ? normalizeReplyPreviewText(fallbackReference.body) : null,
                  isUnavailable: !fallbackReference
                }
              };
        const message = withPendingLocalReplyHint(messageWithFallback, existing);
        const existingForChannel = this.messagesByChannel[message.channelId] ?? [];
        const existingIndex = existingForChannel.findIndex((item) => item.id === message.id);
        if (existingIndex === -1) {
          this.messagesByChannel[message.channelId] = [...existingForChannel, message];
          void this.hydrateLinkPreviewsForMessages(message.channelId, [message]);
        } else {
          const nextMessages = [...existingForChannel];
          nextMessages[existingIndex] = mergeChannelMessage(existingForChannel[existingIndex], message);
          this.messagesByChannel[message.channelId] = nextMessages;
        }
      } finally {
        this.sendingByChannel[params.channelId] = false;
      }
    },
    async deleteMessage(params: {
      backendUrl: string;
      channelId: string;
      messageId: string;
      userUID: string;
      deviceID: string;
    }): Promise<void> {
      await deleteMessageRequest(params);
      const existing = this.messagesByChannel[params.channelId] ?? [];
      if (existing.length === 0) return;
      this.messagesByChannel[params.channelId] = existing.filter((message) => message.id !== params.messageId);
    },
    setMessageLinkPreviews(channelId: string, messageId: string, previews: LinkPreview[]): void {
      const messages = this.messagesByChannel[channelId];
      if (!messages || messages.length === 0) return;
      const messageIndex = messages.findIndex((message) => message.id === messageId);
      if (messageIndex === -1) return;
      const existingMessage = messages[messageIndex];
      if (areLinkPreviewListsEqual(existingMessage.linkPreviews, previews)) return;
      const nextMessage: ChatMessage = {
        ...existingMessage,
        linkPreviews: previews.length > 0 ? previews : undefined
      };
      const nextMessages = [...messages];
      nextMessages[messageIndex] = nextMessage;
      this.messagesByChannel[channelId] = nextMessages;
    },
    async hydrateLinkPreviewsForMessages(channelId: string, messages: ChatMessage[]): Promise<void> {
      if (messages.length === 0) return;
      for (const message of messages) {
        if (message.linkPreviews && message.linkPreviews.length > 0) {
          continue;
        }
        const urls = extractMessageURLs(message.body, maxLinkPreviewsPerMessage);
        if (urls.length === 0) continue;
        const previews = (await Promise.all(urls.map((url) => fetchLinkPreviewForURL(url)))).filter(
          (preview): preview is LinkPreview => preview !== null
        );
        this.setMessageLinkPreviews(channelId, message.id, previews);
      }
    },
    ensureProfileSyncState(serverId: string): void {
      if (!this.profileSyncStateByServer[serverId]) {
        this.profileSyncStateByServer[serverId] = {
          syncing: false,
          lastSyncedAt: null,
          errorMessage: null
        };
      }
    },
    setProfileSyncAvailability(serverId: string, available: boolean): void {
      this.profileSyncAvailableByServer[serverId] = available;
    },
    profileSyncDisabled(serverId: string): boolean {
      return this.profileSyncAvailableByServer[serverId] === false;
    },
    upsertProfiles(serverId: string, profiles: SyncedUserProfile[]): void {
      if (profiles.length === 0) return;
      const existing = this.profilesByServer[serverId] ?? {};
      const next: Record<string, SyncedUserProfile> = { ...existing };
      profiles.forEach((profile) => {
        const current = next[profile.userUID];
        if (current && current.profileVersion > profile.profileVersion) return;
        next[profile.userUID] = profile;
      });
      this.profilesByServer[serverId] = next;
    },
    async ensureProfilesForUIDs(params: {
      serverId: string;
      backendUrl: string;
      userUID: string;
      deviceID: string;
      targetUserUIDs: string[];
    }): Promise<void> {
      if (this.profileSyncDisabled(params.serverId)) return;
      const normalizedUIDs = normalizeUserUIDList(params.targetUserUIDs);
      if (normalizedUIDs.length === 0) return;

      const knownProfiles = this.profilesByServer[params.serverId] ?? {};
      const missingUIDs = normalizedUIDs.filter((userUID) => !knownProfiles[userUID]);
      if (missingUIDs.length === 0) return;

      const chunks = chunkList(missingUIDs, profileBatchLimit);
      for (const chunk of chunks) {
        try {
          const profiles = await fetchProfilesBatch({
            backendUrl: params.backendUrl,
            userUID: params.userUID,
            deviceID: params.deviceID,
            targetUserUIDs: chunk
          });
          this.upsertProfiles(params.serverId, profiles);
          this.setProfileSyncAvailability(params.serverId, true);
        } catch (error) {
          if (isProfileSyncUnsupportedError(error)) {
            this.setProfileSyncAvailability(params.serverId, false);
          }
          return;
        }
      }
    },
    async ensureProfilesFromRealtime(serverId: string, targetUserUIDs: string[]): Promise<void> {
      const realtimeParams = realtimeConnectParamsByServer.get(serverId);
      if (!realtimeParams) return;
      await this.ensureProfilesForUIDs({
        serverId,
        backendUrl: realtimeParams.backendUrl,
        userUID: realtimeParams.userUID,
        deviceID: realtimeParams.deviceID,
        targetUserUIDs
      });
    },
    async syncLocalProfile(params: LocalProfileSyncInput): Promise<void> {
      this.ensureProfileSyncState(params.serverId);
      if (this.profileSyncDisabled(params.serverId)) return;

      const syncState = this.profileSyncStateByServer[params.serverId];
      if (syncState.syncing) return;
      syncState.syncing = true;
      syncState.errorMessage = null;
      try {
        const displayName = params.displayName.trim() || "Unknown User";
        let currentProfile = this.profileForUser(params.serverId, params.userUID);
        if (!currentProfile) {
          currentProfile = await fetchMyProfile({
            backendUrl: params.backendUrl,
            userUID: params.userUID,
            deviceID: params.deviceID
          });
          this.upsertProfiles(params.serverId, [currentProfile]);
          this.setProfileSyncAvailability(params.serverId, true);
        }

        const desiredAvatarMode: AvatarMode =
          params.avatarMode === "uploaded" && params.avatarImageDataUrl ? "uploaded" : "generated";
        const desiredAvatarPresetId = params.avatarPresetId.trim() || "preset_01";
        let desiredAvatarAssetId: string | null = null;
        let shouldUpdate = false;

        if (currentProfile.displayName !== displayName) {
          shouldUpdate = true;
        }

        if (desiredAvatarMode === "generated") {
          if (currentProfile.avatarMode !== "generated" || currentProfile.avatarPresetId !== desiredAvatarPresetId) {
            shouldUpdate = true;
          }
        } else {
          if (!params.avatarImageDataUrl) {
            return;
          }
          if (currentProfile.avatarMode !== "uploaded" || !currentProfile.avatarAssetId) {
            const uploadedAsset = await uploadProfileAvatar({
              backendUrl: params.backendUrl,
              userUID: params.userUID,
              deviceID: params.deviceID,
              avatarImageDataUrl: params.avatarImageDataUrl
            });
            desiredAvatarAssetId = uploadedAsset.avatarAssetId;
            shouldUpdate = true;
          } else {
            desiredAvatarAssetId = currentProfile.avatarAssetId;
          }
        }

        if (!shouldUpdate) {
          syncState.lastSyncedAt = new Date().toISOString();
          return;
        }

        const updated = await updateMyProfile({
          backendUrl: params.backendUrl,
          userUID: params.userUID,
          deviceID: params.deviceID,
          expectedVersion: currentProfile.profileVersion,
          input: {
            displayName,
            avatarMode: desiredAvatarMode,
            avatarPresetId: desiredAvatarMode === "generated" ? desiredAvatarPresetId : null,
            avatarAssetId: desiredAvatarMode === "uploaded" ? desiredAvatarAssetId : null
          }
        });
        this.upsertProfiles(params.serverId, [updated]);
        this.setProfileSyncAvailability(params.serverId, true);
        syncState.lastSyncedAt = new Date().toISOString();
      } catch (error) {
        if (isProfileSyncUnsupportedError(error)) {
          this.setProfileSyncAvailability(params.serverId, false);
          syncState.errorMessage = null;
          return;
        }
        syncState.errorMessage = (error as Error).message;
      } finally {
        syncState.syncing = false;
      }
    },
    async connectRealtime(params: {
      serverId: string;
      backendUrl: string;
      userUID: string;
      deviceID: string;
    }): Promise<void> {
      const existingSocket = socketsByServer.get(params.serverId);
      if (existingSocket && (existingSocket.readyState === WebSocket.OPEN || existingSocket.readyState === WebSocket.CONNECTING)) {
        return;
      }

      this.ensureRealtimeState(params.serverId);
      clearReconnectTimer(params.serverId);
      this.currentUserUIDByServer[params.serverId] = params.userUID;
      realtimeConnectParamsByServer.set(params.serverId, params);
      const url = getRealtimeURL(params.backendUrl, params.userUID, params.deviceID);
      const socket = new WebSocket(url);
      socketsByServer.set(params.serverId, socket);
      intentionallyClosedSockets.delete(params.serverId);

      socket.addEventListener("open", () => {
        this.ensureRealtimeState(params.serverId);
        this.realtimeByServer[params.serverId].connected = true;
        this.realtimeByServer[params.serverId].reconnecting = false;
        this.realtimeByServer[params.serverId].reconnectAttempt = 0;
        this.realtimeByServer[params.serverId].lastConnectedAt = new Date().toISOString();
        this.realtimeByServer[params.serverId].errorMessage = null;
        const subscribedChannel = this.subscribedChannelByServer[params.serverId];
        if (subscribedChannel) {
          sendRealtime(socket, {
            type: "chat.subscribe",
            request_id: `sub_${Date.now()}`,
            payload: { channel_id: subscribedChannel }
          });
        }
      });

      socket.addEventListener("message", (event: MessageEvent<string>) => {
        const envelope = parseEnvelope(event.data);
        if (!envelope) return;
        this.handleRealtimeEnvelope(params.serverId, envelope);
      });

      socket.addEventListener("close", () => {
        this.ensureRealtimeState(params.serverId);
        this.realtimeByServer[params.serverId].connected = false;
        if (!intentionallyClosedSockets.has(params.serverId)) {
          this.scheduleRealtimeReconnect(params.serverId);
        } else {
          this.realtimeByServer[params.serverId].reconnecting = false;
          this.realtimeByServer[params.serverId].reconnectAttempt = 0;
          this.realtimeByServer[params.serverId].errorMessage = null;
          intentionallyClosedSockets.delete(params.serverId);
        }
        socketsByServer.delete(params.serverId);
      });

      socket.addEventListener("error", () => {
        this.ensureRealtimeState(params.serverId);
        this.realtimeByServer[params.serverId].errorMessage = "Realtime transport error. Waiting to reconnect.";
      });
    },
    subscribeToChannel(serverId: string, channelId: string): void {
      this.subscribedChannelByServer[serverId] = channelId;
      this.presenceByChannel[channelId] = [];
      this.clearTypingForChannel(channelId);
      this.markChannelRead(channelId);
      void this.syncReadAckForChannel({
        serverId,
        channelId
      });
      const socket = socketsByServer.get(serverId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendRealtime(socket, {
        type: "chat.subscribe",
        request_id: `sub_${Date.now()}`,
        payload: { channel_id: channelId }
      });
    },
    unsubscribeFromChannel(serverId: string, channelId: string): void {
      const activeSubscribed = this.subscribedChannelByServer[serverId];
      if (activeSubscribed === channelId) {
        this.subscribedChannelByServer[serverId] = null;
      }
      this.presenceByChannel[channelId] = [];
      this.clearTypingForChannel(channelId);
      pendingLocalReplyHintsByChannel.delete(channelId);
      const socket = socketsByServer.get(serverId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendRealtime(socket, {
        type: "chat.unsubscribe",
        request_id: `unsub_${Date.now()}`,
        payload: { channel_id: channelId }
      });
    },
    sendTyping(serverId: string, channelId: string, isTyping: boolean): void {
      if (!channelId) return;
      const socket = socketsByServer.get(serverId);
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendRealtime(socket, {
        type: "chat.typing.update",
        request_id: `typing_${Date.now()}`,
        payload: {
          channel_id: channelId,
          is_typing: isTyping
        }
      });
    },
    handleRealtimeEnvelope(serverId: string, envelope: RealtimeEnvelope): void {
      if (envelope.type === "profile_updated") {
        const profile = normalizeRealtimeProfile(envelope.payload);
        if (!profile) return;
        this.upsertProfiles(serverId, [profile]);
        this.setProfileSyncAvailability(serverId, true);
        return;
      }
      if (envelope.type === "chat.message.created") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const message = normalizeIncomingMessage(payload);
        if (!message) return;
        const existing = this.messagesByChannel[message.channelId] ?? [];
        const messageWithHint = withPendingLocalReplyHint(message, existing);
        const existingIndex = existing.findIndex((item) => item.id === message.id);
        const resolvedMessage =
          existingIndex === -1 ? messageWithHint : mergeChannelMessage(existing[existingIndex], messageWithHint);
        if (existingIndex === -1) {
          this.messagesByChannel[message.channelId] = [...existing, resolvedMessage];
        } else {
          const nextMessages = [...existing];
          nextMessages[existingIndex] = resolvedMessage;
          this.messagesByChannel[message.channelId] = nextMessages;
        }
        void this.hydrateLinkPreviewsForMessages(resolvedMessage.channelId, [resolvedMessage]);
        const relatedUserUIDs = [resolvedMessage.authorUID];
        if (resolvedMessage.replyTo?.authorUID) {
          relatedUserUIDs.push(resolvedMessage.replyTo.authorUID);
        }
        relatedUserUIDs.push(...mentionTargetUserUIDs(resolvedMessage));
        void this.ensureProfilesFromRealtime(serverId, relatedUserUIDs);
        const subscribedChannel = this.subscribedChannelByServer[serverId];
        const channelIsActive = subscribedChannel === resolvedMessage.channelId;
        const windowVisible = isDocumentVisible();
        const currentUID = this.currentUserUIDByServer[serverId] ?? "";
        const isOwnMessage = Boolean(currentUID && resolvedMessage.authorUID === currentUID);
        const mentionForCurrentUser = !isOwnMessage && messageCountsAsMentionForUser(resolvedMessage, currentUID);
        if (!channelIsActive || !windowVisible) {
          this.incrementUnread(resolvedMessage.channelId);
          if (mentionForCurrentUser) {
            this.incrementMentionUnread(resolvedMessage.channelId);
          }
        } else {
          this.markChannelRead(resolvedMessage.channelId);
          void this.syncReadAckForChannel({
            serverId,
            channelId: resolvedMessage.channelId,
            lastReadMessageId: resolvedMessage.id
          });
        }
        void this.notifyIncomingMessage(serverId, resolvedMessage, channelIsActive);
        return;
      }
      if (envelope.type === "chat.read_ack.updated") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        const userUID = String(payload.user_uid ?? "").trim();
        const currentUID = this.currentUserUIDByServer[serverId] ?? "";
        if (!channelID || !userUID || !currentUID || userUID !== currentUID) return;
        const messages = this.messagesByChannel[channelID] ?? [];
        const incomingLastReadMessageID = String(payload.last_read_message_id ?? "").trim();
        const incomingCursorRaw = Number(payload.cursor_index);
        const incomingCursorIndex =
          Number.isFinite(incomingCursorRaw) && incomingCursorRaw >= 0 ? Math.trunc(incomingCursorRaw) : messageCursorIndex(messages, incomingLastReadMessageID);
        const existingReadAck = this.readAckByChannel[channelID];
        const existingCursorIndex =
          typeof existingReadAck?.cursorIndex === "number"
            ? existingReadAck.cursorIndex
            : messageCursorIndex(messages, existingReadAck?.lastReadMessageId);
        if (incomingCursorIndex < existingCursorIndex) return;
        this.readAckByChannel[channelID] = {
          channelId: channelID,
          userUID,
          lastReadMessageId: incomingLastReadMessageID || null,
          ackedAt: String(payload.acked_at ?? new Date().toISOString()),
          cursorIndex: incomingCursorIndex >= 0 ? incomingCursorIndex : null
        };
        this.recomputeMentionUnreadForChannel(serverId, channelID);
        return;
      }
      if (envelope.type === "chat.presence.snapshot") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        if (!channelID) return;
        const members = Array.isArray(payload.members)
          ? payload.members
              .map((item) => normalizePresenceMember(item))
              .filter((item): item is ChannelPresenceMember => item !== null)
          : [];
        this.presenceByChannel[channelID] = members;
        this.syncTypingMembersWithPresence(channelID, members);
        void this.ensureProfilesFromRealtime(
          serverId,
          members.map((member) => member.userUID)
        );
        return;
      }
      if (envelope.type === "chat.presence.joined") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        const member = normalizePresenceMember(payload.member);
        if (!channelID || !member) return;
        const existing = this.presenceByChannel[channelID] ?? [];
        const key = presenceMemberKey(member);
        if (existing.some((item) => presenceMemberKey(item) === key)) return;
        this.presenceByChannel[channelID] = [...existing, member];
        void this.ensureProfilesFromRealtime(serverId, [member.userUID]);
        return;
      }
      if (envelope.type === "chat.presence.left") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        const member = normalizePresenceMember(payload.member);
        if (!channelID || !member) return;
        const existing = this.presenceByChannel[channelID] ?? [];
        const leavingKey = presenceMemberKey(member);
        this.presenceByChannel[channelID] = existing.filter((item) => presenceMemberKey(item) !== leavingKey);
        this.removeTypingMember(channelID, member);
        return;
      }
      if (envelope.type === "chat.typing.updated") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const channelID = String(payload.channel_id ?? "").trim();
        const member = normalizePresenceMember(payload.member);
        if (!channelID || !member) return;
        const isTyping = Boolean(payload.is_typing);
        const currentUID = this.currentUserUIDByServer[serverId] ?? "";
        if (currentUID && member.userUID === currentUID) return;
        void this.ensureProfilesFromRealtime(serverId, [member.userUID]);
        if (isTyping) {
          this.upsertTypingMember(channelID, member);
          this.scheduleTypingExpiry(channelID, member);
        } else {
          this.removeTypingMember(channelID, member);
        }
        return;
      }
      if (envelope.type === "chat.error") {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        this.ensureRealtimeState(serverId);
        this.realtimeByServer[serverId].errorMessage = String(payload.message ?? "Realtime error");
      }
    },
    upsertTypingMember(channelId: string, member: ChannelPresenceMember): void {
      const existing = this.typingByChannel[channelId] ?? [];
      const key = presenceMemberKey(member);
      const next = existing.filter((item) => presenceMemberKey(item) !== key);
      next.push(member);
      this.typingByChannel[channelId] = next;
    },
    removeTypingMember(channelId: string, member: ChannelPresenceMember): void {
      const existing = this.typingByChannel[channelId] ?? [];
      if (existing.length === 0) return;
      const key = presenceMemberKey(member);
      this.typingByChannel[channelId] = existing.filter((item) => presenceMemberKey(item) !== key);
      this.clearTypingTimer(channelId, member);
    },
    scheduleTypingExpiry(channelId: string, member: ChannelPresenceMember): void {
      this.clearTypingTimer(channelId, member);
      const timerKey = typingMemberTimerKey(channelId, member);
      const timer = setTimeout(() => {
        typingTimersByMember.delete(timerKey);
        this.removeTypingMember(channelId, member);
      }, typingExpiryMS);
      typingTimersByMember.set(timerKey, timer);
    },
    clearTypingTimer(channelId: string, member: ChannelPresenceMember): void {
      const timerKey = typingMemberTimerKey(channelId, member);
      const timer = typingTimersByMember.get(timerKey);
      if (!timer) return;
      clearTimeout(timer);
      typingTimersByMember.delete(timerKey);
    },
    clearTypingForChannel(channelId: string): void {
      delete this.typingByChannel[channelId];
      const prefix = `${channelId}|`;
      for (const [timerKey, timer] of typingTimersByMember.entries()) {
        if (!timerKey.startsWith(prefix)) continue;
        clearTimeout(timer);
        typingTimersByMember.delete(timerKey);
      }
    },
    clearTypingForServer(serverId: string): void {
      const groups = this.groupsByServer[serverId] ?? [];
      groups.forEach((group) => {
        group.channels.forEach((channel) => {
          this.clearTypingForChannel(channel.id);
        });
      });
    },
    recomputeMentionUnreadForChannel(serverId: string, channelId: string): void {
      const currentUID = this.currentUserUIDByServer[serverId] ?? "";
      if (!channelId.trim() || !currentUID.trim()) {
        this.mentionUnreadByChannel[channelId] = 0;
        return;
      }
      const messages = this.messagesByChannel[channelId] ?? [];
      const readAck = this.readAckByChannel[channelId];
      const readCursorIndex =
        typeof readAck?.cursorIndex === "number"
          ? readAck.cursorIndex
          : messageCursorIndex(messages, readAck?.lastReadMessageId);
      this.mentionUnreadByChannel[channelId] = computeChannelMentionUnread(messages, currentUID, readCursorIndex);
    },
    async syncReadAckForChannel(params: {
      serverId: string;
      channelId: string;
      lastReadMessageId?: string | null;
    }): Promise<void> {
      const realtimeParams = realtimeConnectParamsByServer.get(params.serverId);
      if (!realtimeParams) return;
      const messages = this.messagesByChannel[params.channelId] ?? [];
      const fallbackLastMessageID = messages[messages.length - 1]?.id ?? "";
      const lastReadMessageID = params.lastReadMessageId?.trim() || fallbackLastMessageID;

      const existingReadAck = this.readAckByChannel[params.channelId];
      const existingCursorIndex =
        typeof existingReadAck?.cursorIndex === "number"
          ? existingReadAck.cursorIndex
          : messageCursorIndex(messages, existingReadAck?.lastReadMessageId);
      const nextCursorIndex = messageCursorIndex(messages, lastReadMessageID);
      if (nextCursorIndex >= existingCursorIndex) {
        this.readAckByChannel[params.channelId] = {
          channelId: params.channelId,
          userUID: realtimeParams.userUID,
          lastReadMessageId: lastReadMessageID || null,
          ackedAt: new Date().toISOString(),
          cursorIndex: nextCursorIndex >= 0 ? nextCursorIndex : null
        };
        this.recomputeMentionUnreadForChannel(params.serverId, params.channelId);
      }

      try {
        const response = await updateChannelReadAck({
          backendUrl: realtimeParams.backendUrl,
          channelId: params.channelId,
          userUID: realtimeParams.userUID,
          deviceID: realtimeParams.deviceID,
          lastReadMessageId: lastReadMessageID || null
        });
        this.readAckByChannel[params.channelId] = response.readAck;
        this.recomputeMentionUnreadForChannel(params.serverId, params.channelId);
      } catch (_error) {
        // Backward-compatible fallback for servers without read-ack endpoints.
      }
    },
    async fetchMentionCandidates(params: {
      serverId: string;
      channelId: string;
      query: string;
      limit?: number;
    }): Promise<MentionCandidate[]> {
      const realtimeParams = realtimeConnectParamsByServer.get(params.serverId);
      if (!realtimeParams) return [];
      try {
        return await resolveMentionCandidates({
          backendUrl: realtimeParams.backendUrl,
          channelId: params.channelId,
          query: params.query,
          userUID: realtimeParams.userUID,
          deviceID: realtimeParams.deviceID,
          limit: params.limit
        });
      } catch (_error) {
        return [];
      }
    },
    syncTypingMembersWithPresence(channelId: string, members: ChannelPresenceMember[]): void {
      const presenceKeys = new Set(members.map((member) => presenceMemberKey(member)));
      const typingMembers = this.typingByChannel[channelId] ?? [];
      const nextTypingMembers = typingMembers.filter((member) => presenceKeys.has(presenceMemberKey(member)));
      if (nextTypingMembers.length === typingMembers.length) {
        return;
      }
      this.typingByChannel[channelId] = nextTypingMembers;
      typingMembers.forEach((member) => {
        if (presenceKeys.has(presenceMemberKey(member))) return;
        this.clearTypingTimer(channelId, member);
      });
    },
    markChannelRead(channelId: string): void {
      this.unreadByChannel[channelId] = 0;
    },
    markChannelUnread(channelId: string, minUnread = 1): void {
      if (!channelId.trim()) return;
      const targetUnread = Number.isFinite(minUnread) ? Math.max(1, Math.trunc(minUnread)) : 1;
      this.unreadByChannel[channelId] = Math.max(targetUnread, this.unreadByChannel[channelId] ?? 0);
    },
    markChannelsRead(channelIds: string[]): void {
      channelIds.forEach((channelId) => {
        this.markChannelRead(channelId);
      });
    },
    incrementUnread(channelId: string): void {
      this.unreadByChannel[channelId] = (this.unreadByChannel[channelId] ?? 0) + 1;
    },
    incrementMentionUnread(channelId: string): void {
      this.mentionUnreadByChannel[channelId] = (this.mentionUnreadByChannel[channelId] ?? 0) + 1;
    },
    findChannelName(serverId: string, channelId: string): string {
      const groups = this.groupsByServer[serverId] ?? [];
      for (const group of groups) {
        const match = group.channels.find((channel) => channel.id === channelId);
        if (match) return match.name;
      }
      return channelId;
    },
    scheduleRealtimeReconnect(serverId: string): void {
      this.ensureRealtimeState(serverId);
      const params = realtimeConnectParamsByServer.get(serverId);
      if (!params) {
        this.realtimeByServer[serverId].reconnecting = false;
        this.realtimeByServer[serverId].errorMessage = "Realtime disconnected.";
        return;
      }
      clearReconnectTimer(serverId);
      const nextAttempt = this.realtimeByServer[serverId].reconnectAttempt + 1;
      this.realtimeByServer[serverId].reconnectAttempt = nextAttempt;
      this.realtimeByServer[serverId].reconnecting = true;
      const delay = reconnectBackoffMS[Math.min(nextAttempt - 1, reconnectBackoffMS.length - 1)];
      const seconds = Math.ceil(delay / 1000);
      this.realtimeByServer[serverId].errorMessage = `Realtime disconnected. Reconnecting in ${seconds}s...`;

      const timer = setTimeout(() => {
        reconnectTimersByServer.delete(serverId);
        void this.connectRealtime(params);
      }, delay);
      reconnectTimersByServer.set(serverId, timer);
    },
    async notifyIncomingMessage(serverId: string, message: ChatMessage, channelIsActive: boolean): Promise<void> {
      if (typeof window === "undefined" || typeof Notification === "undefined") return;
      const currentUID = this.currentUserUIDByServer[serverId] ?? "";
      if (currentUID && message.authorUID === currentUID) return;
      if (this.serverMutedById[serverId]) return;

      const windowVisible = isDocumentVisible();
      const isMention = messageCountsAsMentionForUser(message, currentUID);
      if (windowVisible && channelIsActive && !isMention) return;

      if (Notification.permission === "denied") return;
      if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
      }

      const channelName = this.findChannelName(serverId, message.channelId);
      const profile = this.profileForUser(serverId, message.authorUID);
      const authorName = profile?.displayName ?? message.authorUID;
      const title = `${authorName} in #${channelName}`;
      const trimmedBody = message.body.trim();
      let body = trimmedBody.length > 120 ? `${trimmedBody.slice(0, 117)}...` : trimmedBody;
      if (!body) {
        const attachmentCount = message.attachments?.length ?? 0;
        body = attachmentCount > 1 ? `Sent ${attachmentCount} attachments.` : attachmentCount === 1 ? "Sent an image." : "New message.";
      }
      const notification = new Notification(title, {
        body,
        tag: `openchat:${serverId}:${message.channelId}`,
        silent: true
      });
      notification.onclick = () => {
        if (typeof window !== "undefined") {
          window.focus();
        }
      };
    },
    disconnectServerRealtime(serverId: string): void {
      const socket = socketsByServer.get(serverId);
      clearReconnectTimer(serverId);
      if (socket) {
        intentionallyClosedSockets.add(serverId);
        socket.close();
        socketsByServer.delete(serverId);
      }
      this.ensureRealtimeState(serverId);
      this.realtimeByServer[serverId].connected = false;
      this.realtimeByServer[serverId].reconnecting = false;
      this.realtimeByServer[serverId].reconnectAttempt = 0;
      this.realtimeByServer[serverId].errorMessage = null;
      this.clearPresenceForServer(serverId);
      this.clearTypingForServer(serverId);
      realtimeConnectParamsByServer.delete(serverId);
    },
    clearServerData(serverId: string): void {
      const groups = this.groupsByServer[serverId] ?? [];
      const channelIds: string[] = [];
      groups.forEach((group) => {
        group.channels.forEach((channel) => {
          channelIds.push(channel.id);
        });
      });

      this.disconnectServerRealtime(serverId);
      delete this.groupsByServer[serverId];
      delete this.membersByServer[serverId];
      delete this.loadingByServer[serverId];
      delete this.subscribedChannelByServer[serverId];
      delete this.currentUserUIDByServer[serverId];
      delete this.profilesByServer[serverId];
      delete this.profileSyncStateByServer[serverId];
      delete this.profileSyncAvailableByServer[serverId];

      channelIds.forEach((channelId) => {
        delete this.messagesByChannel[channelId];
        delete this.readAckByChannel[channelId];
        delete this.presenceByChannel[channelId];
        delete this.typingByChannel[channelId];
        delete this.loadingMessagesByChannel[channelId];
        delete this.sendingByChannel[channelId];
        delete this.unreadByChannel[channelId];
        delete this.mentionUnreadByChannel[channelId];
      });

      delete this.serverMutedById[serverId];
      this.persistNotificationPreferences();
    },
    disconnectAllRealtime(): void {
      [...socketsByServer.keys()].forEach((serverId) => {
        this.disconnectServerRealtime(serverId);
      });
      this.presenceByChannel = {};
      this.typingByChannel = {};
      typingTimersByMember.forEach((timer) => {
        clearTimeout(timer);
      });
      typingTimersByMember.clear();
      reconnectTimersByServer.forEach((timer) => {
        clearTimeout(timer);
      });
      reconnectTimersByServer.clear();
      realtimeConnectParamsByServer.clear();
    },
    ensureRealtimeState(serverId: string): void {
      if (!this.realtimeByServer[serverId]) {
        this.realtimeByServer[serverId] = {
          connected: false,
          reconnecting: false,
          reconnectAttempt: 0,
          lastConnectedAt: null,
          errorMessage: null
        };
      }
    },
    clearPresenceForServer(serverId: string): void {
      const groups = this.groupsByServer[serverId] ?? [];
      groups.forEach((group) => {
        group.channels.forEach((channel) => {
          delete this.presenceByChannel[channel.id];
          this.clearTypingForChannel(channel.id);
        });
      });
    }
  }
});
