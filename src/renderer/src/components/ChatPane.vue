<script setup lang="ts">
import type { SessionStatus, UIDMode } from "@renderer/types/models";

type Message = {
  id: string;
  authorUID: string;
  body: string;
  sentAt: string;
};

defineProps<{
  serverName: string;
  channelId: string;
  messages: Message[];
  sessionStatus: SessionStatus;
  currentUID: string;
  uidMode: UIDMode;
  disclosureMessage: string;
}>();

const emit = defineEmits<{
  toggleUidMode: [];
  setSessionStatus: [status: SessionStatus];
}>();

const statusOptions: SessionStatus[] = ["active", "connecting", "expired", "disconnected"];
</script>

<template>
  <main class="chat-pane panel">
    <header class="pane-header chat-header">
      <div>
        <h2># {{ channelId.replace("ch_", "") }}</h2>
        <small>{{ serverName }}</small>
      </div>
      <div class="status-stack">
        <span class="status-pill" :class="`is-${sessionStatus}`">{{ sessionStatus }}</span>
        <label>
          <span class="sr-only">Session status</span>
          <select :value="sessionStatus" @change="emit('setSessionStatus', ($event.target as HTMLSelectElement).value as SessionStatus)">
            <option v-for="option in statusOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </label>
      </div>
    </header>

    <section class="disclosure-banner">
      <p class="disclosure-title">Identity Disclosure</p>
      <p>{{ disclosureMessage }}</p>
      <p class="uid-line">
        current UID:
        <code>{{ currentUID }}</code>
      </p>
      <button type="button" class="ghost-btn" @click="emit('toggleUidMode')">
        Switch UID mode ({{ uidMode }})
      </button>
    </section>

    <section class="timeline" aria-label="Message timeline">
      <article v-for="message in messages" :key="message.id" class="message-row">
        <header>
          <strong>{{ message.authorUID }}</strong>
          <time>{{ message.sentAt }}</time>
        </header>
        <p>{{ message.body }}</p>
      </article>
    </section>

    <footer class="composer">
      <textarea
        rows="3"
        placeholder="Type a message (client scaffolding only)"
        aria-label="Message composer"
      />
      <button type="button" class="send-btn" disabled>
        Send
      </button>
    </footer>
  </main>
</template>
