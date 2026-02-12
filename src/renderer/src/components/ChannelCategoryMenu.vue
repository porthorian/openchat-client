<script setup lang="ts">
import { mdiCheckboxBlankOutline, mdiCheckboxMarked, mdiChevronRight } from "@mdi/js";
import AppIcon from "./AppIcon.vue";

defineProps<{
  open: boolean;
  x: number;
  y: number;
  isCollapsed: boolean;
}>();

const emit = defineEmits<{
  markAsRead: [];
  collapseCategory: [];
  collapseAll: [];
  close: [];
}>();
</script>

<template>
  <div
    v-if="open"
    class="category-menu"
    role="menu"
    aria-label="Category options"
    :style="{ left: `${x}px`, top: `${y}px` }"
  >
    <button type="button" class="category-menu-item" @click="emit('markAsRead')">
      <span>Mark As Read</span>
    </button>

    <div class="category-menu-divider" />

    <button type="button" class="category-menu-item" @click="emit('collapseCategory')">
      <span>Collapse Category</span>
      <span class="category-menu-trailing">
        <AppIcon :path="isCollapsed ? mdiCheckboxMarked : mdiCheckboxBlankOutline" :size="16" />
      </span>
    </button>

    <button type="button" class="category-menu-item" @click="emit('collapseAll')">
      <span>Collapse All Categories</span>
    </button>

    <div class="category-menu-divider" />

    <button type="button" class="category-menu-item" @click="emit('close')">
      <span>Mute Category</span>
      <span class="category-menu-trailing">
        <AppIcon :path="mdiChevronRight" :size="16" />
      </span>
    </button>

    <button type="button" class="category-menu-item is-notification" @click="emit('close')">
      <span class="category-menu-copy">
        <span>Notification Settings</span>
        <small>Only @mentions</small>
      </span>
      <span class="category-menu-trailing">
        <AppIcon :path="mdiChevronRight" :size="16" />
      </span>
    </button>
  </div>
</template>
