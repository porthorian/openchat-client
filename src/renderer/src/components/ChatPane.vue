<script setup lang="ts">
import { mdiEmoticonHappyOutline, mdiImageOutline, mdiPlusCircleOutline } from "@mdi/js";
import type { UIDMode } from "@renderer/types/models";
import type { ChatMessage } from "@renderer/types/chat";
import AppIcon from "./AppIcon.vue";
import { computed, ref } from "vue";

const props = defineProps<{
  channelId: string;
  messages: ChatMessage[];
  currentUid: string;
  uidMode: UIDMode;
  disclosureMessage: string;
  appVersion: string;
  runtimeLabel: string;
  isLoadingMessages: boolean;
  isSendingMessage: boolean;
  startupError?: string | null;
}>();

const emit = defineEmits<{
  toggleUidMode: [];
  sendMessage: [body: string];
}>();

const draftMessage = ref("");

const sortedMessages = computed(() => {
  return [...props.messages].sort((left, right) => {
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
});
const isDraftEmpty = computed(() => draftMessage.value.trim().length === 0);

function formatMessageTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function submitMessage(): void {
  const body = draftMessage.value.trim();
  if (!body || props.isSendingMessage) return;
  emit("sendMessage", body);
  draftMessage.value = "";
}
</script>

<template>
  <main class="chat-pane">
    <section class="chat-stage">
      <div class="chat-stage-inner">
        <section class="disclosure-banner">
          <p class="disclosure-title">Identity Disclosure</p>
          <p v-if="startupError" class="startup-error-note">{{ startupError }}</p>
          <p>{{ disclosureMessage }}</p>
          <p class="uid-line">
            current UID:
            <code>{{ currentUid }}</code>
          </p>
          <div class="meta-row">
            <span>build {{ appVersion }}</span>
            <span>{{ runtimeLabel }}</span>
          </div>
          <button type="button" class="ghost-btn" @click="emit('toggleUidMode')">
            Switch UID mode ({{ uidMode }})
          </button>
        </section>

        <section class="timeline" aria-label="Message timeline">
          <p v-if="isLoadingMessages" class="timeline-status">Loading messages...</p>
          <p v-else-if="sortedMessages.length === 0" class="timeline-status">No messages yet.</p>
          <article v-for="message in sortedMessages" v-else :key="message.id" class="message-row">
            <header>
              <strong>{{ message.authorUID }}</strong>
              <time>{{ formatMessageTime(message.createdAt) }}</time>
            </header>
            <p>{{ message.body }}</p>
          </article>
        </section>
      </div>
    </section>

    <footer class="composer">
      <button type="button" class="composer-icon">
        <AppIcon :path="mdiPlusCircleOutline" :size="18" />
      </button>
      <input
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
