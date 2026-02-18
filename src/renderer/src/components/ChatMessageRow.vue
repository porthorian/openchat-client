<script setup lang="ts">
import type { ChatMessage, LinkPreview } from "@renderer/types/chat";
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

const messageTextSegments = computed(() => splitMessageTextSegments(props.message.body));
const linkPreviews = computed(() => props.message.linkPreviews ?? []);

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
</script>

<template>
  <article class="message-row" :class="{ 'is-compact': isCompact }">
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
      <p class="message-text">
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
