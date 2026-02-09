<script setup lang="ts">
import { mdiChevronRight } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

type MemberItem = {
  id: string;
  name: string;
  status: "online" | "idle" | "dnd";
};

defineProps<{
  members: MemberItem[];
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <aside class="members-pane" :class="{ 'is-collapsed': !isOpen }">
    <header>
      <h3>Online - {{ members.length }}</h3>
      <button type="button" class="members-close" @click="emit('close')">
        <AppIcon :path="mdiChevronRight" :size="18" />
      </button>
    </header>

    <div class="member-list">
      <article v-for="member in members" :key="member.id" class="member-row">
        <div class="member-avatar">
          {{ member.name.slice(0, 1) }}
          <span class="member-dot" :class="`is-${member.status}`" />
        </div>
        <p>{{ member.name }}</p>
      </article>
    </div>
  </aside>
</template>
