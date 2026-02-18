<script setup lang="ts">
defineProps<{
  isOpen: boolean;
  currentVersion: string;
  runtimeLabel: string;
  updateStatusLabel: string;
  latestVersion: string | null;
  lastCheckedAtLabel: string;
  githubUrl: string;
  issuesUrl: string;
}>();

const emit = defineEmits<{
  close: [];
  checkAgain: [];
}>();
</script>

<template>
  <div v-if="isOpen" class="version-info-backdrop" role="presentation" @click.self="emit('close')">
    <section class="version-info-modal" role="dialog" aria-modal="true" aria-label="Client version information">
      <header>
        <h3>Client information</h3>
        <button type="button" class="version-info-close" @click="emit('close')">Close</button>
      </header>

      <p class="version-info-summary">Build and update details for your current OpenChat client.</p>

      <dl class="version-info-grid">
        <div>
          <dt>Client version</dt>
          <dd>{{ currentVersion }}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{{ runtimeLabel }}</dd>
        </div>
        <div>
          <dt>Update status</dt>
          <dd>{{ updateStatusLabel }}</dd>
        </div>
        <div>
          <dt>Latest available</dt>
          <dd>{{ latestVersion ?? "None detected" }}</dd>
        </div>
        <div>
          <dt>Last checked</dt>
          <dd>{{ lastCheckedAtLabel }}</dd>
        </div>
      </dl>

      <div class="version-info-links">
        <a :href="githubUrl" target="_blank" rel="noopener noreferrer">Open GitHub repository</a>
        <a :href="issuesUrl" target="_blank" rel="noopener noreferrer">Post an issue</a>
      </div>

      <footer class="version-info-actions">
        <button type="button" class="version-info-btn" @click="emit('checkAgain')">Check again</button>
      </footer>
    </section>
  </div>
</template>
