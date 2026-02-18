<script setup lang="ts">
import AddServerDialog from "./AddServerDialog.vue";
import AppTaskbar from "./AppTaskbar.vue";
import CallStage from "./CallStage.vue";
import ChannelPane from "./ChannelPane.vue";
import ChannelPaneUserDock from "./ChannelPaneUserDock.vue";
import ChatPane from "./ChatPane.vue";
import ClientUpdateProgressModal from "./ClientUpdateProgressModal.vue";
import ClientVersionInfoModal from "./ClientVersionInfoModal.vue";
import MembersPane from "./MembersPane.vue";
import ScreenShareSourcePickerModal from "./ScreenShareSourcePickerModal.vue";
import ServerRail from "./ServerRail.vue";
import WorkspaceToolbar from "./WorkspaceToolbar.vue";
import { useWorkspaceShell } from "@renderer/composables/useWorkspaceShell";

const shell = useWorkspaceShell();
</script>

<template>
  <div class="workspace-home-root">
    <div v-show="!shell.updateProgressModalProps.value.isOpen" class="app-shell" :class="shell.appShellClasses.value">
      <AppTaskbar v-bind="shell.taskbarProps.value" v-on="shell.taskbarListeners" />
      <div v-if="shell.updateNoticeBannerProps.value.isVisible" class="update-notice-banner" role="status">
        <span>{{ shell.updateNoticeBannerProps.value.message }}</span>
        <button type="button" class="update-notice-close" @click="shell.updateNoticeBannerListeners.dismiss">Dismiss</button>
      </div>

      <section class="layout" :class="shell.layoutClasses.value">
        <div class="sidebar-stack">
          <ServerRail v-bind="shell.serverRailProps.value" v-on="shell.serverRailListeners" />
          <ChannelPane v-bind="shell.channelPaneProps.value" v-on="shell.channelPaneListeners" />
          <ChannelPaneUserDock v-bind="shell.userDockProps.value" v-on="shell.userDockListeners" />
        </div>
        <WorkspaceToolbar v-bind="shell.workspaceToolbarProps.value" v-on="shell.workspaceToolbarListeners" />
        <CallStage
          v-if="shell.callStageVisible.value"
          class="chat-pane-slot"
          v-bind="shell.callStageProps.value"
        />
        <ChatPane v-else class="chat-pane-slot" v-bind="shell.chatPaneProps.value" v-on="shell.chatPaneListeners" />
        <MembersPane class="members-pane-slot" v-bind="shell.membersPaneProps.value" v-on="shell.membersPaneListeners" />
      </section>

      <AddServerDialog v-bind="shell.addServerDialogProps.value" v-on="shell.addServerDialogListeners" />
    </div>

    <ClientUpdateProgressModal v-bind="shell.updateProgressModalProps.value" v-on="shell.updateProgressModalListeners" />
    <ClientVersionInfoModal v-bind="shell.versionInfoModalProps.value" v-on="shell.versionInfoModalListeners" />
    <ScreenShareSourcePickerModal v-bind="shell.screenSharePickerProps.value" v-on="shell.screenSharePickerListeners" />
  </div>
</template>
