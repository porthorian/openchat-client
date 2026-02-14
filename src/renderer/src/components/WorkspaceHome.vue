<script setup lang="ts">
import AddServerDialog from "./AddServerDialog.vue";
import AppTaskbar from "./AppTaskbar.vue";
import ChannelPane from "./ChannelPane.vue";
import ChatPane from "./ChatPane.vue";
import MembersPane from "./MembersPane.vue";
import ServerRail from "./ServerRail.vue";
import WorkspaceToolbar from "./WorkspaceToolbar.vue";
import { useWorkspaceShell } from "@renderer/composables/useWorkspaceShell";

const shell = useWorkspaceShell();
</script>

<template>
  <div class="app-shell" :class="shell.appShellClasses.value">
    <AppTaskbar v-bind="shell.taskbarProps.value" />

    <section class="layout" :class="shell.layoutClasses.value">
      <ServerRail v-bind="shell.serverRailProps.value" v-on="shell.serverRailListeners" />
      <ChannelPane v-bind="shell.channelPaneProps.value" v-on="shell.channelPaneListeners" />
      <WorkspaceToolbar v-bind="shell.workspaceToolbarProps.value" v-on="shell.workspaceToolbarListeners" />
      <ChatPane class="chat-pane-slot" v-bind="shell.chatPaneProps.value" v-on="shell.chatPaneListeners" />
      <MembersPane class="members-pane-slot" v-bind="shell.membersPaneProps.value" v-on="shell.membersPaneListeners" />
    </section>

    <AddServerDialog v-bind="shell.addServerDialogProps.value" v-on="shell.addServerDialogListeners" />
  </div>
</template>
