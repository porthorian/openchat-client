export type AvatarPreset = {
  id: string;
  gradient: string;
  accent: string;
};

export const GENERATED_AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: "horizon",
    gradient: "linear-gradient(135deg, #ffb857 0%, #ff6a88 100%)",
    accent: "#ffd596"
  },
  {
    id: "reef",
    gradient: "linear-gradient(135deg, #45c8ff 0%, #1b6cff 100%)",
    accent: "#a4d9ff"
  },
  {
    id: "mint",
    gradient: "linear-gradient(135deg, #47d89d 0%, #1f9f76 100%)",
    accent: "#aaf5d4"
  },
  {
    id: "ember",
    gradient: "linear-gradient(135deg, #ff7b5a 0%, #b62653 100%)",
    accent: "#ffc3ab"
  },
  {
    id: "violet",
    gradient: "linear-gradient(135deg, #9f8dff 0%, #5a3cf0 100%)",
    accent: "#d5cbff"
  },
  {
    id: "slate",
    gradient: "linear-gradient(135deg, #9aa4bf 0%, #55617b 100%)",
    accent: "#d6deef"
  }
];

export const DEFAULT_AVATAR_PRESET_ID = GENERATED_AVATAR_PRESETS[0].id;

export function avatarPresetById(presetId: string): AvatarPreset {
  return GENERATED_AVATAR_PRESETS.find((preset) => preset.id === presetId) ?? GENERATED_AVATAR_PRESETS[0];
}
