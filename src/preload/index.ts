import { contextBridge, ipcRenderer } from "electron";
import {
  IPCChannels,
  type ClientUpdateSnapshot,
  type DesktopCaptureSource,
  type OpenGraphMetadata,
  type ProjectLinks,
  type RuntimeInfo
} from "../shared/ipc";

type UpdateStatusListener = (snapshot: ClientUpdateSnapshot) => void;

const updateStatusListeners = new Set<UpdateStatusListener>();

ipcRenderer.on(IPCChannels.UpdateStatusChanged, (_event, snapshot: ClientUpdateSnapshot) => {
  updateStatusListeners.forEach((listener) => {
    listener(snapshot);
  });
});

const api = {
  getAppVersion: async (): Promise<string> => ipcRenderer.invoke(IPCChannels.AppVersion),
  getRuntimeInfo: async (): Promise<RuntimeInfo> => ipcRenderer.invoke(IPCChannels.RuntimeInfo),
  getProjectLinks: async (): Promise<ProjectLinks> => ipcRenderer.invoke(IPCChannels.ProjectLinks),
  metadata: {
    scrapeOpenGraph: async (url: string): Promise<OpenGraphMetadata | null> =>
      ipcRenderer.invoke(IPCChannels.MetadataScrapeOpenGraph, url)
  },
  rtc: {
    listDesktopCaptureSources: async (): Promise<DesktopCaptureSource[]> => ipcRenderer.invoke(IPCChannels.RTCListDesktopSources)
  },
  updates: {
    getStatus: async (): Promise<ClientUpdateSnapshot> => ipcRenderer.invoke(IPCChannels.UpdateGetStatus),
    checkForUpdates: async (): Promise<ClientUpdateSnapshot> => ipcRenderer.invoke(IPCChannels.UpdateCheckForUpdates),
    downloadUpdate: async (): Promise<ClientUpdateSnapshot> => ipcRenderer.invoke(IPCChannels.UpdateDownload),
    quitAndInstall: async (): Promise<ClientUpdateSnapshot> => ipcRenderer.invoke(IPCChannels.UpdateQuitAndInstall),
    onStatusChanged: (listener: UpdateStatusListener): (() => void) => {
      updateStatusListeners.add(listener);
      return () => {
        updateStatusListeners.delete(listener);
      };
    }
  }
};

contextBridge.exposeInMainWorld("openchat", api);
