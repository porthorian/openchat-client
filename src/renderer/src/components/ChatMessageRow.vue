<script setup lang="ts">
import type { ChatMessage, LinkPreview, MessageAttachment, MessageMention } from "@renderer/types/chat";
import {
  formatMessageBody,
  type FormattedInlineSegment,
  type FormattedMessageBlock
} from "@renderer/utils/messageFormatting";
import { computed } from "vue";

const props = defineProps<{
  message: ChatMessage;
  isCompact: boolean;
  isMentionForCurrentUser: boolean;
  currentUserUID: string;
  userDisplayNamesByUID: Record<string, string>;
  channelNamesById: Record<string, string>;
  authorName: string;
  avatarText: string;
  avatarColor: string;
  avatarTextColor: string;
  avatarImageDataUrl: string | null;
  replyPreview?: {
    messageId: string;
    authorName: string;
    authorMention: string;
    previewText: string;
    isUnavailable: boolean;
    avatarText: string;
    avatarColor: string;
    avatarTextColor: string;
    avatarImageDataUrl: string | null;
  } | null;
}>();
const emit = defineEmits<{
  openImageLightbox: [attachment: MessageAttachment];
  openContextMenu: [event: MouseEvent];
}>();

type MentionInlineSegment = {
  kind: "mention";
  label: string;
  mentionType: "user" | "channel";
  isCurrentUser: boolean;
};

type RenderableInlineSegment = FormattedInlineSegment | MentionInlineSegment;

type MentionDescriptor = {
  label: string;
  mentionType: "user" | "channel";
  isCurrentUser: boolean;
};

const formattedBodyBlocks = computed<FormattedMessageBlock[]>(() => formatMessageBody(props.message.body));
const linkPreviews = computed(() => props.message.linkPreviews ?? []);
const attachments = computed(() => props.message.attachments ?? []);
const hasBodyText = computed(() => formattedBodyBlocks.value.length > 0);
const currentUserUIDNormalized = computed(() => props.currentUserUID.trim().toLowerCase());

const mentionTokenDescriptors = computed<Map<string, MentionDescriptor>>(() => {
  const descriptors = new Map<string, MentionDescriptor>();
  (props.message.mentions ?? []).forEach((mention) => {
    const descriptor: MentionDescriptor = {
      label: resolveMentionLabel(mention),
      mentionType: mention.type,
      isCurrentUser: mentionTargetsCurrentUser(mention)
    };
    mentionSourceTokens(mention).forEach((token) => {
      const normalizedToken = token.trim();
      if (!normalizedToken) return;
      const key = normalizedToken.toLowerCase();
      if (descriptors.has(key)) return;
      descriptors.set(key, descriptor);
    });
  });
  return descriptors;
});

const mentionTokenPattern = computed<RegExp | null>(() => {
  const tokens = [...mentionTokenDescriptors.value.keys()];
  if (tokens.length === 0) return null;
  const pattern = tokens
    .sort((left, right) => right.length - left.length)
    .map((token) => escapeRegExp(token))
    .join("|");
  if (!pattern) return null;
  return new RegExp(pattern, "gi");
});

function formatHeaderTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `Today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatFallbackTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function previewSiteLabel(preview: LinkPreview): string {
  if (preview.siteName?.trim()) {
    return preview.siteName.trim();
  }
  try {
    const parsed = new URL(preview.url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch (_error) {
    return "Link preview";
  }
}

function isImageAttachment(attachment: MessageAttachment): boolean {
  return attachment.contentType.toLowerCase().startsWith("image/");
}

function attachmentAlt(attachment: MessageAttachment): string {
  const name = attachment.fileName.trim();
  if (name) {
    return name;
  }
  return "Attached image";
}

function onAttachmentImageClick(attachment: MessageAttachment): void {
  emit("openImageLightbox", attachment);
}

function isLastBodyBlock(index: number): boolean {
  return index === formattedBodyBlocks.value.length - 1;
}

function inlineSegmentClass(segment: FormattedInlineSegment): Record<string, boolean> {
  if (segment.kind === "inlineCode") {
    return {};
  }
  return {
    "is-bold": segment.bold,
    "is-italic": segment.italic,
    "is-strikethrough": segment.strikethrough
  };
}

function formatCodeLanguageLabel(language: string): string {
  const trimmed = language.trim();
  if (!trimmed) return "";
  return trimmed.length > 20 ? `${trimmed.slice(0, 20)}…` : trimmed.toUpperCase();
}

function listItemStyle(depth: number): Record<string, string> {
  const safeDepth = Number.isFinite(depth) ? Math.max(0, Math.min(6, Math.floor(depth))) : 0;
  return {
    "--message-list-depth": String(safeDepth)
  };
}

function stripMentionPrefix(value: string): string {
  return value.trim().replace(/^[@#]+/, "").trim();
}

function normalizeTokenForMentionType(rawValue: string, mentionType: "user" | "channel"): string {
  const value = rawValue.trim();
  if (!value) return "";
  if (value.startsWith("@") || value.startsWith("#")) {
    return value;
  }
  if (mentionType === "user") {
    return `@${value}`;
  }
  const lowered = value.toLowerCase();
  if (lowered === "here" || lowered === "channel" || lowered === "everyone") {
    return `@${value}`;
  }
  return `#${value}`;
}

function mentionSourceTokens(mention: MessageMention): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const pushToken = (rawToken: string) => {
    const normalizedToken = normalizeTokenForMentionType(rawToken, mention.type);
    if (!normalizedToken) return;
    const key = normalizedToken.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tokens.push(normalizedToken);
  };

  if (mention.token) {
    pushToken(mention.token);
  }
  if (mention.range) {
    const start = Math.max(0, Math.trunc(mention.range.start));
    const end = Math.max(start, Math.trunc(mention.range.end));
    if (end > start && start < props.message.body.length) {
      pushToken(props.message.body.slice(start, Math.min(end, props.message.body.length)));
    }
  }
  if (mention.displayText) {
    pushToken(mention.displayText);
  }
  if (mention.targetId) {
    pushToken(mention.targetId);
  }
  return tokens;
}

function mentionTargetsCurrentUser(mention: MessageMention): boolean {
  if (mention.type !== "user") return false;
  const currentUID = currentUserUIDNormalized.value;
  if (!currentUID) return false;

  const targetID = mention.targetId?.trim().toLowerCase() ?? "";
  if (targetID && targetID === currentUID) {
    return true;
  }

  const normalizedToken = normalizeTokenForMentionType(mention.token ?? "", "user").toLowerCase();
  return normalizedToken === `@${currentUID}`;
}

function resolveMentionLabel(mention: MessageMention): string {
  if (mention.type === "user") {
    const targetID = mention.targetId?.trim() ?? "";
    const profileDisplayName = targetID ? props.userDisplayNamesByUID[targetID]?.trim() ?? "" : "";
    const displayName =
      profileDisplayName ||
      stripMentionPrefix(mention.displayText ?? "") ||
      stripMentionPrefix(mention.token ?? "") ||
      targetID ||
      "unknown";
    return `@${displayName}`;
  }

  const token = mention.token?.trim() ?? "";
  const normalizedToken = token ? normalizeTokenForMentionType(token, "channel") : "";
  if (normalizedToken) {
    return normalizedToken;
  }

  const targetID = mention.targetId?.trim() ?? "";
  const channelName = targetID ? props.channelNamesById[targetID]?.trim() ?? "" : "";
  if (channelName) {
    return `#${stripMentionPrefix(channelName)}`;
  }

  const displayText = mention.displayText?.trim() ?? "";
  if (displayText) {
    return normalizeTokenForMentionType(displayText, "channel");
  }

  if (targetID) {
    return `#${targetID}`;
  }

  return "@channel";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasMentionBoundary(input: string, start: number, end: number): boolean {
  const before = start > 0 ? input[start - 1] : "";
  const after = end < input.length ? input[end] : "";
  if (before && /[A-Za-z0-9_.-]/.test(before)) {
    return false;
  }
  if (after && /[A-Za-z0-9_.-]/.test(after)) {
    return false;
  }
  return true;
}

function expandInlineSegments(segments: FormattedInlineSegment[]): RenderableInlineSegment[] {
  const mentionPattern = mentionTokenPattern.value;
  const mentionDescriptors = mentionTokenDescriptors.value;
  if (!mentionPattern || mentionDescriptors.size === 0) {
    return segments;
  }

  const expanded: RenderableInlineSegment[] = [];
  segments.forEach((segment) => {
    if (segment.kind !== "text") {
      expanded.push(segment);
      return;
    }
    if (!segment.value) {
      expanded.push(segment);
      return;
    }

    let cursor = 0;
    mentionPattern.lastIndex = 0;
    let sawMention = false;
    while (true) {
      const match = mentionPattern.exec(segment.value);
      if (!match) break;

      const rawToken = match[0];
      const start = match.index;
      const end = start + rawToken.length;
      const descriptor = mentionDescriptors.get(rawToken.toLowerCase());
      if (!descriptor || !hasMentionBoundary(segment.value, start, end)) {
        continue;
      }

      sawMention = true;
      if (start > cursor) {
        expanded.push({
          kind: "text",
          value: segment.value.slice(cursor, start),
          bold: segment.bold,
          italic: segment.italic,
          strikethrough: segment.strikethrough
        });
      }
      expanded.push({
        kind: "mention",
        label: descriptor.label,
        mentionType: descriptor.mentionType,
        isCurrentUser: descriptor.isCurrentUser
      });
      cursor = end;
    }

    if (!sawMention) {
      expanded.push(segment);
      return;
    }
    if (cursor < segment.value.length) {
      expanded.push({
        kind: "text",
        value: segment.value.slice(cursor),
        bold: segment.bold,
        italic: segment.italic,
        strikethrough: segment.strikethrough
      });
    }
  });

  return expanded;
}

function mentionSegmentClass(segment: MentionInlineSegment): Record<string, boolean> {
  return {
    "is-user": segment.mentionType === "user",
    "is-channel": segment.mentionType === "channel",
    "is-current-user": segment.isCurrentUser
  };
}
</script>

<template>
  <article
    class="message-row"
    :class="{ 'is-compact': isCompact, 'is-mentioned-current-user': isMentionForCurrentUser }"
    @contextmenu.prevent="emit('openContextMenu', $event)"
  >
    <div
      v-if="!isCompact"
      class="message-avatar"
      :style="{ '--avatar-bg': avatarColor, color: avatarTextColor }"
      aria-hidden="true"
    >
      <img v-if="avatarImageDataUrl" class="message-avatar-image" :src="avatarImageDataUrl" alt="" />
      <template v-else>{{ avatarText }}</template>
    </div>
    <div v-else class="message-avatar-spacer" aria-hidden="true" />
    <div class="message-content">
      <div
        v-if="props.replyPreview"
        class="message-reply-preview"
        :class="{ 'is-unavailable': props.replyPreview.isUnavailable }"
        :title="props.replyPreview.previewText"
      >
        <span class="message-reply-thread" aria-hidden="true" />
        <span
          class="message-reply-avatar"
          :style="{ '--avatar-bg': props.replyPreview.avatarColor, color: props.replyPreview.avatarTextColor }"
          aria-hidden="true"
        >
          <img v-if="props.replyPreview.avatarImageDataUrl" class="message-reply-avatar-image" :src="props.replyPreview.avatarImageDataUrl" alt="" />
          <template v-else>{{ props.replyPreview.avatarText }}</template>
        </span>
        <span class="message-reply-author">@{{ props.replyPreview.authorMention }}</span>
        <span class="message-reply-text">{{ props.replyPreview.previewText }}</span>
      </div>
      <header v-if="!isCompact" class="message-meta">
        <strong class="message-author">{{ authorName }}</strong>
        <time class="message-time">{{ formatHeaderTimestamp(props.message.createdAt) }}</time>
      </header>
      <div v-if="hasBodyText" class="message-body">
        <template v-for="(block, blockIndex) in formattedBodyBlocks" :key="`${props.message.id}-block-${blockIndex}`">
          <p v-if="block.kind === 'paragraph'" class="message-text">
            <template
              v-for="(segment, segmentIndex) in expandInlineSegments(block.segments)"
              :key="`${props.message.id}-segment-${blockIndex}-${segmentIndex}`"
            >
              <a
                v-if="segment.kind === 'link'"
                class="message-link"
                :class="inlineSegmentClass(segment)"
                :href="segment.href"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ segment.label }}
              </a>
              <code v-else-if="segment.kind === 'inlineCode'" class="message-inline-code">{{ segment.value }}</code>
              <span v-else-if="segment.kind === 'mention'" class="message-mention" :class="mentionSegmentClass(segment)">
                {{ segment.label }}
              </span>
              <span v-else :class="inlineSegmentClass(segment)">{{ segment.value }}</span>
            </template>
            <time v-if="isCompact && isLastBodyBlock(blockIndex)" class="message-time-inline">
              {{ formatFallbackTime(props.message.createdAt) }}
            </time>
          </p>
          <h3 v-else-if="block.kind === 'heading'" class="message-heading" :class="`is-level-${block.level}`">
            <template
              v-for="(segment, segmentIndex) in expandInlineSegments(block.segments)"
              :key="`${props.message.id}-heading-segment-${blockIndex}-${segmentIndex}`"
            >
              <a
                v-if="segment.kind === 'link'"
                class="message-link"
                :class="inlineSegmentClass(segment)"
                :href="segment.href"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ segment.label }}
              </a>
              <code v-else-if="segment.kind === 'inlineCode'" class="message-inline-code">{{ segment.value }}</code>
              <span v-else-if="segment.kind === 'mention'" class="message-mention" :class="mentionSegmentClass(segment)">
                {{ segment.label }}
              </span>
              <span v-else :class="inlineSegmentClass(segment)">{{ segment.value }}</span>
            </template>
            <time v-if="isCompact && isLastBodyBlock(blockIndex)" class="message-time-inline">
              {{ formatFallbackTime(props.message.createdAt) }}
            </time>
          </h3>
          <blockquote v-else-if="block.kind === 'quote'" class="message-quote">
            <template
              v-for="(segment, segmentIndex) in expandInlineSegments(block.segments)"
              :key="`${props.message.id}-quote-segment-${blockIndex}-${segmentIndex}`"
            >
              <a
                v-if="segment.kind === 'link'"
                class="message-link"
                :class="inlineSegmentClass(segment)"
                :href="segment.href"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ segment.label }}
              </a>
              <code v-else-if="segment.kind === 'inlineCode'" class="message-inline-code">{{ segment.value }}</code>
              <span v-else-if="segment.kind === 'mention'" class="message-mention" :class="mentionSegmentClass(segment)">
                {{ segment.label }}
              </span>
              <span v-else :class="inlineSegmentClass(segment)">{{ segment.value }}</span>
            </template>
            <time v-if="isCompact && isLastBodyBlock(blockIndex)" class="message-time-inline">
              {{ formatFallbackTime(props.message.createdAt) }}
            </time>
          </blockquote>
          <div v-else-if="block.kind === 'list'" class="message-list-shell">
            <ol v-if="block.ordered" class="message-list is-ordered" :start="block.start">
              <li
                v-for="(item, itemIndex) in block.items"
                :key="`${props.message.id}-ordered-item-${blockIndex}-${itemIndex}`"
                class="message-list-item"
                :style="listItemStyle(item.depth)"
              >
                <span class="message-list-item-copy">
                  <template
                    v-for="(segment, segmentIndex) in expandInlineSegments(item.segments)"
                    :key="`${props.message.id}-ordered-segment-${blockIndex}-${itemIndex}-${segmentIndex}`"
                  >
                    <a
                      v-if="segment.kind === 'link'"
                      class="message-link"
                      :class="inlineSegmentClass(segment)"
                      :href="segment.href"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ segment.label }}
                    </a>
                    <code v-else-if="segment.kind === 'inlineCode'" class="message-inline-code">{{ segment.value }}</code>
                    <span v-else-if="segment.kind === 'mention'" class="message-mention" :class="mentionSegmentClass(segment)">
                      {{ segment.label }}
                    </span>
                    <span v-else :class="inlineSegmentClass(segment)">{{ segment.value }}</span>
                  </template>
                </span>
              </li>
            </ol>
            <ul v-else class="message-list">
              <li
                v-for="(item, itemIndex) in block.items"
                :key="`${props.message.id}-unordered-item-${blockIndex}-${itemIndex}`"
                class="message-list-item"
                :style="listItemStyle(item.depth)"
              >
                <span class="message-list-item-copy">
                  <template
                    v-for="(segment, segmentIndex) in expandInlineSegments(item.segments)"
                    :key="`${props.message.id}-unordered-segment-${blockIndex}-${itemIndex}-${segmentIndex}`"
                  >
                    <a
                      v-if="segment.kind === 'link'"
                      class="message-link"
                      :class="inlineSegmentClass(segment)"
                      :href="segment.href"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ segment.label }}
                    </a>
                    <code v-else-if="segment.kind === 'inlineCode'" class="message-inline-code">{{ segment.value }}</code>
                    <span v-else-if="segment.kind === 'mention'" class="message-mention" :class="mentionSegmentClass(segment)">
                      {{ segment.label }}
                    </span>
                    <span v-else :class="inlineSegmentClass(segment)">{{ segment.value }}</span>
                  </template>
                </span>
              </li>
            </ul>
            <time v-if="isCompact && isLastBodyBlock(blockIndex)" class="message-time-inline is-block">
              {{ formatFallbackTime(props.message.createdAt) }}
            </time>
          </div>
          <template v-else-if="block.kind === 'divider'">
            <hr class="message-divider" />
            <time v-if="isCompact && isLastBodyBlock(blockIndex)" class="message-time-inline is-block">
              {{ formatFallbackTime(props.message.createdAt) }}
            </time>
          </template>
          <div v-else class="message-code-shell">
            <p v-if="block.language" class="message-code-language">{{ formatCodeLanguageLabel(block.language) }}</p>
            <pre class="message-code-block"><code>{{ block.value }}</code></pre>
            <time v-if="isCompact && isLastBodyBlock(blockIndex)" class="message-time-inline is-block">
              {{ formatFallbackTime(props.message.createdAt) }}
            </time>
          </div>
        </template>
      </div>
      <div v-if="attachments.length > 0" class="message-attachment-list">
        <a
          v-for="attachment in attachments"
          :key="attachment.attachmentId"
          class="message-attachment-card"
          :href="attachment.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            v-if="isImageAttachment(attachment)"
            class="message-attachment-image is-clickable"
            :src="attachment.url"
            :alt="attachmentAlt(attachment)"
            loading="lazy"
            @click.prevent.stop="onAttachmentImageClick(attachment)"
          />
          <p class="message-attachment-name">{{ attachment.fileName }}</p>
        </a>
      </div>
      <div v-if="linkPreviews.length > 0" class="message-link-preview-list">
        <a
          v-for="preview in linkPreviews"
          :key="`${props.message.id}-preview-${preview.url}`"
          class="message-link-preview-card"
          :href="preview.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <p class="message-link-preview-site">{{ previewSiteLabel(preview) }}</p>
          <p class="message-link-preview-title">{{ preview.title || preview.url }}</p>
          <p v-if="preview.description" class="message-link-preview-description">{{ preview.description }}</p>
          <img
            v-if="preview.imageUrl"
            class="message-link-preview-image"
            :src="preview.imageUrl"
            :alt="preview.title ? `${preview.title} preview image` : 'Link preview image'"
            loading="lazy"
          />
        </a>
      </div>
    </div>
  </article>
</template>
