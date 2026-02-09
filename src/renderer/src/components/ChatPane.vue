<script setup lang="ts">
import { mdiEmoticonHappyOutline, mdiImageOutline, mdiPlusCircleOutline } from "@mdi/js";
import type { UIDMode } from "@renderer/types/models";
import AppIcon from "./AppIcon.vue";

type Message = {
  id: string;
  authorUID: string;
  body: string;
  sentAt: string;
};

defineProps<{
  channelId: string;
  messages: Message[];
  currentUid: string;
  uidMode: UIDMode;
  disclosureMessage: string;
  appVersion: string;
  runtimeLabel: string;
}>();

const emit = defineEmits<{
  toggleUidMode: [];
}>();
</script>

<template>
  <main class="chat-pane">
    <section class="chat-stage">
      <div class="chat-stage-inner">
        <section class="disclosure-banner">
          <p class="disclosure-title">Identity Disclosure</p>
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
          <article v-for="message in messages" :key="message.id" class="message-row">
            <header>
              <strong>{{ message.authorUID }}</strong>
              <time>{{ message.sentAt }}</time>
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
      <input type="text" :placeholder="`Message #${channelId}`" aria-label="Message composer" />
      <div class="composer-actions">
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
