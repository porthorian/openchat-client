<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  mdiClose,
  mdiDeleteOutline,
  mdiEmoticonHappyOutline,
  mdiEyeOutline,
  mdiImageOutline,
  mdiPencilOutline,
  mdiPlusCircleOutline
} from "@mdi/js";
import { composerEmojiOptions, type EmojiOption } from "@renderer/utils/emoji";
import AppIcon from "./AppIcon.vue";

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type ComposerReplyTarget = {
  messageId: string;
  authorName: string;
};

const props = defineProps<{
  channelId: string;
  isSendingMessage: boolean;
  attachmentsEnabled: boolean;
  maxUploadBytes: number | null;
  maxMessageBytes: number | null;
  sendErrorMessage: string | null;
  prefillText?: string | null;
  prefillNonce?: number;
  replyTarget?: ComposerReplyTarget | null;
}>();

const emit = defineEmits<{
  sendMessage: [payload: { body: string; attachments: File[]; replyToMessageId: string | null }];
  typingActivity: [isTyping: boolean];
  composerHeightDelta: [delta: number];
  clearReplyTarget: [];
}>();

const draftMessage = ref("");
const composerInputRef = ref<HTMLTextAreaElement | null>(null);
const composerShellRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const pendingAttachments = ref<PendingAttachment[]>([]);
const uploadError = ref<string | null>(null);
const typingRefreshMS = 2500;
const maxAttachmentsPerMessage = 4;
const maxComposerInputHeight = 192;
const typingActive = ref(false);
const lastTypingSentAt = ref(0);
const attachmentCounter = ref(0);
const replaceTargetAttachmentId = ref<string | null>(null);
const awaitingSendResult = ref(false);
const submittedReplyMessageId = ref<string | null>(null);
const emojiPickerOpen = ref(false);
const replyMentionEnabled = ref(true);
const emojiOptions = composerEmojiOptions;
let composerShellHeight = 0;
let composerShellResizeObserver: ResizeObserver | null = null;
const isComposerEmpty = computed(() => {
  return draftMessage.value.trim().length === 0 && pendingAttachments.value.length === 0;
});
const activeReplyTarget = computed(() => props.replyTarget ?? null);

function emitTypingActivity(isTyping: boolean, forceHeartbeat = false): void {
  if (!forceHeartbeat && typingActive.value === isTyping) {
    return;
  }
  typingActive.value = isTyping;
  lastTypingSentAt.value = Date.now();
  emit("typingActivity", isTyping);
}

function syncTypingActivity(): void {
  const hasDraft = draftMessage.value.trim().length > 0;
  if (!hasDraft) {
    emitTypingActivity(false);
    return;
  }
  const now = Date.now();
  if (!typingActive.value || now - lastTypingSentAt.value >= typingRefreshMS) {
    emitTypingActivity(true, true);
  }
}

function revokeAttachmentPreview(attachment: PendingAttachment): void {
  URL.revokeObjectURL(attachment.previewUrl);
}

function clearPendingAttachments(): void {
  pendingAttachments.value.forEach((attachment) => {
    revokeAttachmentPreview(attachment);
  });
  pendingAttachments.value = [];
  replaceTargetAttachmentId.value = null;
}

function createPendingAttachment(file: File, attachmentId?: string): PendingAttachment | null {
  if (!file.type.startsWith("image/")) {
    return null;
  }
  const maxBytes = props.maxUploadBytes;
  if (typeof maxBytes === "number" && maxBytes > 0 && file.size > maxBytes) {
    uploadError.value = `Image is too large. Max ${formatBytes(maxBytes)}.`;
    return null;
  }

  const id =
    attachmentId ??
    (() => {
      attachmentCounter.value += 1;
      return `pending-image-${attachmentCounter.value}`;
    })();
  return {
    id,
    file,
    previewUrl: URL.createObjectURL(file)
  };
}

function addPendingFiles(files: File[]): void {
  uploadError.value = null;
  if (!props.attachmentsEnabled || files.length === 0) return;

  const availableSlots = maxAttachmentsPerMessage - pendingAttachments.value.length;
  if (availableSlots <= 0) {
    uploadError.value = `Up to ${maxAttachmentsPerMessage} images per message.`;
    return;
  }

  const next: PendingAttachment[] = [];
  for (const file of files) {
    const pendingAttachment = createPendingAttachment(file);
    if (!pendingAttachment) continue;
    next.push(pendingAttachment);
    if (next.length >= availableSlots) {
      break;
    }
  }

  if (next.length === 0) {
    if (!uploadError.value) {
      uploadError.value = "Paste or choose an image file.";
    }
    return;
  }
  if (files.length > availableSlots) {
    uploadError.value = `Only the first ${availableSlots} image${availableSlots === 1 ? "" : "s"} were added.`;
  }

  pendingAttachments.value = [...pendingAttachments.value, ...next];
}

function removePendingAttachment(attachmentId: string): void {
  const index = pendingAttachments.value.findIndex((attachment) => attachment.id === attachmentId);
  if (index === -1) return;
  const [removed] = pendingAttachments.value.splice(index, 1);
  revokeAttachmentPreview(removed);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}

function openFilePicker(replaceAttachmentId: string | null): void {
  if (props.isSendingMessage || !props.attachmentsEnabled) return;
  replaceTargetAttachmentId.value = replaceAttachmentId;
  fileInputRef.value?.click();
}

function openAddAttachmentPicker(): void {
  openFilePicker(null);
}

function replacePendingAttachment(attachmentId: string, files: File[]): void {
  uploadError.value = null;
  if (!props.attachmentsEnabled || files.length === 0) return;

  const index = pendingAttachments.value.findIndex((attachment) => attachment.id === attachmentId);
  if (index === -1) return;

  for (const file of files) {
    const replacement = createPendingAttachment(file, attachmentId);
    if (!replacement) continue;
    const [current] = pendingAttachments.value.splice(index, 1, replacement);
    revokeAttachmentPreview(current);
    return;
  }

  if (!uploadError.value) {
    uploadError.value = "Paste or choose an image file.";
  }
}

function handleFileInputChange(event: Event): void {
  const input = event.target as HTMLInputElement | null;
  const files = input?.files ? Array.from(input.files) : [];
  const replaceAttachmentId = replaceTargetAttachmentId.value;
  replaceTargetAttachmentId.value = null;
  if (replaceAttachmentId) {
    replacePendingAttachment(replaceAttachmentId, files);
  } else {
    addPendingFiles(files);
  }
  if (input) {
    input.value = "";
  }
}

function openPendingAttachment(attachment: PendingAttachment): void {
  if (props.isSendingMessage) return;
  window.open(attachment.previewUrl, "_blank", "noopener,noreferrer");
}

function beginAttachmentReplace(attachmentId: string): void {
  if (props.isSendingMessage) return;
  openFilePicker(attachmentId);
}

function handlePaste(event: ClipboardEvent): void {
  if (props.isSendingMessage || !props.attachmentsEnabled) return;
  const clipboardItems = event.clipboardData?.items;
  if (!clipboardItems || clipboardItems.length === 0) return;

  const imageFiles: File[] = [];
  for (const item of clipboardItems) {
    if (item.kind !== "file") continue;
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    imageFiles.push(file);
  }
  if (imageFiles.length === 0) return;

  event.preventDefault();
  addPendingFiles(imageFiles);
}

function submitMessage(): void {
  const body = draftMessage.value.trim();
  const replyToMessageId = activeReplyTarget.value?.messageId?.trim() ?? "";
  if (props.isSendingMessage) return;
  if (body.length === 0 && pendingAttachments.value.length === 0) return;

  const maxMessageBytes = props.maxMessageBytes;
  if (typeof maxMessageBytes === "number" && maxMessageBytes > 0) {
    const bodyBytes = utf8ByteLength(body);
    if (bodyBytes > maxMessageBytes) {
      uploadError.value = `Message is too large. Max ${formatBytes(maxMessageBytes)}.`;
      return;
    }
  }

  const maxUploadBytes = props.maxUploadBytes;
  if (typeof maxUploadBytes === "number" && maxUploadBytes > 0) {
    const totalAttachmentBytes = pendingAttachments.value.reduce((total, attachment) => total + attachment.file.size, 0);
    if (totalAttachmentBytes > maxUploadBytes) {
      uploadError.value = `Attachments are too large together. Max ${formatBytes(maxUploadBytes)} total.`;
      return;
    }
  }

  uploadError.value = null;
  emojiPickerOpen.value = false;
  awaitingSendResult.value = true;
  submittedReplyMessageId.value = replyToMessageId || null;
  emit("sendMessage", {
    body,
    attachments: pendingAttachments.value.map((attachment) => attachment.file),
    replyToMessageId: replyToMessageId || null
  });
  emitTypingActivity(false);
}

function clearReplyTarget(): void {
  if (props.isSendingMessage || !activeReplyTarget.value) return;
  submittedReplyMessageId.value = null;
  emit("clearReplyTarget");
  void nextTick(() => {
    composerInputRef.value?.focus();
  });
}

function toggleReplyMention(): void {
  if (props.isSendingMessage || !activeReplyTarget.value) return;
  replyMentionEnabled.value = !replyMentionEnabled.value;
}

function insertTextAtSelection(inputText: string): void {
  const input = composerInputRef.value;
  if (!input) return;

  const selectionStart = input.selectionStart ?? draftMessage.value.length;
  const selectionEnd = input.selectionEnd ?? draftMessage.value.length;
  const before = draftMessage.value.slice(0, selectionStart);
  const after = draftMessage.value.slice(selectionEnd);
  draftMessage.value = `${before}${inputText}${after}`;

  const cursor = selectionStart + inputText.length;
  void nextTick(() => {
    const nextInput = composerInputRef.value;
    if (!nextInput) return;
    nextInput.focus();
    nextInput.setSelectionRange(cursor, cursor);
    syncComposerInputHeight(true);
  });
}

function toggleEmojiPicker(): void {
  if (props.isSendingMessage) return;
  emojiPickerOpen.value = !emojiPickerOpen.value;
  if (emojiPickerOpen.value) {
    void nextTick(() => {
      composerInputRef.value?.focus();
    });
  }
}

function pickEmoji(option: EmojiOption): void {
  const input = composerInputRef.value;
  if (!input) return;
  const selectionStart = input.selectionStart ?? draftMessage.value.length;
  const selectionEnd = input.selectionEnd ?? draftMessage.value.length;
  const before = draftMessage.value.slice(0, selectionStart);
  const after = draftMessage.value.slice(selectionEnd);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
  const insertion = `${needsLeadingSpace ? " " : ""}${option.emoji}${needsTrailingSpace ? " " : ""}`;
  insertTextAtSelection(insertion);
  emojiPickerOpen.value = false;
}

function syncComposerInputHeight(keepCaretVisible = false): void {
  const input = composerInputRef.value;
  if (!input) return;

  input.style.height = "0px";
  const scrollHeight = input.scrollHeight;
  const nextHeight = Math.min(scrollHeight, maxComposerInputHeight);
  input.style.height = `${nextHeight}px`;
  if (scrollHeight > maxComposerInputHeight) {
    input.style.overflowY = "auto";
    if (keepCaretVisible) {
      input.scrollTop = input.scrollHeight;
    }
    return;
  }
  input.style.overflowY = "hidden";
  input.scrollTop = 0;
}

function emitComposerHeightDelta(nextHeight: number): void {
  if (composerShellHeight === 0) {
    composerShellHeight = nextHeight;
    return;
  }
  const delta = nextHeight - composerShellHeight;
  if (delta !== 0) {
    emit("composerHeightDelta", delta);
  }
  composerShellHeight = nextHeight;
}

function observeComposerHeight(): void {
  const shell = composerShellRef.value;
  if (!shell || typeof ResizeObserver === "undefined") return;
  composerShellHeight = Math.round(shell.getBoundingClientRect().height);
  composerShellResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    emitComposerHeightDelta(Math.round(entry.contentRect.height));
  });
  composerShellResizeObserver.observe(shell);
}

function handleComposerInput(): void {
  const input = composerInputRef.value;
  if (!input) return;
  const isSelectionAtEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
  syncComposerInputHeight(isSelectionAtEnd);
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing) return;
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  submitMessage();
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
    syncComposerInputHeight(true);
    input.setSelectionRange(nextCursor, nextCursor);
  });
}

function handleWindowPointerDown(event: PointerEvent): void {
  if (!emojiPickerOpen.value) return;
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest(".composer-emoji-picker") || target.closest(".composer-emoji-toggle")) {
    return;
  }
  emojiPickerOpen.value = false;
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  emojiPickerOpen.value = false;
}

function applyPrefillText(value: string): void {
  const text = value.trim();
  if (!text) return;
  const existing = draftMessage.value.trimEnd();
  draftMessage.value = existing ? `${existing}\n${text}` : text;
  void nextTick(() => {
    const input = composerInputRef.value;
    if (!input) return;
    input.focus();
    const cursor = draftMessage.value.length;
    input.setSelectionRange(cursor, cursor);
    syncComposerInputHeight(true);
  });
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalTyping);
  window.addEventListener("pointerdown", handleWindowPointerDown);
  window.addEventListener("keydown", handleWindowKeydown);
  void nextTick(() => {
    syncComposerInputHeight();
    observeComposerHeight();
  });
});

onBeforeUnmount(() => {
  emitTypingActivity(false);
  window.removeEventListener("keydown", handleGlobalTyping);
  window.removeEventListener("pointerdown", handleWindowPointerDown);
  window.removeEventListener("keydown", handleWindowKeydown);
  if (composerShellResizeObserver) {
    composerShellResizeObserver.disconnect();
    composerShellResizeObserver = null;
  }
  clearPendingAttachments();
});

watch(
  () => draftMessage.value,
  () => {
    syncTypingActivity();
    void nextTick(() => {
      syncComposerInputHeight();
    });
  }
);

watch(
  () => props.channelId,
  () => {
    emitTypingActivity(false);
    awaitingSendResult.value = false;
    submittedReplyMessageId.value = null;
    replyMentionEnabled.value = true;
    uploadError.value = null;
    emojiPickerOpen.value = false;
    clearPendingAttachments();
  }
);

watch(
  () => props.prefillNonce ?? 0,
  (nonce, previous) => {
    if (nonce === previous) return;
    const text = props.prefillText ?? "";
    if (!text.trim()) return;
    applyPrefillText(text);
  }
);

watch(
  () => props.isSendingMessage,
  (isSending, wasSending) => {
    if (isSending || !wasSending || !awaitingSendResult.value) return;
    void nextTick(() => {
      if (props.isSendingMessage || !awaitingSendResult.value) return;
      awaitingSendResult.value = false;
      if (props.sendErrorMessage) {
        return;
      }
      draftMessage.value = "";
      clearPendingAttachments();
      if (submittedReplyMessageId.value) {
        submittedReplyMessageId.value = null;
        emit("clearReplyTarget");
      }
    });
  }
);

watch(
  () => props.replyTarget?.messageId ?? "",
  (messageId, previousMessageId) => {
    if (!messageId) {
      replyMentionEnabled.value = true;
      return;
    }
    if (messageId === previousMessageId) return;
    replyMentionEnabled.value = true;
    void nextTick(() => {
      const input = composerInputRef.value;
      if (!input) return;
      input.focus();
      const cursor = draftMessage.value.length;
      input.setSelectionRange(cursor, cursor);
    });
  }
);
</script>

<template>
  <footer ref="composerShellRef" class="composer-shell">
    <div v-if="pendingAttachments.length > 0" class="composer-upload-preview-list">
      <article
        v-for="attachment in pendingAttachments"
        :key="attachment.id"
        class="composer-upload-preview"
        :class="{ 'is-disabled': isSendingMessage }"
      >
        <div class="composer-upload-actions">
          <button type="button" class="composer-upload-action" :disabled="isSendingMessage" @click="openPendingAttachment(attachment)">
            <AppIcon :path="mdiEyeOutline" :size="18" />
          </button>
          <button type="button" class="composer-upload-action" :disabled="isSendingMessage" @click="beginAttachmentReplace(attachment.id)">
            <AppIcon :path="mdiPencilOutline" :size="18" />
          </button>
          <button
            type="button"
            class="composer-upload-action is-danger"
            :disabled="isSendingMessage"
            @click="removePendingAttachment(attachment.id)"
          >
            <AppIcon :path="mdiDeleteOutline" :size="18" />
          </button>
        </div>
        <div class="composer-upload-preview-media">
          <img :src="attachment.previewUrl" :alt="attachment.file.name || 'Attached image'" />
        </div>
        <div class="composer-upload-preview-meta">
          <p class="composer-upload-preview-name">{{ attachment.file.name || "image.png" }}</p>
          <p class="composer-upload-preview-size">{{ formatBytes(attachment.file.size) }}</p>
        </div>
      </article>
    </div>
    <p v-if="uploadError" class="composer-upload-error">{{ uploadError }}</p>
    <p v-if="sendErrorMessage" class="composer-upload-error">{{ sendErrorMessage }}</p>

    <div class="composer-frame" :class="{ 'has-reply-target': activeReplyTarget }">
      <div v-if="activeReplyTarget" class="composer-reply-banner">
        <p class="composer-reply-copy">Replying to <strong>{{ activeReplyTarget.authorName }}</strong></p>
        <div class="composer-reply-actions">
          <button
            type="button"
            class="composer-reply-mention-toggle"
            :class="{ 'is-disabled': !replyMentionEnabled }"
            :data-tooltip="
              replyMentionEnabled
                ? 'Click to disable pinging the original author.'
                : 'Click to enable pinging the original author.'
            "
            :aria-pressed="replyMentionEnabled ? 'true' : 'false'"
            :disabled="isSendingMessage"
            @click="toggleReplyMention"
          >
            <span class="composer-reply-mention-symbol">@</span>
            <span>{{ replyMentionEnabled ? "ON" : "OFF" }}</span>
          </button>
          <span class="composer-reply-actions-divider" aria-hidden="true" />
          <button type="button" class="composer-reply-dismiss" :disabled="isSendingMessage" aria-label="Cancel reply" @click="clearReplyTarget">
            <AppIcon :path="mdiClose" :size="14" />
          </button>
        </div>
      </div>
      <div class="composer" :class="{ 'is-under-reply': activeReplyTarget }">
        <button type="button" class="composer-icon" :disabled="isSendingMessage || !attachmentsEnabled" @click="openAddAttachmentPicker">
          <AppIcon :path="mdiPlusCircleOutline" :size="18" />
        </button>
        <textarea
          ref="composerInputRef"
          v-model="draftMessage"
          rows="1"
          :placeholder="`Message #${channelId}`"
          aria-label="Message composer"
          :disabled="isSendingMessage"
          @blur="emitTypingActivity(false)"
          @focus="syncTypingActivity"
          @input="handleComposerInput"
          @paste="handlePaste"
          @keydown="handleComposerKeydown"
        />
        <div class="composer-actions">
          <button type="button" class="composer-send-btn" :disabled="isSendingMessage || isComposerEmpty" @click="submitMessage">
            {{ isSendingMessage ? "Sending..." : "Send" }}
          </button>
          <button type="button" :disabled="isSendingMessage || !attachmentsEnabled" @click="openAddAttachmentPicker">
            <AppIcon :path="mdiImageOutline" :size="18" />
          </button>
          <button
            type="button"
            class="composer-emoji-toggle"
            :disabled="isSendingMessage"
            :aria-expanded="emojiPickerOpen ? 'true' : 'false'"
            aria-haspopup="dialog"
            aria-label="Insert emoji"
            @click.stop="toggleEmojiPicker"
          >
            <AppIcon :path="mdiEmoticonHappyOutline" :size="18" />
          </button>
        </div>
        <section v-if="emojiPickerOpen" class="composer-emoji-picker" role="dialog" aria-label="Emoji picker">
          <p class="composer-emoji-picker-title">Emoji</p>
          <div class="composer-emoji-grid">
            <button
              v-for="option in emojiOptions"
              :key="option.shortcode"
              type="button"
              class="composer-emoji-option"
              :title="`${option.label} (${option.shortcode})`"
              @click="pickEmoji(option)"
            >
              {{ option.emoji }}
            </button>
          </div>
        </section>
        <input
          ref="fileInputRef"
          class="composer-file-input"
          type="file"
          accept="image/png,image/jpeg,image/gif"
          :multiple="replaceTargetAttachmentId === null"
          :disabled="isSendingMessage || !attachmentsEnabled"
          @change="handleFileInputChange"
        />
      </div>
    </div>
  </footer>
</template>
