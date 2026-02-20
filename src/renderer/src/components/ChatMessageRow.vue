<script setup lang="ts">
import type { ChatMessage, LinkPreview, MessageAttachment } from "@renderer/types/chat";
import { splitMessageTextSegments } from "@renderer/utils/linkify";
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

const messageTextSegments = computed(() => splitMessageTextSegments(props.message.body));
const linkPreviews = computed(() => props.message.linkPreviews ?? []);
const attachments = computed(() => props.message.attachments ?? []);
const hasBodyText = computed(() => props.message.body.trim().length > 0);

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
      <p v-if="hasBodyText" class="message-text">
        <template v-for="(segment, index) in messageTextSegments" :key="`${props.message.id}-segment-${index}`">
          <a
            v-if="segment.kind === 'link'"
            class="message-link"
            :href="segment.href"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ segment.label }}
          </a>
          <template v-else>{{ segment.value }}</template>
        </template>
        <time v-if="isCompact" class="message-time-inline">{{ formatFallbackTime(props.message.createdAt) }}</time>
      </p>
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
