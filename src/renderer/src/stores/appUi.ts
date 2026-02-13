import { defineStore } from "pinia";

type ViewMode = "comfortable" | "compact";

export const useAppUIStore = defineStore("app-ui", {
  state: () => ({
    activeServerId: "",
    activeChannelId: "",
    activeChannelByServer: {} as Record<string, string>,
    channelFilter: "",
    channelFilterByServer: {} as Record<string, string>,
    viewMode: "comfortable" as ViewMode,
    membersPaneOpen: true
  }),
  actions: {
    setActiveServer(serverId: string): void {
      this.activeServerId = serverId;
      this.activeChannelId = this.activeChannelByServer[serverId] ?? "";
      this.channelFilter = this.channelFilterByServer[serverId] ?? "";
    },
    setActiveChannel(channelId: string): void {
      this.activeChannelId = channelId;
      if (this.activeServerId) {
        this.activeChannelByServer[this.activeServerId] = channelId;
      }
    },
    setChannelFilter(value: string): void {
      this.channelFilter = value;
      if (this.activeServerId) {
        this.channelFilterByServer[this.activeServerId] = value;
      }
    },
    clearServerContext(serverId: string): void {
      delete this.activeChannelByServer[serverId];
      delete this.channelFilterByServer[serverId];
      if (this.activeServerId === serverId) {
        this.activeChannelId = "";
        this.channelFilter = "";
      }
    },
    toggleMembersPane(): void {
      this.membersPaneOpen = !this.membersPaneOpen;
    },
    setMembersPaneOpen(isOpen: boolean): void {
      this.membersPaneOpen = isOpen;
    }
  }
});
