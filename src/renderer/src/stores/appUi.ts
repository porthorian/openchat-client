import { defineStore } from "pinia";

type ViewMode = "comfortable" | "compact";

export const useAppUIStore = defineStore("app-ui", {
  state: () => ({
    activeServerId: "",
    activeChannelId: "",
    channelFilter: "",
    viewMode: "comfortable" as ViewMode,
    membersPaneOpen: true
  }),
  actions: {
    setActiveServer(serverId: string): void {
      this.activeServerId = serverId;
      this.activeChannelId = "";
      this.channelFilter = "";
    },
    setActiveChannel(channelId: string): void {
      this.activeChannelId = channelId;
    },
    setChannelFilter(value: string): void {
      this.channelFilter = value;
    },
    toggleMembersPane(): void {
      this.membersPaneOpen = !this.membersPaneOpen;
    },
    setMembersPaneOpen(isOpen: boolean): void {
      this.membersPaneOpen = isOpen;
    }
  }
});
