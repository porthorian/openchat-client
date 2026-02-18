<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiAccountMultiple } from "@mdi/js";
import type { CallConnectionState, CallVideoStream } from "@renderer/stores/call";
import AppIcon from "./AppIcon.vue";
import CallStageVideoTile from "./CallStageVideoTile.vue";

type CallStageParticipantCard = {
  participantId: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  avatarText: string;
  avatarBackground: string;
  avatarTextColor: string;
  avatarImageDataUrl: string | null;
};

const props = defineProps<{
  serverName: string;
  selectedVoiceChannelName: string | null;
  connectedVoiceChannelName: string | null;
  showLiveVideo: boolean;
  helperMessage: string;
  callState: CallConnectionState;
  callParticipantCount: number;
  activeSpeakerParticipantIds: string[];
  participants: CallStageParticipantCard[];
  videoStreams: CallVideoStream[];
}>();

const pinnedStreamKey = ref<string | null>(null);

const stateLabel = computed(() => {
  if (props.callState === "active") return "Connected";
  if (props.callState === "joining") return "Connecting";
  if (props.callState === "reconnecting") return "Reconnecting";
  if (props.callState === "error") return "Disconnected";
  return "Idle";
});

const participantById = computed(() => {
  return props.participants.reduce<Record<string, CallStageParticipantCard>>((summary, participant) => {
    summary[participant.participantId] = participant;
    return summary;
  }, {});
});

const orderedStreams = computed(() => {
  const rank = (stream: CallVideoStream): number => {
    if (!stream.isLocal && stream.kind === "screen") return 0;
    if (!stream.isLocal && stream.kind === "camera") return 1;
    if (stream.isLocal && stream.kind === "screen") return 2;
    return 3;
  };
  return [...props.videoStreams].sort((left, right) => {
    const rankDiff = rank(left) - rank(right);
    if (rankDiff !== 0) return rankDiff;
    return new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime();
  });
});

const heroStream = computed(() => {
  if (!props.showLiveVideo) return null;
  if (!pinnedStreamKey.value) return orderedStreams.value[0] ?? null;
  return orderedStreams.value.find((stream) => stream.streamKey === pinnedStreamKey.value) ?? orderedStreams.value[0] ?? null;
});

const thumbnailStreams = computed(() => {
  if (!props.showLiveVideo || !heroStream.value) return [];
  return orderedStreams.value.filter((stream) => stream.streamKey !== heroStream.value?.streamKey);
});

const participantIdsWithVideo = computed(() => {
  const ids = new Set<string>();
  orderedStreams.value.forEach((stream) => {
    ids.add(stream.participantId);
  });
  return ids;
});

const participantsWithoutVideo = computed(() => {
  if (!props.showLiveVideo) return [];
  return props.participants.filter((participant) => !participantIdsWithVideo.value.has(participant.participantId));
});

function participantLabel(stream: CallVideoStream): string {
  const participant = participantById.value[stream.participantId];
  if (participant?.name?.trim()) return participant.name.trim();
  if (stream.isLocal) return "You";
  const compactUID = stream.userUID.trim();
  if (compactUID.length <= 14) return compactUID || "Guest";
  return `${compactUID.slice(0, 9)}...${compactUID.slice(-4)}`;
}

function togglePinnedStream(streamKey: string): void {
  pinnedStreamKey.value = pinnedStreamKey.value === streamKey ? null : streamKey;
}

watch(
  () => orderedStreams.value.map((stream) => stream.streamKey).join("|"),
  (streamSignature) => {
    if (!streamSignature) {
      pinnedStreamKey.value = null;
      return;
    }
    if (!pinnedStreamKey.value) return;
    const stillVisible = orderedStreams.value.some((stream) => stream.streamKey === pinnedStreamKey.value);
    if (!stillVisible) {
      pinnedStreamKey.value = null;
    }
  },
  { immediate: true }
);

watch(
  () => props.showLiveVideo,
  (showVideo) => {
    if (!showVideo) {
      pinnedStreamKey.value = null;
    }
  }
);
</script>

<template>
  <section class="call-stage">
    <header class="call-stage-header">
      <div class="call-stage-copy">
        <strong>{{ selectedVoiceChannelName ?? "Voice Channel" }}</strong>
        <small>{{ serverName }}</small>
      </div>
      <div class="call-stage-status-wrap">
        <span class="call-stage-status-chip" :class="`is-${callState}`">{{ stateLabel }}</span>
        <span class="call-stage-participants">
          <AppIcon :path="mdiAccountMultiple" :size="16" />
          {{ callParticipantCount }}
        </span>
      </div>
    </header>

    <div class="call-stage-video-frame" :class="{ 'is-empty': !showLiveVideo || !heroStream }">
      <CallStageVideoTile
        v-if="showLiveVideo && heroStream"
        class="call-stage-hero"
        :stream="heroStream.mediaStream"
        :label="participantLabel(heroStream)"
        :kind="heroStream.kind"
        :is-local="heroStream.isLocal"
        :is-speaking="heroStream.participantId ? activeSpeakerParticipantIds.includes(heroStream.participantId) : false"
        :is-pinned="pinnedStreamKey === heroStream.streamKey"
        @toggle-pin="togglePinnedStream(heroStream.streamKey)"
      />
      <div v-else class="call-stage-empty">
        <strong>{{ showLiveVideo ? "No video streams yet" : "Video hidden for this channel" }}</strong>
        <small>{{ helperMessage }}</small>
        <small v-if="connectedVoiceChannelName && connectedVoiceChannelName !== selectedVoiceChannelName">
          Connected: {{ connectedVoiceChannelName }}
        </small>
      </div>

      <div v-if="showLiveVideo && (thumbnailStreams.length > 0 || participantsWithoutVideo.length > 0)" class="call-stage-thumbs">
        <CallStageVideoTile
          v-for="stream in thumbnailStreams"
          :key="stream.streamKey"
          class="call-stage-thumb-tile"
          :stream="stream.mediaStream"
          :label="participantLabel(stream)"
          :kind="stream.kind"
          :is-local="stream.isLocal"
          :is-speaking="stream.participantId ? activeSpeakerParticipantIds.includes(stream.participantId) : false"
          :is-pinned="pinnedStreamKey === stream.streamKey"
          @toggle-pin="togglePinnedStream(stream.streamKey)"
        />

        <article
          v-for="participant in participantsWithoutVideo"
          :key="participant.participantId"
          class="call-stage-placeholder-tile"
          :class="{ 'is-speaking': participant.isSpeaking }"
        >
          <div class="call-stage-placeholder-avatar" :style="{ background: participant.avatarBackground, color: participant.avatarTextColor }">
            <img v-if="participant.avatarImageDataUrl" :src="participant.avatarImageDataUrl" alt="" />
            <span v-else>{{ participant.avatarText }}</span>
          </div>
          <div class="call-stage-placeholder-copy">
            <strong>{{ participant.name }}</strong>
            <small>No video</small>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
