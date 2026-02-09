import { contextBridge, ipcRenderer } from "electron";
import { IPCChannels, type RuntimeInfo } from "../shared/ipc";

const api = {
  getAppVersion: async (): Promise<string> => ipcRenderer.invoke(IPCChannels.AppVersion),
  getRuntimeInfo: async (): Promise<RuntimeInfo> => ipcRenderer.invoke(IPCChannels.RuntimeInfo)
};

contextBridge.exposeInMainWorld("openchat", api);
