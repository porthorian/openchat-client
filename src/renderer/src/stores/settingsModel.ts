export type ThemePreference = "dark" | "light" | "system";
export type SystemPreference = "system" | "standard" | "high";
export type MotionPreference = "system" | "full" | "reduced";
export type TextScale = 100 | 125 | 150 | 200;
export type NotificationPolicy = "all" | "mentions" | "off";
export type PresenceStatus = "online" | "idle" | "busy" | "invisible";

export const shortcutActions = [
  "settings", "composer", "channelFilter", "previousServer", "nextServer",
  "previousChannel", "nextChannel", "members", "microphone", "deafen"
] as const;
export type ShortcutAction = (typeof shortcutActions)[number];

export const defaultShortcuts: Record<ShortcutAction, string> = {
  settings: "Mod+,",
  composer: "Mod+Shift+E",
  channelFilter: "Mod+Shift+F",
  previousServer: "Alt+ArrowUp",
  nextServer: "Alt+ArrowDown",
  previousChannel: "Alt+Shift+ArrowUp",
  nextChannel: "Alt+Shift+ArrowDown",
  members: "Mod+Shift+U",
  microphone: "Mod+Shift+M",
  deafen: "Mod+Shift+D"
};

export type SettingsData = {
  theme: ThemePreference;
  contrast: SystemPreference;
  motion: MotionPreference;
  textScale: TextScale;
  shortcuts: Record<ShortcutAction, string>;
  notificationsEnabled: boolean;
  notificationSound: boolean;
  notificationPreview: boolean;
  notificationPolicyByServer: Record<string, NotificationPolicy>;
  previousNotificationPolicyByServer: Record<string, "all" | "mentions">;
  mutedChannelIdsByServer: Record<string, string[]>;
  hideMutedChannelsByServer: Record<string, boolean>;
  presenceStatus: PresenceStatus;
};

export function defaultSettings(): SettingsData {
  return {
    theme: "dark",
    contrast: "system",
    motion: "system",
    textScale: 100,
    shortcuts: { ...defaultShortcuts },
    notificationsEnabled: true,
    notificationSound: false,
    notificationPreview: true,
    notificationPolicyByServer: {},
    previousNotificationPolicyByServer: {},
    mutedChannelIdsByServer: {},
    hideMutedChannelsByServer: {},
    presenceStatus: "online"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function choice<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

export function normalizeSettings(raw: unknown, legacyMuted: readonly string[] = []): SettingsData {
  const defaults = defaultSettings();
  const source = isRecord(raw) && raw.version === 1 ? raw : {};
  const shortcuts = isRecord(source.shortcuts) ? source.shortcuts : {};
  const policies = isRecord(source.notificationPolicyByServer) ? source.notificationPolicyByServer : {};
  const previous = isRecord(source.previousNotificationPolicyByServer) ? source.previousNotificationPolicyByServer : {};
  const mutedChannels = isRecord(source.mutedChannelIdsByServer) ? source.mutedChannelIdsByServer : {};
  const hidden = isRecord(source.hideMutedChannelsByServer) ? source.hideMutedChannelsByServer : {};
  const policyByServer: Record<string, NotificationPolicy> = {};
  const previousByServer: Record<string, "all" | "mentions"> = {};
  const mutedChannelIdsByServer: Record<string, string[]> = {};
  const hideMutedChannelsByServer: Record<string, boolean> = {};
  for (const [serverId, policy] of Object.entries(policies)) {
    if (serverId.trim() && (policy === "all" || policy === "mentions" || policy === "off")) policyByServer[serverId] = policy;
  }
  for (const [serverId, policy] of Object.entries(previous)) {
    if (serverId.trim() && (policy === "all" || policy === "mentions")) previousByServer[serverId] = policy;
  }
  for (const [serverId, ids] of Object.entries(mutedChannels)) {
    if (!serverId.trim() || !Array.isArray(ids)) continue;
    mutedChannelIdsByServer[serverId] = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
  }
  for (const [serverId, isHidden] of Object.entries(hidden)) {
    if (serverId.trim() && typeof isHidden === "boolean") hideMutedChannelsByServer[serverId] = isHidden;
  }
  if (!isRecord(raw) || raw.version !== 1) {
    for (const serverId of legacyMuted) if (serverId.trim()) policyByServer[serverId] = "off";
  }
  const normalizedShortcuts = { ...defaultShortcuts };
  for (const action of shortcutActions) {
    if (typeof shortcuts[action] === "string" && isValidShortcut(shortcuts[action])
      && !shortcutConflict(normalizedShortcuts, action, shortcuts[action])) normalizedShortcuts[action] = shortcuts[action];
  }
  return {
    theme: choice(source.theme, ["dark", "light", "system"], defaults.theme),
    contrast: choice(source.contrast, ["system", "standard", "high"], defaults.contrast),
    motion: choice(source.motion, ["system", "full", "reduced"], defaults.motion),
    textScale: choice(source.textScale, [100, 125, 150, 200], defaults.textScale),
    shortcuts: normalizedShortcuts,
    notificationsEnabled: typeof source.notificationsEnabled === "boolean" ? source.notificationsEnabled : defaults.notificationsEnabled,
    notificationSound: typeof source.notificationSound === "boolean" ? source.notificationSound : defaults.notificationSound,
    notificationPreview: typeof source.notificationPreview === "boolean" ? source.notificationPreview : defaults.notificationPreview,
    notificationPolicyByServer: policyByServer,
    previousNotificationPolicyByServer: previousByServer,
    mutedChannelIdsByServer,
    hideMutedChannelsByServer,
    presenceStatus: choice(source.presenceStatus, ["online", "idle", "busy", "invisible"], defaults.presenceStatus)
  };
}

export function canonicalShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, isMac: boolean): string | null {
  if ((isMac && event.ctrlKey) || (!isMac && event.metaKey)) return null;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (["Shift", "Control", "Meta", "Alt", "Dead", "Process"].includes(key)) return null;
  const modifiers = [
    isMac ? event.metaKey && "Mod" : event.ctrlKey && "Mod",
    event.altKey && "Alt",
    event.shiftKey && "Shift"
  ].filter(Boolean);
  if (modifiers.length === 0) return null;
  return [...modifiers, key === "," ? "," : key].join("+");
}

export function isValidShortcut(value: string): boolean {
  const parts = value.split("+");
  if (parts.length < 2 || parts.length > 4) return false;
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  if (!modifiers.every((part) => ["Mod", "Alt", "Shift"].includes(part))) return false;
  if (new Set(modifiers).size !== modifiers.length || !modifiers.some((part) => part === "Mod" || part === "Alt")) return false;
  if (!/^(?:[A-Z0-9,]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(key)) return false;
  return !["Mod+Q", "Mod+W", "Mod+R", "Mod+N", "Mod+T", "Mod+P", "Mod+Shift+I", "Mod+Alt+I", "Mod+Alt+ArrowLeft", "Mod+Alt+ArrowRight", "Alt+F4"].includes(value);
}

export function shortcutConflict(shortcuts: Record<ShortcutAction, string>, action: ShortcutAction, candidate: string): ShortcutAction | null {
  return shortcutActions.find((other) => other !== action && shortcuts[other] === candidate) ?? null;
}

export function shouldNotify(params: {
  enabled: boolean; presence: PresenceStatus; policy: NotificationPolicy; ownMessage: boolean;
  isMention: boolean; windowVisible: boolean; channelIsActive: boolean;
}): boolean {
  if (!params.enabled || params.presence === "busy" || params.policy === "off" || params.ownMessage) return false;
  if (params.policy === "mentions" && !params.isMention) return false;
  return !(params.windowVisible && params.channelIsActive && !params.isMention);
}
