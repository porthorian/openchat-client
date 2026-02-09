<script setup lang="ts">
withDefaults(
  defineProps<{
    path: string;
    size?: number;
    title?: string;
  }>(),
  {
    size: 18,
    title: ""
  }
);
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    role="img"
    :aria-hidden="title ? 'false' : 'true'"
  >
    <title v-if="title">{{ title }}</title>
    <path :d="path" fill="currentColor" />
  </svg>
</template>
