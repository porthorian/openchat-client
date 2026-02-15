<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mdiAccountMultiplePlus,
  mdiChevronDown,
  mdiCogOutline,
  mdiMessage,
  mdiPlus,
  mdiPound,
  mdiVolumeHigh
} from "@mdi/js";
import AppIcon from "./AppIcon.vue";
import VoicePresencePopover from "./VoicePresencePopover.vue";

type Channel = {
  id: string;
  name: string;
  type: "text" | "voice";
  unreadCount?: number;
};

type ChannelGroup = {
  id: string;
  label: string;
  kind: "text" | "voice";
  channels: Channel[];
};

type VoiceMood = "chilling" | "gaming" | "studying" | "brb" | "watching stuff";

type VoiceParticipant = {
  id: string;
  name: string;
  avatarText: string;
  avatarColor: string;
  mood: VoiceMood;
  badgeEmoji?: string;
};

const props = defineProps<{
  serverName: string;
  serverBuildVersion: string | null;
  serverBuildCommit: string | null;
  groups: ChannelGroup[];
  activeChannelId: string;
  activeVoiceChannelId: string | null;
  voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
  voiceSpeakingParticipantIdsByChannel: Record<string, string[]>;
  filterValue: string;
}>();

const emit = defineEmits<{
  selectChannel: [channelId: string];
  selectVoiceChannel: [channelId: string];
  updateFilter: [value: string];
  markChannelsRead: [channelIds: string[]];
}>();

type ChannelPaneMenuState = {
  open: boolean;
  x: number;
  y: number;
  categoryId: string | null;
};

type GuildHeaderMenuState = {
  open: boolean;
  x: number;
  y: number;
};

type VoicePresencePopoverState = {
  open: boolean;
  x: number;
  y: number;
  participant: VoiceParticipant | null;
};

const collapsedGroupIds = ref<Set<string>>(new Set());
const channelPaneMenu = ref<ChannelPaneMenuState>({
  open: false,
  x: 0,
  y: 0,
  categoryId: null
});
const guildHeaderMenu = ref<GuildHeaderMenuState>({
  open: false,
  x: 0,
  y: 0
});
const hideMutedChannels = ref(false);
const voicePresencePopover = ref<VoicePresencePopoverState>({
  open: false,
  x: 0,
  y: 0,
  participant: null
});
const channelPaneRef = ref<HTMLElement | null>(null);

let voicePopoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
const serverBuildLabel = computed(() => {
  const buildVersion = props.serverBuildVersion?.trim() || "unknown";
  const commit = props.serverBuildCommit?.trim() || "unknown";
  const commitLabel = commit.length > 12 ? commit.slice(0, 12) : commit;
  return `build ${buildVersion} · ${commitLabel}`;
});

function isGroupCollapsed(groupId: string): boolean {
  return collapsedGroupIds.value.has(groupId);
}

function toggleGroupCollapse(groupId: string): void {
  const next = new Set(collapsedGroupIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedGroupIds.value = next;
}

function closeChannelPaneMenu(): void {
  channelPaneMenu.value.open = false;
  channelPaneMenu.value.categoryId = null;
}

function openChannelPaneMenu(event: MouseEvent, categoryId: string | null = null): void {
  closeGuildHeaderMenu();
  closeVoicePresencePopover();
  const menuWidth = 236;
  const menuHeight = 208;
  const boundedX = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
  const boundedY = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
  channelPaneMenu.value = {
    open: true,
    x: boundedX,
    y: boundedY,
    categoryId
  };
}

function openChannelPaneMenuFromList(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".category-header-row")) return;
  if (target?.closest(".channel-row")) return;
  if (target?.closest(".voice-member-row")) return;
  if (target?.closest(".channel-pane-menu")) return;
  openChannelPaneMenu(event, null);
}

function closeGuildHeaderMenu(): void {
  guildHeaderMenu.value.open = false;
}

function toggleGuildHeaderMenu(event: MouseEvent): void {
  const trigger = event.currentTarget as HTMLElement | null;
  if (!trigger) return;
  if (guildHeaderMenu.value.open) {
    closeGuildHeaderMenu();
    return;
  }
  closeChannelPaneMenu();
  closeVoicePresencePopover();
  const triggerRect = trigger.getBoundingClientRect();
  const menuWidth = 248;
  const menuHeight = 398;
  const boundedX = Math.max(8, Math.min(triggerRect.left, window.innerWidth - menuWidth - 8));
  const boundedY = Math.max(8, Math.min(triggerRect.bottom + 6, window.innerHeight - menuHeight - 8));
  guildHeaderMenu.value = {
    open: true,
    x: boundedX,
    y: boundedY
  };
}

function runGuildHeaderAction(): void {
  closeGuildHeaderMenu();
}

function runChannelPaneAction(): void {
  closeChannelPaneMenu();
}

function toggleHideMutedChannels(): void {
  hideMutedChannels.value = !hideMutedChannels.value;
}

function participantsForVoiceChannel(channelId: string): VoiceParticipant[] {
  return props.voiceParticipantsByChannel[channelId] ?? [];
}

function isVoiceParticipantSpeaking(channelId: string, participantId: string): boolean {
  const speaking = props.voiceSpeakingParticipantIdsByChannel[channelId] ?? [];
  return speaking.includes(participantId);
}

function hasVoiceParticipants(channelId: string): boolean {
  return participantsForVoiceChannel(channelId).length > 0;
}

function clearVoicePopoverCloseTimer(): void {
  if (voicePopoverCloseTimer !== null) {
    clearTimeout(voicePopoverCloseTimer);
    voicePopoverCloseTimer = null;
  }
}

function closeVoicePresencePopover(): void {
  clearVoicePopoverCloseTimer();
  voicePresencePopover.value.open = false;
  voicePresencePopover.value.participant = null;
}

function scheduleVoicePresencePopoverClose(): void {
  clearVoicePopoverCloseTimer();
  voicePopoverCloseTimer = setTimeout(() => {
    voicePresencePopover.value.open = false;
    voicePresencePopover.value.participant = null;
  }, 120);
}

function openVoicePresencePopover(participant: VoiceParticipant, event: MouseEvent): void {
  closeGuildHeaderMenu();
  closeChannelPaneMenu();
  clearVoicePopoverCloseTimer();

  const channelPaneRect = channelPaneRef.value?.getBoundingClientRect();
  const rowRect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
  const popoverWidth = 272;
  const popoverHeight = 250;
  const preferredX = (channelPaneRect?.right ?? 8) + 10;
  const preferredY = (rowRect?.top ?? event.clientY) + (rowRect?.height ?? 0) / 2 - popoverHeight / 2;
  const boundedX = Math.max(8, Math.min(preferredX, window.innerWidth - popoverWidth - 8));
  const boundedY = Math.max(8, Math.min(preferredY, window.innerHeight - popoverHeight - 8));
  voicePresencePopover.value = {
    open: true,
    x: boundedX,
    y: boundedY,
    participant
  };
}

function onWindowPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".guild-menu") && !target?.closest(".guild-header-name-btn")) {
    closeGuildHeaderMenu();
  }

  if (
    !target?.closest(".channel-pane-menu") &&
    !target?.closest(".category-header-row") &&
    !target?.closest(".category-plus-btn")
  ) {
    closeChannelPaneMenu();
  }

  if (!target?.closest(".voice-presence-popover") && !target?.closest(".voice-member-row")) {
    closeVoicePresencePopover();
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeGuildHeaderMenu();
    closeChannelPaneMenu();
    closeVoicePresencePopover();
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("keydown", onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowKeydown);
  clearVoicePopoverCloseTimer();
});
</script>

<template>
  <aside ref="channelPaneRef" class="channel-pane">
    <header class="guild-header">
      <div class="guild-header-copy">
        <button
          type="button"
          class="guild-header-name-btn"
          aria-label="Open server actions"
          :aria-expanded="guildHeaderMenu.open"
          aria-haspopup="menu"
          @click="toggleGuildHeaderMenu"
        >
          <span class="guild-header-name">{{ serverName }}</span>
          <AppIcon :path="mdiChevronDown" :size="16" class="guild-header-name-chevron" :class="{ 'is-open': guildHeaderMenu.open }" />
        </button>
        <small class="guild-header-build">{{ serverBuildLabel }}</small>
      </div>
      <button type="button" class="guild-header-action" aria-label="Invite people">
        <AppIcon :path="mdiAccountMultiplePlus" :size="36" />
      </button>
    </header>
    <section
      v-if="guildHeaderMenu.open"
      class="guild-menu"
      role="menu"
      aria-label="Server quick actions"
      :style="{ left: `${guildHeaderMenu.x}px`, top: `${guildHeaderMenu.y}px` }"
    >
      <button type="button" class="guild-menu-item" role="menuitem" @click="runGuildHeaderAction">
        Invite to Server
        <span class="guild-menu-icon">
          <AppIcon :path="mdiAccountMultiplePlus" :size="17" />
        </span>
      </button>
      <button type="button" class="guild-menu-item" role="menuitem" @click="runGuildHeaderAction">
        Server Settings
        <span class="guild-menu-icon">
          <AppIcon :path="mdiCogOutline" :size="17" />
        </span>
      </button>
      <button type="button" class="guild-menu-item" role="menuitem" @click="runGuildHeaderAction">
        Create Channel
        <span class="guild-menu-icon">
          <AppIcon :path="mdiPlus" :size="17" />
        </span>
      </button>
      <button type="button" class="guild-menu-item" role="menuitem" @click="runGuildHeaderAction">
        Create Category
        <span class="guild-menu-icon">
          <AppIcon :path="mdiPlus" :size="17" />
        </span>
      </button>
      <button type="button" class="guild-menu-item" role="menuitem" @click="runGuildHeaderAction">
        Create Event
        <span class="guild-menu-icon">
          <AppIcon :path="mdiPlus" :size="17" />
        </span>
      </button>

      <div class="guild-menu-divider" />

      <button type="button" class="guild-menu-item" role="menuitem" @click="runGuildHeaderAction">
        Notification Settings
        <span class="guild-menu-icon">
          <AppIcon :path="mdiCogOutline" :size="17" />
        </span>
      </button>
      <button type="button" class="guild-menu-item" role="menuitem" @click="runGuildHeaderAction">
        Privacy Settings
        <span class="guild-menu-icon">
          <AppIcon :path="mdiCogOutline" :size="17" />
        </span>
      </button>

      <div class="guild-menu-divider" />

      <button type="button" class="guild-menu-item" role="menuitem" @click="runGuildHeaderAction">
        Edit Per-server Profile
        <span class="guild-menu-icon">
          <AppIcon :path="mdiCogOutline" :size="17" />
        </span>
      </button>
      <button
        type="button"
        class="guild-menu-item"
        role="menuitemcheckbox"
        :aria-checked="hideMutedChannels"
        @click="toggleHideMutedChannels"
      >
        Hide Muted Channels
        <span class="guild-menu-checkbox" :class="{ 'is-checked': hideMutedChannels }" />
      </button>
    </section>

    <label class="filter-row guild-filter">
      <span class="sr-only">Filter channels</span>
      <input
        type="text"
        :value="filterValue"
        placeholder="Filter channels"
        @input="emit('updateFilter', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <div class="channel-list" @contextmenu.prevent="openChannelPaneMenuFromList($event)">
      <section
        v-for="group in groups"
        :key="group.id"
        class="channel-group"
        :class="{ 'is-collapsed': isGroupCollapsed(group.id) }"
      >
        <div
          class="category-header-row"
          :class="{ 'is-voice-label': group.kind === 'voice' }"
          @contextmenu.prevent.stop="openChannelPaneMenu($event, group.id)"
        >
          <button
            type="button"
            class="category-header"
            @click="toggleGroupCollapse(group.id)"
          >
            <span class="category-chevron" :class="{ 'is-collapsed': isGroupCollapsed(group.id) }">
              <AppIcon :path="mdiChevronDown" :size="12" />
            </span>
            <span class="category-label">{{ group.label }}</span>
          </button>
          <button
            type="button"
            class="category-plus-btn"
            aria-label="Category actions"
            @click.stop="openChannelPaneMenu($event, group.id)"
          >
            <AppIcon :path="mdiPlus" :size="26" />
          </button>
        </div>

        <div v-show="!isGroupCollapsed(group.id)" class="channel-group-body">
          <div v-for="channel in group.channels" :key="channel.id" class="channel-entry">
            <button
              type="button"
              class="channel-row"
              :class="{
                'is-active': channel.type === 'text' && channel.id === activeChannelId,
                'is-voice': channel.type === 'voice',
                'is-connected': channel.type === 'voice' && channel.id === activeVoiceChannelId
              }"
              @click="
                channel.type === 'voice' ? emit('selectVoiceChannel', channel.id) : emit('selectChannel', channel.id)
              "
            >
              <span class="channel-symbol">
                <AppIcon :path="channel.type === 'voice' ? mdiVolumeHigh : mdiPound" :size="14" />
              </span>
              <span class="channel-name">{{ channel.name }}</span>
              <span v-if="channel.type === 'voice' && hasVoiceParticipants(channel.id)" class="voice-channel-meta">
                <AppIcon :path="mdiMessage" :size="14" />
              </span>
              <span
                v-if="channel.type === 'text' && (channel.unreadCount ?? 0) > 0"
                class="badge"
              >
                {{ channel.unreadCount }}
              </span>
            </button>

            <div v-if="channel.type === 'voice' && hasVoiceParticipants(channel.id)" class="voice-member-list">
              <article
                v-for="participant in participantsForVoiceChannel(channel.id)"
                :key="participant.id"
                class="voice-member-row"
                :class="{ 'is-speaking': isVoiceParticipantSpeaking(channel.id, participant.id) }"
                @mouseenter="openVoicePresencePopover(participant, $event)"
                @mouseleave="scheduleVoicePresencePopoverClose"
              >
                <span
                  class="voice-member-avatar"
                  :class="{ 'is-speaking': isVoiceParticipantSpeaking(channel.id, participant.id) }"
                  :style="{ background: participant.avatarColor }"
                >
                  {{ participant.avatarText }}
                </span>
                <span class="voice-member-name">
                  {{ participant.name }}
                </span>
                <span v-if="participant.badgeEmoji" class="voice-member-badge">{{ participant.badgeEmoji }}</span>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section
        v-if="channelPaneMenu.open"
        class="channel-pane-menu"
        role="menu"
        aria-label="Channel pane actions"
        :style="{ left: `${channelPaneMenu.x}px`, top: `${channelPaneMenu.y}px` }"
      >
        <button
          type="button"
          class="channel-pane-menu-item"
          role="menuitemcheckbox"
          :aria-checked="hideMutedChannels"
          @click="toggleHideMutedChannels"
        >
          Hide Muted Channels
          <span class="channel-pane-menu-checkbox" :class="{ 'is-checked': hideMutedChannels }" />
        </button>

        <div class="channel-pane-menu-divider" />

        <button type="button" class="channel-pane-menu-item" role="menuitem" @click="runChannelPaneAction">
          Create Channel
        </button>
        <button type="button" class="channel-pane-menu-item" role="menuitem" @click="runChannelPaneAction">
          Create Category
        </button>
        <button type="button" class="channel-pane-menu-item" role="menuitem" @click="runChannelPaneAction">
          Invite to Server
        </button>
      </section>

      <VoicePresencePopover
        :open="voicePresencePopover.open"
        :x="voicePresencePopover.x"
        :y="voicePresencePopover.y"
        :participant="voicePresencePopover.participant"
        @mouseenter="clearVoicePopoverCloseTimer"
        @mouseleave="scheduleVoicePresencePopoverClose"
      />
    </div>

  </aside>
</template>
