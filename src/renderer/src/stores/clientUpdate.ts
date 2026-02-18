import { defineStore } from "pinia";
import type { ClientUpdateSnapshot, ProjectLinks } from "@shared/ipc";

const defaultProjectLinks: ProjectLinks = {
  githubUrl: "https://github.com/porthorian/openchat-client",
  issuesUrl: "https://github.com/porthorian/openchat-client/issues"
};

function createDefaultSnapshot(): ClientUpdateSnapshot {
  return {
    status: "idle",
    currentVersion: "0.0.0",
    latestVersion: null,
    releaseNotesUrl: null,
    downloadUrl: null,
    progressPercent: null,
    lastCheckedAt: null,
    errorMessage: null,
    updaterAvailable: true,
    updaterUnavailableReason: null
  };
}

type ClientUpdateState = ClientUpdateSnapshot & {
  projectLinks: ProjectLinks;
  isInitialized: boolean;
  isVersionInfoModalOpen: boolean;
  isUpdateProgressModalOpen: boolean;
  hasPresentedVersionInfoModal: boolean;
  isUpdaterNoticeDismissed: boolean;
};

export const useClientUpdateStore = defineStore("client-update", {
  state: (): ClientUpdateState => ({
    ...createDefaultSnapshot(),
    projectLinks: defaultProjectLinks,
    isInitialized: false,
    isVersionInfoModalOpen: false,
    isUpdateProgressModalOpen: false,
    hasPresentedVersionInfoModal: false,
    isUpdaterNoticeDismissed: false
  }),
  getters: {
    shouldShowTaskbarDownloadButton(state): boolean {
      return (
        state.status === "available" ||
        state.status === "downloading" ||
        state.status === "downloaded" ||
        state.status === "error"
      );
    },
    shouldShowUpdaterNotice(state): boolean {
      return !state.updaterAvailable && Boolean(state.updaterUnavailableReason) && !state.isUpdaterNoticeDismissed;
    }
  },
  actions: {
    applySnapshot(snapshot: ClientUpdateSnapshot): void {
      const previousStatus = this.status;
      const previousCheckedAt = this.lastCheckedAt;

      this.status = snapshot.status;
      this.currentVersion = snapshot.currentVersion;
      this.latestVersion = snapshot.latestVersion;
      this.releaseNotesUrl = snapshot.releaseNotesUrl;
      this.downloadUrl = snapshot.downloadUrl;
      this.progressPercent = snapshot.progressPercent;
      this.lastCheckedAt = snapshot.lastCheckedAt;
      this.errorMessage = snapshot.errorMessage;
      this.updaterAvailable = snapshot.updaterAvailable;
      this.updaterUnavailableReason = snapshot.updaterUnavailableReason;

      if (snapshot.updaterAvailable) {
        this.isUpdaterNoticeDismissed = false;
      }

      if (
        previousStatus === "checking" &&
        snapshot.status === "idle" &&
        snapshot.lastCheckedAt &&
        snapshot.lastCheckedAt !== previousCheckedAt &&
        !snapshot.latestVersion &&
        !snapshot.errorMessage &&
        !this.hasPresentedVersionInfoModal
      ) {
        this.isVersionInfoModalOpen = true;
        this.hasPresentedVersionInfoModal = true;
      }

      if (snapshot.status === "available" || snapshot.status === "downloading" || snapshot.status === "downloaded") {
        this.isVersionInfoModalOpen = false;
      }

      if (snapshot.status === "downloading") {
        this.isUpdateProgressModalOpen = true;
      }

      if (snapshot.status === "idle") {
        this.isUpdateProgressModalOpen = false;
      }
    },

    async initialize(): Promise<void> {
      if (this.isInitialized) return;

      const [snapshot, projectLinks] = await Promise.all([
        window.openchat.updates.getStatus(),
        window.openchat.getProjectLinks()
      ]);
      this.projectLinks = projectLinks;
      this.applySnapshot(snapshot);

      window.openchat.updates.onStatusChanged((nextSnapshot) => {
        this.applySnapshot(nextSnapshot);
      });

      this.isInitialized = true;
    },

    async checkForUpdates(): Promise<void> {
      const snapshot = await window.openchat.updates.checkForUpdates();
      this.applySnapshot(snapshot);
    },

    async downloadUpdate(): Promise<void> {
      const snapshot = await window.openchat.updates.downloadUpdate();
      this.applySnapshot(snapshot);
    },

    async quitAndInstall(): Promise<void> {
      const snapshot = await window.openchat.updates.quitAndInstall();
      this.applySnapshot(snapshot);
    },

    closeVersionInfoModal(): void {
      this.isVersionInfoModalOpen = false;
    },

    openVersionInfoModal(): void {
      this.isVersionInfoModalOpen = true;
    },

    dismissUpdaterNotice(): void {
      this.isUpdaterNoticeDismissed = true;
    },

    openUpdateProgressModal(): void {
      this.isUpdateProgressModalOpen = true;
    },

    closeUpdateProgressModal(): void {
      this.isUpdateProgressModalOpen = false;
    }
  }
});
