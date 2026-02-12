<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { mdiEmoticonHappyOutline, mdiImageOutline, mdiPlusCircleOutline } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  channelId: string;
  isSendingMessage: boolean;
}>();

const emit = defineEmits<{
  sendMessage: [body: string];
}>();

const draftMessage = ref("");
const composerInputRef = ref<HTMLInputElement | null>(null);
const isDraftEmpty = computed(() => draftMessage.value.trim().length === 0);

function submitMessage(): void {
  const body = draftMessage.value.trim();
  if (!body || props.isSendingMessage) return;
  emit("sendMessage", body);
  draftMessage.value = "";
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
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalTyping);
});
</script>

<template>
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
      <button type="button" class="composer-send-btn" :disabled="isSendingMessage || isDraftEmpty" @click="submitMessage">
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
</template>
