<script setup lang="ts">
import { mdiChevronRight } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

type MemberItem = {
  id: string;
  name: string;
  status: "online" | "idle" | "dnd";
  avatarText?: string;
  avatarBackground?: string;
  avatarImageDataUrl?: string | null;
  avatarTextColor?: string;
};

defineProps<{
  members: MemberItem[];
  isOpen: boolean;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <aside class="members-pane" :class="{ 'is-collapsed': !isOpen }">
    <header>
      <h3>{{ title ?? "Online" }} - {{ members.length }}</h3>
      <button type="button" class="members-close" @click="emit('close')">
        <AppIcon :path="mdiChevronRight" :size="18" />
      </button>
    </header>

    <div class="member-list">
      <p v-if="subtitle" class="member-list-subtitle">{{ subtitle }}</p>
      <p v-if="members.length === 0" class="member-list-empty">{{ emptyMessage ?? "No users connected." }}</p>
      <article v-for="member in members" :key="member.id" class="member-row">
        <div
          class="member-avatar"
          :style="{
            background: member.avatarBackground ?? '#4a4f5d',
            color: member.avatarTextColor ?? '#eceef3'
          }"
        >
          <img v-if="member.avatarImageDataUrl" class="member-avatar-image" :src="member.avatarImageDataUrl" alt="" />
          <template v-else>{{ member.avatarText ?? member.name.slice(0, 1) }}</template>
          <span class="member-dot" :class="`is-${member.status}`" />
        </div>
        <p>{{ member.name }}</p>
      </article>
    </div>
  </aside>
</template>
