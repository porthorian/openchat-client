import { defineStore } from "pinia";

type ViewMode = "comfortable" | "compact";

export const useAppUIStore = defineStore("app-ui", {
  state: () => ({
    activeServerId: "srv_harbor",
    activeChannelId: "ch_general",
    channelFilter: "",
    viewMode: "comfortable" as ViewMode
  }),
  actions: {
    setActiveServer(serverId: string): void {
      this.activeServerId = serverId;
      this.activeChannelId = "ch_general";
      this.channelFilter = "";
    },
    setActiveChannel(channelId: string): void {
      this.activeChannelId = channelId;
    },
    setChannelFilter(value: string): void {
      this.channelFilter = value;
    }
  }
});
