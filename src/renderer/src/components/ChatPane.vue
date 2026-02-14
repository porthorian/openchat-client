<script setup lang="ts">
import type { ChatMessage } from "@renderer/types/chat";
import type { AvatarMode } from "@renderer/types/models";
import { avatarPresetById } from "@renderer/utils/avatarPresets";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ChatComposer from "./ChatComposer.vue";
import ChatMessageRow from "./ChatMessageRow.vue";

type TimelineMessage = {
  message: ChatMessage;
  isCompact: boolean;
  authorName: string;
  avatarText: string;
  avatarColor: string;
  avatarTextColor: string;
  avatarImageDataUrl: string | null;
};

const props = defineProps<{
  channelId: string;
  messages: ChatMessage[];
  isLoadingMessages: boolean;
  isSendingMessage: boolean;
  typingUsers: string[];
  currentUserUID: string;
  localProfileDisplayName: string;
  localProfileAvatarMode: AvatarMode;
  localProfileAvatarPresetId: string;
  localProfileAvatarImageDataUrl: string | null;
}>();

const emit = defineEmits<{
  sendMessage: [body: string];
  typingActivity: [isTyping: boolean];
}>();

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
  const localUserUID = props.currentUserUID.trim();
  const localDisplayName = props.localProfileDisplayName.trim() || "You";
  const localAvatarPreset = avatarPresetById(props.localProfileAvatarPresetId);
  return sortedMessages.value.map((message, index, allMessages) => {
    const previous = allMessages[index - 1];
    const messageAt = new Date(message.createdAt).getTime();
    const previousAt = previous ? new Date(previous.createdAt).getTime() : 0;
    const isLocalAuthor = Boolean(localUserUID && message.authorUID === localUserUID);
    const isCompact = Boolean(
      previous &&
        previous.authorUID === message.authorUID &&
        messageAt - previousAt <= compactWindowMS &&
        new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString()
    );
    return {
      message,
      isCompact,
      authorName: isLocalAuthor ? localDisplayName : message.authorUID,
      avatarText: isLocalAuthor ? localDisplayName.slice(0, 1).toUpperCase() : toAvatarText(message.authorUID),
      avatarColor:
        isLocalAuthor && props.localProfileAvatarMode === "generated"
          ? localAvatarPreset.gradient
          : toAvatarColor(message.authorUID),
      avatarTextColor: isLocalAuthor && props.localProfileAvatarMode === "generated" ? localAvatarPreset.accent : "#ffffff",
      avatarImageDataUrl:
        isLocalAuthor && props.localProfileAvatarMode === "uploaded" ? props.localProfileAvatarImageDataUrl : null
    };
  });
});

const typingLabel = computed(() => {
  const users = props.typingUsers;
  const total = users.length;
  if (total === 0) return "";
  if (total === 1) return `${users[0]} is typing...`;
  if (total === 2) return `${users[0]} and ${users[1]} are typing...`;
  if (total > 5) {
    return `${users[0]} and ${users[1]} plus ${total - 2} others are typing...`;
  }
  const allButLast = users.slice(0, -1).join(", ");
  return `${allButLast}, and ${users[total - 1]} are typing...`;
});

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

onMounted(() => {
  window.addEventListener("resize", queueScrollTimelineToBottom);
  void nextTick(() => {
    queueScrollTimelineToBottom();
  });
});

onBeforeUnmount(() => {
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
      <ChatMessageRow
        v-for="entry in timelineMessages"
        :key="entry.message.id"
        :message="entry.message"
        :is-compact="entry.isCompact"
        :author-name="entry.authorName"
        :avatar-text="entry.avatarText"
        :avatar-color="entry.avatarColor"
        :avatar-text-color="entry.avatarTextColor"
        :avatar-image-data-url="entry.avatarImageDataUrl"
      />
    </section>

    <div v-if="typingLabel" class="typing-indicator" aria-live="polite">
      <span class="typing-indicator-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span class="typing-indicator-label">{{ typingLabel }}</span>
    </div>

    <ChatComposer
      :channel-id="channelId"
      :is-sending-message="isSendingMessage"
      @send-message="emit('sendMessage', $event)"
      @typing-activity="emit('typingActivity', $event)"
    />
  </main>
</template>
