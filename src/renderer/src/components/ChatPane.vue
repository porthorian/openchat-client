<script setup lang="ts">
import { mdiEmoticonHappyOutline, mdiImageOutline, mdiPlusCircleOutline } from "@mdi/js";
import type { ChatMessage } from "@renderer/types/chat";
import AppIcon from "./AppIcon.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

type TimelineMessage = {
  message: ChatMessage;
  isCompact: boolean;
  avatarText: string;
  avatarColor: string;
};

const props = defineProps<{
  channelId: string;
  messages: ChatMessage[];
  isLoadingMessages: boolean;
  isSendingMessage: boolean;
}>();

const emit = defineEmits<{
  sendMessage: [body: string];
}>();

const draftMessage = ref("");
const composerInputRef = ref<HTMLInputElement | null>(null);
const timelineRef = ref<HTMLElement | null>(null);
const isTimelineScrolling = ref(false);
const compactWindowMS = 5 * 60 * 1000;
let scrollFrame = 0;
let timelineScrollTimer: ReturnType<typeof setTimeout> | null = null;

const sortedMessages = computed(() => {
  return [...props.messages].sort((left, right) => {
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
});

const timelineMessages = computed<TimelineMessage[]>(() => {
  return sortedMessages.value.map((message, index, allMessages) => {
    const previous = allMessages[index - 1];
    const messageAt = new Date(message.createdAt).getTime();
    const previousAt = previous ? new Date(previous.createdAt).getTime() : 0;
    const isCompact = Boolean(
      previous &&
        previous.authorUID === message.authorUID &&
        messageAt - previousAt <= compactWindowMS &&
        new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString()
    );
    return {
      message,
      isCompact,
      avatarText: toAvatarText(message.authorUID),
      avatarColor: toAvatarColor(message.authorUID)
    };
  });
});

const isDraftEmpty = computed(() => draftMessage.value.trim().length === 0);

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

function toAvatarText(authorUID: string): string {
  const trimmed = authorUID.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toUpperCase();
}

function toAvatarColor(authorUID: string): string {
  let hash = 0;
  for (let index = 0; index < authorUID.length; index += 1) {
    hash = (hash << 5) - hash + authorUID.charCodeAt(index);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 54% 46%)`;
}

function formatFallbackTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function submitMessage(): void {
  const body = draftMessage.value.trim();
  if (!body || props.isSendingMessage) return;
  emit("sendMessage", body);
  draftMessage.value = "";
}

function scrollTimelineToBottom(): void {
  const timeline = timelineRef.value;
  if (!timeline) return;
  timeline.scrollTop = timeline.scrollHeight;
}

function queueScrollTimelineToBottom(): void {
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame);
  }
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    scrollTimelineToBottom();
  });
}

function clearTimelineScrollTimer(): void {
  if (timelineScrollTimer === null) return;
  clearTimeout(timelineScrollTimer);
  timelineScrollTimer = null;
}

function markTimelineScrolling(): void {
  isTimelineScrolling.value = true;
  clearTimelineScrollTimer();
  timelineScrollTimer = setTimeout(() => {
    isTimelineScrolling.value = false;
    timelineScrollTimer = null;
  }, 680);
}

function onTimelineScroll(): void {
  markTimelineScrolling();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']")) {
    return true;
  }
  return target.getAttribute("role") === "textbox";
}

function handleGlobalTyping(event: KeyboardEvent): void {
  if (props.isSendingMessage) return;
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.length !== 1) return;
  if (isEditableTarget(event.target)) return;

  const input = composerInputRef.value;
  if (!input) return;

  event.preventDefault();
  const currentValue = draftMessage.value;
  const nextCursor = currentValue.length + event.key.length;
  draftMessage.value = `${currentValue}${event.key}`;
  input.focus();
  requestAnimationFrame(() => {
    input.setSelectionRange(nextCursor, nextCursor);
  });
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalTyping);
  window.addEventListener("resize", queueScrollTimelineToBottom);
  void nextTick(() => {
    queueScrollTimelineToBottom();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalTyping);
  window.removeEventListener("resize", queueScrollTimelineToBottom);
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
  clearTimelineScrollTimer();
});

watch(
  () => ({
    channelId: props.channelId,
    loading: props.isLoadingMessages,
    total: timelineMessages.value.length,
    lastMessageId: timelineMessages.value[timelineMessages.value.length - 1]?.message.id ?? ""
  }),
  (state) => {
    if (state.loading) return;
    void nextTick(() => {
      queueScrollTimelineToBottom();
    });
  },
  { immediate: true }
);
</script>

<template>
  <main class="chat-pane">
    <section
      ref="timelineRef"
      class="chat-stage timeline"
      :class="{ 'is-scrolling': isTimelineScrolling }"
      aria-label="Message timeline"
      @scroll.passive="onTimelineScroll"
    >
      <p v-if="isLoadingMessages" class="timeline-status">Loading messages...</p>
      <p v-else-if="timelineMessages.length === 0" class="timeline-status">No messages yet.</p>
      <article
        v-for="entry in timelineMessages"
        v-else
        :key="entry.message.id"
        class="message-row"
        :class="{ 'is-compact': entry.isCompact }"
      >
        <div
          v-if="!entry.isCompact"
          class="message-avatar"
          :style="{ '--avatar-bg': entry.avatarColor }"
          aria-hidden="true"
        >
          {{ entry.avatarText }}
        </div>
        <div v-else class="message-avatar-spacer" aria-hidden="true" />
        <div class="message-content">
          <header v-if="!entry.isCompact" class="message-meta">
            <strong class="message-author">{{ entry.message.authorUID }}</strong>
            <time class="message-time">{{ formatHeaderTimestamp(entry.message.createdAt) }}</time>
          </header>
          <p class="message-text">
            {{ entry.message.body }}
            <time v-if="entry.isCompact" class="message-time-inline">{{ formatFallbackTime(entry.message.createdAt) }}</time>
          </p>
        </div>
      </article>
    </section>

    <footer class="composer">
      <button type="button" class="composer-icon">
        <AppIcon :path="mdiPlusCircleOutline" :size="18" />
      </button>
      <input
        ref="composerInputRef"
        v-model="draftMessage"
        type="text"
        :placeholder="`Message #${channelId}`"
        aria-label="Message composer"
        :disabled="isSendingMessage"
        @keydown.enter.prevent="submitMessage"
      />
      <div class="composer-actions">
        <button
          type="button"
          class="composer-send-btn"
          :disabled="isSendingMessage || isDraftEmpty"
          @click="submitMessage"
        >
          {{ isSendingMessage ? "Sending..." : "Send" }}
        </button>
        <button type="button">
          <AppIcon :path="mdiImageOutline" :size="18" />
        </button>
        <button type="button">
          <AppIcon :path="mdiEmoticonHappyOutline" :size="18" />
        </button>
      </div>
    </footer>
  </main>
</template>
