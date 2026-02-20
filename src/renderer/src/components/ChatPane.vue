<script setup lang="ts">
import {
  mdiChevronRight,
  mdiContentCopy,
  mdiDeleteOutline,
  mdiEmailMarkAsUnread,
  mdiEmoticonHappyOutline,
  mdiLinkVariant,
  mdiMessageReplyTextOutline,
  mdiPinOutline
} from "@mdi/js";
import type { SyncedUserProfile } from "@renderer/services/chatClient";
import type { ChatMessage, MessageAttachment } from "@renderer/types/chat";
import type { AvatarMode } from "@renderer/types/models";
import { avatarPresetById } from "@renderer/utils/avatarPresets";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import ChatComposer from "./ChatComposer.vue";
import ChatImageLightbox from "./ChatImageLightbox.vue";
import ChatMessageRow from "./ChatMessageRow.vue";

type TimelineMessage = {
  message: ChatMessage;
  isCompact: boolean;
  isOwnMessage: boolean;
  authorName: string;
  avatarText: string;
  avatarColor: string;
  avatarTextColor: string;
  avatarImageDataUrl: string | null;
};

type MessageContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  entry: TimelineMessage | null;
};

type ReactionMenuState = {
  open: boolean;
  x: number;
  y: number;
};

type QuickReaction = {
  token: string;
  emoji: string;
};

type MessageContextAction = "reply" | "copyText" | "copyLink" | "markUnread" | "pin" | "delete";

const props = defineProps<{
  channelId: string;
  activeServerId: string;
  activeServerBackendUrl: string;
  messages: ChatMessage[];
  isLoadingMessages: boolean;
  isSendingMessage: boolean;
  attachmentsEnabled: boolean;
  maxUploadBytes: number | null;
  maxMessageBytes: number | null;
  sendErrorMessage: string | null;
  typingUsers: string[];
  currentUserUID: string;
  localProfileDisplayName: string;
  localProfileAvatarMode: AvatarMode;
  localProfileAvatarPresetId: string;
  localProfileAvatarImageDataUrl: string | null;
  remoteProfilesByUID: Record<string, SyncedUserProfile>;
}>();

const emit = defineEmits<{
  sendMessage: [payload: { body: string; attachments: File[] }];
  typingActivity: [isTyping: boolean];
  markMessageUnread: [payload: { channelId: string; messageId: string }];
  deleteMessage: [payload: { channelId: string; messageId: string }];
}>();

const timelineRef = ref<HTMLElement | null>(null);
const isTimelineScrolling = ref(false);
const lightboxAttachment = ref<MessageAttachment | null>(null);
const compactWindowMS = 5 * 60 * 1000;
const reactionMenuId = "message-reaction-menu";
const composerPrefillText = ref<string | null>(null);
const composerPrefillNonce = ref(0);
const messageContextMenu = ref<MessageContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  entry: null
});
const reactionMenu = ref<ReactionMenuState>({
  open: false,
  x: 0,
  y: 0
});
const reactionTriggerHovered = ref(false);
const reactionMenuHovered = ref(false);
const actionNotice = ref("");
let actionNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let scrollFrame = 0;
let timelineScrollTimer: ReturnType<typeof setTimeout> | null = null;
let reactionMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
const quickReactions: QuickReaction[] = [
  { token: ":heart:", emoji: "❤️" },
  { token: ":heres_donny:", emoji: "🧑🏾" },
  { token: ":successkid:", emoji: "🧒" },
  { token: ":saluting_face:", emoji: "🫡" },
  { token: ":lul:", emoji: "🧌" },
  { token: ":100:", emoji: "💯" },
  { token: ":white_check_mark:", emoji: "✅" },
  { token: ":thumbsup:", emoji: "👍" },
  { token: ":nice2:", emoji: "🆗" },
  { token: ":deceased:", emoji: "☠️" },
  { token: ":nice1:", emoji: "🙂" },
  { token: ":regional_indicator_e:", emoji: "🇪" }
];

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
    const remoteProfile = isLocalAuthor ? null : props.remoteProfilesByUID[message.authorUID];
    const remoteAvatarPreset = remoteProfile?.avatarPresetId ? avatarPresetById(remoteProfile.avatarPresetId) : null;
    const remoteDisplayName = remoteProfile?.displayName?.trim() ?? "";
    const authorName = isLocalAuthor ? localDisplayName : remoteDisplayName || message.authorUID;
    const isCompact = Boolean(
      previous &&
        previous.authorUID === message.authorUID &&
        messageAt - previousAt <= compactWindowMS &&
        new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString()
    );
    return {
      message,
      isCompact,
      isOwnMessage: isLocalAuthor,
      authorName,
      avatarText: authorName.slice(0, 1).toUpperCase() || toAvatarText(message.authorUID),
      avatarColor:
        isLocalAuthor && props.localProfileAvatarMode === "generated"
          ? localAvatarPreset.gradient
          : remoteProfile?.avatarMode === "generated" && remoteAvatarPreset
            ? remoteAvatarPreset.gradient
          : toAvatarColor(message.authorUID),
      avatarTextColor:
        isLocalAuthor && props.localProfileAvatarMode === "generated"
          ? localAvatarPreset.accent
          : remoteProfile?.avatarMode === "generated" && remoteAvatarPreset
            ? remoteAvatarPreset.accent
            : "#ffffff",
      avatarImageDataUrl:
        isLocalAuthor && props.localProfileAvatarMode === "uploaded"
          ? props.localProfileAvatarImageDataUrl
          : remoteProfile?.avatarMode === "uploaded"
            ? remoteProfile.avatarUrl
            : null
    };
  });
});

const selectedContextEntry = computed(() => messageContextMenu.value.entry);
const selectedCanReact = computed(() => {
  const entry = selectedContextEntry.value;
  if (!entry) return false;
  return canReactForEntry(entry);
});
const selectedCanReply = computed(() => {
  const entry = selectedContextEntry.value;
  if (!entry) return false;
  return canReplyForEntry(entry);
});
const selectedCanCopyText = computed(() => {
  const body = selectedContextEntry.value?.message.body ?? "";
  return body.trim().length > 0;
});
const selectedCanCopyLink = computed(() => {
  if (!selectedContextEntry.value) return false;
  return resolveMessagePermalink(selectedContextEntry.value.message).length > 0;
});
const selectedCanMarkUnread = computed(() => {
  const entry = selectedContextEntry.value;
  if (!entry) return false;
  return canMarkUnreadForEntry(entry);
});
const selectedCanPin = computed(() => {
  const entry = selectedContextEntry.value;
  if (!entry) return false;
  return canPinForEntry(entry);
});
const selectedCanDelete = computed(() => {
  const entry = selectedContextEntry.value;
  if (!entry) return false;
  return canDeleteForEntry(entry);
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

function handleComposerHeightDelta(delta: number): void {
  if (!delta) return;
  const timeline = timelineRef.value;
  if (!timeline) return;
  timeline.scrollTop += delta;
}

function clearTimelineScrollTimer(): void {
  if (timelineScrollTimer === null) return;
  clearTimeout(timelineScrollTimer);
  timelineScrollTimer = null;
}

function clearActionNoticeTimer(): void {
  if (actionNoticeTimer === null) return;
  clearTimeout(actionNoticeTimer);
  actionNoticeTimer = null;
}

function setActionNotice(message: string): void {
  clearActionNoticeTimer();
  actionNotice.value = message;
  actionNoticeTimer = setTimeout(() => {
    actionNotice.value = "";
    actionNoticeTimer = null;
  }, 2200);
}

function markTimelineScrolling(): void {
  isTimelineScrolling.value = true;
  clearTimelineScrollTimer();
  timelineScrollTimer = setTimeout(() => {
    isTimelineScrolling.value = false;
    timelineScrollTimer = null;
  }, 680);
}

function permissionOrDefault(permission: boolean | undefined, fallback: boolean): boolean {
  if (typeof permission === "boolean") return permission;
  return fallback;
}

function canReactForEntry(entry: TimelineMessage): boolean {
  return permissionOrDefault(entry.message.actionPermissions?.canReact, true);
}

function canReplyForEntry(entry: TimelineMessage): boolean {
  return permissionOrDefault(entry.message.actionPermissions?.canReply, true);
}

function canMarkUnreadForEntry(entry: TimelineMessage): boolean {
  return permissionOrDefault(entry.message.actionPermissions?.canMarkUnread, true);
}

function canPinForEntry(entry: TimelineMessage): boolean {
  return permissionOrDefault(entry.message.actionPermissions?.canPin, false);
}

function canDeleteForEntry(entry: TimelineMessage): boolean {
  const explicit = entry.message.actionPermissions?.canDelete;
  if (typeof explicit === "boolean") return explicit;
  return entry.isOwnMessage;
}

function closeMessageContextMenu(): void {
  messageContextMenu.value.open = false;
  messageContextMenu.value.entry = null;
  clearReactionMenuCloseTimer();
  reactionTriggerHovered.value = false;
  reactionMenuHovered.value = false;
  reactionMenu.value.open = false;
}

function openMessageContextMenu(event: MouseEvent, entry: TimelineMessage): void {
  clearReactionMenuCloseTimer();
  reactionTriggerHovered.value = false;
  reactionMenuHovered.value = false;
  reactionMenu.value.open = false;
  const menuWidth = 252;
  const menuHeight = 324;
  const boundedX = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
  const boundedY = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
  messageContextMenu.value = {
    open: true,
    x: boundedX,
    y: boundedY,
    entry
  };
}

function onTimelineScroll(): void {
  markTimelineScrolling();
  closeMessageContextMenu();
}

function onWindowPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".message-context-menu") && !target?.closest(".message-reaction-menu")) {
    closeMessageContextMenu();
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    if (reactionMenu.value.open) {
      reactionMenu.value.open = false;
      return;
    }
    closeMessageContextMenu();
  }
}

function openImageLightbox(attachment: MessageAttachment): void {
  lightboxAttachment.value = attachment;
}

function closeImageLightbox(): void {
  lightboxAttachment.value = null;
}

function queueComposerPrefill(text: string): void {
  if (!text.trim()) return;
  composerPrefillText.value = text;
  composerPrefillNonce.value += 1;
}

function clearReactionMenuCloseTimer(): void {
  if (reactionMenuCloseTimer === null) return;
  clearTimeout(reactionMenuCloseTimer);
  reactionMenuCloseTimer = null;
}

function closeReactionMenu(): void {
  clearReactionMenuCloseTimer();
  reactionMenu.value.open = false;
}

function scheduleReactionMenuClose(): void {
  clearReactionMenuCloseTimer();
  reactionMenuCloseTimer = setTimeout(() => {
    reactionMenuCloseTimer = null;
    if (reactionTriggerHovered.value || reactionMenuHovered.value) {
      return;
    }
    reactionMenu.value.open = false;
  }, 140);
}

function openReactionMenu(anchor: HTMLElement): void {
  clearReactionMenuCloseTimer();
  const submenuWidth = 258;
  const submenuHeight = 430;
  const rect = anchor.getBoundingClientRect();
  const preferredX = rect.right + 6;
  const alternateX = rect.left - submenuWidth - 6;
  const canRenderRight = preferredX + submenuWidth <= window.innerWidth - 8;
  const rawX = canRenderRight ? preferredX : alternateX;
  const rawY = rect.top - 8;
  const boundedX = Math.max(8, Math.min(rawX, window.innerWidth - submenuWidth - 8));
  const boundedY = Math.max(8, Math.min(rawY, window.innerHeight - submenuHeight - 8));
  reactionMenu.value = {
    open: true,
    x: boundedX,
    y: boundedY
  };
}

function toggleReactionMenu(event: MouseEvent): void {
  if (!selectedCanReact.value) return;
  const trigger = event.currentTarget as HTMLElement | null;
  if (!trigger) return;
  if (reactionMenu.value.open) {
    closeReactionMenu();
    return;
  }
  openReactionMenu(trigger);
}

function handleReactionTriggerMouseEnter(event: MouseEvent): void {
  if (!selectedCanReact.value) return;
  const trigger = event.currentTarget as HTMLElement | null;
  if (!trigger) return;
  reactionTriggerHovered.value = true;
  openReactionMenu(trigger);
}

function handleReactionTriggerMouseLeave(): void {
  reactionTriggerHovered.value = false;
  scheduleReactionMenuClose();
}

function handleReactionMenuMouseEnter(): void {
  reactionMenuHovered.value = true;
  clearReactionMenuCloseTimer();
}

function handleReactionMenuMouseLeave(): void {
  reactionMenuHovered.value = false;
  scheduleReactionMenuClose();
}

function pickQuickReaction(token: string): void {
  queueComposerPrefill(token);
  setActionNotice(`Reaction ${token} added to composer.`);
  closeMessageContextMenu();
}

function openFullReactionPicker(): void {
  setActionNotice("Expanded reaction picker is coming soon.");
  closeMessageContextMenu();
}

function buildReplyPrefill(entry: TimelineMessage): string {
  const mention = `@${entry.message.authorUID}`;
  const trimmedBody = entry.message.body.trim();
  if (!trimmedBody) {
    return `${mention} `;
  }
  const normalizedBody = trimmedBody.replace(/\r/g, "");
  const lines = normalizedBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4);
  const collapsed = lines.join("\n");
  const preview = collapsed.length > 220 ? `${collapsed.slice(0, 219)}…` : collapsed;
  const quote = preview
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${mention}\n${quote}`;
}

async function tryCopyText(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

function resolveMessagePermalink(message: ChatMessage): string {
  const explicit = message.permalink?.trim() ?? "";
  if (explicit) return explicit;
  const backendUrl = props.activeServerBackendUrl.trim().replace(/\/$/, "");
  if (backendUrl) {
    return `${backendUrl}/channels/${encodeURIComponent(message.channelId)}?message_id=${encodeURIComponent(message.id)}`;
  }
  const activeServerId = props.activeServerId.trim();
  if (activeServerId) {
    return `openchat://servers/${encodeURIComponent(activeServerId)}/channels/${encodeURIComponent(message.channelId)}/messages/${encodeURIComponent(message.id)}`;
  }
  return `openchat://channels/${encodeURIComponent(message.channelId)}/messages/${encodeURIComponent(message.id)}`;
}

async function runContextAction(action: MessageContextAction): Promise<void> {
  const entry = selectedContextEntry.value;
  if (!entry) return;

  if (action === "reply") {
    if (!canReplyForEntry(entry)) return;
    queueComposerPrefill(buildReplyPrefill(entry));
    setActionNotice("Reply draft added to composer.");
    closeMessageContextMenu();
    return;
  }

  if (action === "copyText") {
    const copied = await tryCopyText(entry.message.body);
    setActionNotice(copied ? "Message text copied." : "Could not copy message text.");
    closeMessageContextMenu();
    return;
  }

  if (action === "copyLink") {
    const copied = await tryCopyText(resolveMessagePermalink(entry.message));
    setActionNotice(copied ? "Message link copied." : "Could not copy message link.");
    closeMessageContextMenu();
    return;
  }

  if (action === "markUnread") {
    if (!canMarkUnreadForEntry(entry)) return;
    emit("markMessageUnread", {
      channelId: entry.message.channelId,
      messageId: entry.message.id
    });
    setActionNotice("Channel marked as unread.");
    closeMessageContextMenu();
    return;
  }

  if (action === "pin") {
    if (!canPinForEntry(entry)) return;
    setActionNotice("Pinning messages is not available in this build.");
    closeMessageContextMenu();
    return;
  }

  if (action === "delete") {
    if (!canDeleteForEntry(entry)) return;
    emit("deleteMessage", {
      channelId: entry.message.channelId,
      messageId: entry.message.id
    });
    setActionNotice("Delete requested.");
    closeMessageContextMenu();
  }
}

onMounted(() => {
  window.addEventListener("resize", queueScrollTimelineToBottom);
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("keydown", onWindowKeydown);
  void nextTick(() => {
    queueScrollTimelineToBottom();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", queueScrollTimelineToBottom);
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowKeydown);
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
  clearTimelineScrollTimer();
  clearActionNoticeTimer();
  clearReactionMenuCloseTimer();
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

watch(
  () => props.channelId,
  () => {
    closeImageLightbox();
    closeMessageContextMenu();
    actionNotice.value = "";
    clearActionNoticeTimer();
  }
);

watch(
  () => timelineMessages.value.map((entry) => entry.message.id).join("|"),
  () => {
    const selectedMessageId = selectedContextEntry.value?.message.id;
    if (!selectedMessageId) return;
    const stillExists = timelineMessages.value.some((entry) => entry.message.id === selectedMessageId);
    if (!stillExists) {
      closeMessageContextMenu();
    }
  }
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
        @open-image-lightbox="openImageLightbox"
        @open-context-menu="openMessageContextMenu($event, entry)"
      />
    </section>

    <section
      v-if="messageContextMenu.open && selectedContextEntry"
      class="message-context-menu"
      role="menu"
      aria-label="Message actions"
      :style="{ left: `${messageContextMenu.x}px`, top: `${messageContextMenu.y}px` }"
    >
      <button
        type="button"
        class="message-context-menu-item"
        :class="{ 'is-submenu-open': reactionMenu.open }"
        role="menuitem"
        :disabled="!selectedCanReact"
        :aria-expanded="reactionMenu.open ? 'true' : 'false'"
        :aria-haspopup="'menu'"
        :aria-controls="reactionMenuId"
        @mouseenter="handleReactionTriggerMouseEnter($event)"
        @mouseleave="handleReactionTriggerMouseLeave"
        @click="toggleReactionMenu($event)"
      >
        <span class="message-context-menu-copy">
          <span>Add Reaction</span>
        </span>
        <span class="message-context-menu-trailing">
          <AppIcon :path="mdiChevronRight" :size="16" />
        </span>
      </button>
      <button
        type="button"
        class="message-context-menu-item"
        role="menuitem"
        :disabled="!selectedCanReply"
        @click="void runContextAction('reply')"
      >
        <span>Reply</span>
        <AppIcon :path="mdiMessageReplyTextOutline" :size="18" />
      </button>
      <div class="message-context-menu-divider" />
      <button
        type="button"
        class="message-context-menu-item"
        role="menuitem"
        :disabled="!selectedCanCopyText"
        @click="void runContextAction('copyText')"
      >
        <span>Copy Text</span>
        <AppIcon :path="mdiContentCopy" :size="18" />
      </button>
      <button
        type="button"
        class="message-context-menu-item"
        role="menuitem"
        :disabled="!selectedCanCopyLink"
        @click="void runContextAction('copyLink')"
      >
        <span>Copy Message Link</span>
        <AppIcon :path="mdiLinkVariant" :size="18" />
      </button>
      <button
        type="button"
        class="message-context-menu-item"
        role="menuitem"
        :disabled="!selectedCanMarkUnread"
        @click="void runContextAction('markUnread')"
      >
        <span>Mark Unread</span>
        <AppIcon :path="mdiEmailMarkAsUnread" :size="18" />
      </button>
      <div class="message-context-menu-divider" />
      <button
        type="button"
        class="message-context-menu-item"
        role="menuitem"
        :disabled="!selectedCanPin"
        @click="void runContextAction('pin')"
      >
        <span>Pin Message</span>
        <AppIcon :path="mdiPinOutline" :size="18" />
      </button>
      <button
        type="button"
        class="message-context-menu-item is-danger"
        role="menuitem"
        :disabled="!selectedCanDelete"
        @click="void runContextAction('delete')"
      >
        <span>Delete Message</span>
        <AppIcon :path="mdiDeleteOutline" :size="18" />
      </button>
    </section>

    <section
      v-if="messageContextMenu.open && reactionMenu.open"
      :id="reactionMenuId"
      class="message-reaction-menu"
      role="menu"
      aria-label="Reaction picker"
      :style="{ left: `${reactionMenu.x}px`, top: `${reactionMenu.y}px` }"
      @mouseenter="handleReactionMenuMouseEnter"
      @mouseleave="handleReactionMenuMouseLeave"
    >
      <button
        v-for="reaction in quickReactions"
        :key="reaction.token"
        type="button"
        class="message-reaction-menu-item"
        role="menuitem"
        @click="pickQuickReaction(reaction.token)"
      >
        <span class="message-reaction-token">{{ reaction.token }}</span>
        <span class="message-reaction-emoji">{{ reaction.emoji }}</span>
      </button>
      <div class="message-reaction-menu-divider" />
      <button type="button" class="message-reaction-menu-item is-view-more" role="menuitem" @click="openFullReactionPicker">
        <span class="message-reaction-token">View More</span>
        <span class="message-reaction-emoji">◌</span>
      </button>
    </section>

    <p v-if="actionNotice" class="chat-pane-action-notice" role="status" aria-live="polite">{{ actionNotice }}</p>

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
      :attachments-enabled="attachmentsEnabled"
      :max-upload-bytes="maxUploadBytes"
      :max-message-bytes="maxMessageBytes"
      :send-error-message="sendErrorMessage"
      :prefill-text="composerPrefillText"
      :prefill-nonce="composerPrefillNonce"
      @send-message="emit('sendMessage', $event)"
      @typing-activity="emit('typingActivity', $event)"
      @composer-height-delta="handleComposerHeightDelta"
    />

    <ChatImageLightbox :open="lightboxAttachment !== null" :attachment="lightboxAttachment" @close="closeImageLightbox" />
  </main>
</template>
