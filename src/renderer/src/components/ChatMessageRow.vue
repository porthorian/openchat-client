<script setup lang="ts">
import type { ChatMessage, LinkPreview, MessageAttachment } from "@renderer/types/chat";
import {
  formatMessageBody,
  type FormattedInlineSegment,
  type FormattedMessageBlock
} from "@renderer/utils/messageFormatting";
import { computed } from "vue";

const props = defineProps<{
  message: ChatMessage;
  isCompact: boolean;
  authorName: string;
  avatarText: string;
  avatarColor: string;
  avatarTextColor: string;
  avatarImageDataUrl: string | null;
}>();
const emit = defineEmits<{
  openImageLightbox: [attachment: MessageAttachment];
  openContextMenu: [event: MouseEvent];
}>();

const formattedBodyBlocks = computed<FormattedMessageBlock[]>(() => formatMessageBody(props.message.body));
const linkPreviews = computed(() => props.message.linkPreviews ?? []);
const attachments = computed(() => props.message.attachments ?? []);
const hasBodyText = computed(() => formattedBodyBlocks.value.length > 0);

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
</script>

<template>
  <article class="message-row" :class="{ 'is-compact': isCompact }" @contextmenu.prevent="emit('openContextMenu', $event)">
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
      <header v-if="!isCompact" class="message-meta">
        <strong class="message-author">{{ authorName }}</strong>
        <time class="message-time">{{ formatHeaderTimestamp(props.message.createdAt) }}</time>
      </header>
      <div v-if="hasBodyText" class="message-body">
        <template v-for="(block, blockIndex) in formattedBodyBlocks" :key="`${props.message.id}-block-${blockIndex}`">
          <p v-if="block.kind === 'paragraph'" class="message-text">
            <template v-for="(segment, segmentIndex) in block.segments" :key="`${props.message.id}-segment-${blockIndex}-${segmentIndex}`">
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
              <span v-else :class="inlineSegmentClass(segment)">{{ segment.value }}</span>
            </template>
            <time v-if="isCompact && isLastBodyBlock(blockIndex)" class="message-time-inline">
              {{ formatFallbackTime(props.message.createdAt) }}
            </time>
          </p>
          <h3 v-else-if="block.kind === 'heading'" class="message-heading" :class="`is-level-${block.level}`">
            <template
              v-for="(segment, segmentIndex) in block.segments"
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
              <span v-else :class="inlineSegmentClass(segment)">{{ segment.value }}</span>
            </template>
            <time v-if="isCompact && isLastBodyBlock(blockIndex)" class="message-time-inline">
              {{ formatFallbackTime(props.message.createdAt) }}
            </time>
          </h3>
          <blockquote v-else-if="block.kind === 'quote'" class="message-quote">
            <template v-for="(segment, segmentIndex) in block.segments" :key="`${props.message.id}-quote-segment-${blockIndex}-${segmentIndex}`">
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
                    v-for="(segment, segmentIndex) in item.segments"
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
                    v-for="(segment, segmentIndex) in item.segments"
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
