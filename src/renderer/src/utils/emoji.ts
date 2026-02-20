export type EmojiOption = {
  shortcode: string;
  emoji: string;
  label: string;
};

const emojiCatalog: EmojiOption[] = [
  { shortcode: ":grinning:", emoji: "😀", label: "Grinning Face" },
  { shortcode: ":smiley:", emoji: "😃", label: "Smiley Face" },
  { shortcode: ":smile:", emoji: "😄", label: "Smile" },
  { shortcode: ":joy:", emoji: "😂", label: "Tears of Joy" },
  { shortcode: ":rofl:", emoji: "🤣", label: "Rolling on the Floor Laughing" },
  { shortcode: ":wink:", emoji: "😉", label: "Wink" },
  { shortcode: ":thinking:", emoji: "🤔", label: "Thinking Face" },
  { shortcode: ":heart_eyes:", emoji: "😍", label: "Heart Eyes" },
  { shortcode: ":sob:", emoji: "😭", label: "Loudly Crying Face" },
  { shortcode: ":angry:", emoji: "😠", label: "Angry Face" },
  { shortcode: ":heart:", emoji: "❤️", label: "Red Heart" },
  { shortcode: ":fire:", emoji: "🔥", label: "Fire" },
  { shortcode: ":rocket:", emoji: "🚀", label: "Rocket" },
  { shortcode: ":wave:", emoji: "👋", label: "Waving Hand" },
  { shortcode: ":thumbsup:", emoji: "👍", label: "Thumbs Up" },
  { shortcode: ":thumbsdown:", emoji: "👎", label: "Thumbs Down" },
  { shortcode: ":clap:", emoji: "👏", label: "Clapping Hands" },
  { shortcode: ":white_check_mark:", emoji: "✅", label: "Check Mark" },
  { shortcode: ":100:", emoji: "💯", label: "One Hundred" },
  { shortcode: ":sparkles:", emoji: "✨", label: "Sparkles" },
  { shortcode: ":tada:", emoji: "🎉", label: "Party Popper" },
  { shortcode: ":saluting_face:", emoji: "🫡", label: "Saluting Face" },
  { shortcode: ":lul:", emoji: "🧌", label: "Troll" },
  { shortcode: ":heres_donny:", emoji: "🧑🏾", label: "Person" },
  { shortcode: ":successkid:", emoji: "🧒", label: "Child" },
  { shortcode: ":nice2:", emoji: "🆗", label: "OK" },
  { shortcode: ":deceased:", emoji: "☠️", label: "Skull and Crossbones" },
  { shortcode: ":nice1:", emoji: "🙂", label: "Slightly Smiling Face" },
  { shortcode: ":regional_indicator_e:", emoji: "🇪", label: "Regional Indicator E" }
];

const emojiAliases: Array<{ alias: string; target: string }> = [
  { alias: ":+1:", target: ":thumbsup:" },
  { alias: ":-1:", target: ":thumbsdown:" },
  { alias: ":check:", target: ":white_check_mark:" },
  { alias: ":saluting:", target: ":saluting_face:" },
  { alias: ":ok:", target: ":nice2:" }
];

const emojiByShortcode = new Map<string, string>();

emojiCatalog.forEach((entry) => {
  emojiByShortcode.set(entry.shortcode, entry.emoji);
});

emojiAliases.forEach((entry) => {
  const targetEmoji = emojiByShortcode.get(entry.target);
  if (targetEmoji) {
    emojiByShortcode.set(entry.alias, targetEmoji);
  }
});

export const composerEmojiOptions: EmojiOption[] = emojiCatalog.slice(0, 20);

function normalizeShortcodeToken(token: string): string {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) return "";
  const withLeading = trimmed.startsWith(":") ? trimmed : `:${trimmed}`;
  return withLeading.endsWith(":") ? withLeading : `${withLeading}:`;
}

export function emojiForShortcode(shortcode: string): string | null {
  const normalized = normalizeShortcodeToken(shortcode);
  if (!normalized) return null;
  return emojiByShortcode.get(normalized) ?? null;
}

const shortcodePattern = /:([a-z0-9_+-]+):/gi;

export function replaceEmojiShortcodes(input: string): string {
  if (!input) return "";
  return input.replace(shortcodePattern, (matched) => {
    return emojiForShortcode(matched) ?? matched;
  });
}
