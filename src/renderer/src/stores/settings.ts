import { defineStore } from "pinia";
import {
  defaultSettings, defaultShortcuts, isValidShortcut, normalizeSettings, shortcutConflict,
  type NotificationPolicy, type SettingsData, type ShortcutAction
} from "./settingsModel";

const STORAGE_KEY = "openchat.settings.v1";
const LEGACY_MUTE_KEY = "openchat.chat-notification-prefs.v1";

function readSettings(): SettingsData {
  if (typeof window === "undefined") return defaultSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_MUTE_KEY);
    let persisted: unknown = null;
    let legacy: { mutedServerIds?: unknown } | null = null;
    try { persisted = raw ? JSON.parse(raw) as unknown : null; } catch { /* Invalid settings fall back field by field. */ }
    try { legacy = legacyRaw ? JSON.parse(legacyRaw) as { mutedServerIds?: unknown } : null; } catch { /* Ignore corrupt legacy preferences. */ }
    return normalizeSettings(persisted,
      Array.isArray(legacy?.mutedServerIds) ? legacy.mutedServerIds.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return defaultSettings();
  }
}

export const useSettingsStore = defineStore("settings", {
  state: () => ({ ...defaultSettings(), hydrated: false, persistenceError: false }),
  actions: {
    hydrate(): void {
      if (this.hydrated) return;
      this.$patch(readSettings());
      this.hydrated = true;
      this.applyAppearance();
    },
    persist(): void {
      try {
        const data: SettingsData = {
          theme: this.theme, contrast: this.contrast, motion: this.motion, textScale: this.textScale,
          shortcuts: this.shortcuts, notificationsEnabled: this.notificationsEnabled,
          notificationSound: this.notificationSound, notificationPreview: this.notificationPreview,
          notificationPolicyByServer: this.notificationPolicyByServer,
          previousNotificationPolicyByServer: this.previousNotificationPolicyByServer,
          mutedChannelIdsByServer: this.mutedChannelIdsByServer,
          hideMutedChannelsByServer: this.hideMutedChannelsByServer,
          presenceStatus: this.presenceStatus
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...data }));
        this.persistenceError = false;
      } catch {
        this.persistenceError = true;
      }
    },
    applyAppearance(): void {
      if (typeof document === "undefined") return;
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const highContrast = window.matchMedia("(prefers-contrast: more)").matches || window.matchMedia("(forced-colors: active)").matches;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const root = document.documentElement;
      root.dataset.theme = this.theme === "system" ? dark ? "dark" : "light" : this.theme;
      root.dataset.contrast = this.contrast === "system" ? highContrast ? "high" : "standard" : this.contrast;
      root.dataset.motion = this.motion === "system" ? reducedMotion ? "reduced" : "full" : this.motion;
      root.style.fontSize = `${this.textScale}%`;
    },
    setAppearance(patch: Partial<Pick<SettingsData, "theme" | "contrast" | "motion" | "textScale">>): void {
      this.$patch(patch);
      this.applyAppearance();
      this.persist();
    },
    setNotificationPreference(patch: Partial<Pick<SettingsData, "notificationsEnabled" | "notificationSound" | "notificationPreview" | "presenceStatus">>): void {
      this.$patch(patch);
      this.persist();
    },
    policyFor(serverId: string): NotificationPolicy {
      return this.notificationPolicyByServer[serverId] ?? "all";
    },
    setPolicy(serverId: string, policy: NotificationPolicy): void {
      if (!serverId.trim()) return;
      const previous = this.policyFor(serverId);
      if (policy === "off" && previous !== "off") this.previousNotificationPolicyByServer[serverId] = previous;
      this.notificationPolicyByServer[serverId] = policy;
      this.persist();
    },
    toggleMute(serverId: string): void {
      this.setPolicy(serverId, this.policyFor(serverId) === "off" ? this.previousNotificationPolicyByServer[serverId] ?? "all" : "off");
    },
    channelMutedFor(serverId: string, channelId: string): boolean {
      return (this.mutedChannelIdsByServer[serverId] ?? []).includes(channelId);
    },
    toggleChannelMute(serverId: string, channelId: string): void {
      if (!serverId.trim() || !channelId.trim()) return;
      const next = new Set(this.mutedChannelIdsByServer[serverId] ?? []);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      this.mutedChannelIdsByServer[serverId] = [...next];
      this.persist();
    },
    toggleHideMutedChannels(serverId: string): void {
      if (!serverId.trim()) return;
      this.hideMutedChannelsByServer[serverId] = !this.hideMutedChannelsByServer[serverId];
      this.persist();
    },
    clearServer(serverId: string): void {
      delete this.notificationPolicyByServer[serverId];
      delete this.previousNotificationPolicyByServer[serverId];
      delete this.mutedChannelIdsByServer[serverId];
      delete this.hideMutedChannelsByServer[serverId];
      this.persist();
    },
    setShortcut(action: ShortcutAction, shortcut: string): string | null {
      if (!isValidShortcut(shortcut)) return "Use a supported key combination that does not override a system shortcut.";
      const conflict = shortcutConflict(this.shortcuts, action, shortcut);
      if (conflict) return `Already assigned to ${conflict}.`;
      this.shortcuts[action] = shortcut;
      this.persist();
      return null;
    },
    resetShortcut(action: ShortcutAction): void {
      const conflict = shortcutConflict(this.shortcuts, action, defaultShortcuts[action]);
      if (conflict) this.shortcuts[conflict] = this.shortcuts[action];
      this.shortcuts[action] = defaultShortcuts[action];
      this.persist();
    },
    resetShortcuts(): void {
      this.shortcuts = { ...defaultShortcuts };
      this.persist();
    }
  }
});
