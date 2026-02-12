<script setup lang="ts">
import type { ChatMessage } from "@renderer/types/chat";

const props = defineProps<{
  message: ChatMessage;
  isCompact: boolean;
  avatarText: string;
  avatarColor: string;
}>();

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
</script>

<template>
  <article class="message-row" :class="{ 'is-compact': isCompact }">
    <div v-if="!isCompact" class="message-avatar" :style="{ '--avatar-bg': avatarColor }" aria-hidden="true">
      {{ avatarText }}
    </div>
    <div v-else class="message-avatar-spacer" aria-hidden="true" />
    <div class="message-content">
      <header v-if="!isCompact" class="message-meta">
        <strong class="message-author">{{ props.message.authorUID }}</strong>
        <time class="message-time">{{ formatHeaderTimestamp(props.message.createdAt) }}</time>
      </header>
      <p class="message-text">
        {{ props.message.body }}
        <time v-if="isCompact" class="message-time-inline">{{ formatFallbackTime(props.message.createdAt) }}</time>
      </p>
    </div>
  </article>
</template>
