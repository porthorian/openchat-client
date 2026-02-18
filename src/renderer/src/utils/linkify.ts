export type MessageTextSegment =
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "link";
      href: string;
      label: string;
    };

const messageURLPattern = /https?:\/\/[^\s<>"'`]+/gi;
const trailingPunctuationPattern = /[.,!?;:]+$/;

type ParsedMessageLink = {
  href: string;
  label: string;
  trailingText: string;
};

function parseMessageLinkToken(token: string): ParsedMessageLink | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const withoutTrailingPunctuation = trimmed.replace(trailingPunctuationPattern, "");
  if (!withoutTrailingPunctuation) return null;
  const trailingText = trimmed.slice(withoutTrailingPunctuation.length);
  try {
    const parsed = new URL(withoutTrailingPunctuation);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return {
      href: parsed.toString(),
      label: withoutTrailingPunctuation,
      trailingText
    };
  } catch (_error) {
    return null;
  }
}

export function extractMessageURLs(body: string, maxCount = 3): string[] {
  if (!body.trim() || maxCount <= 0) return [];
  const regex = new RegExp(messageURLPattern);
  const seen = new Set<string>();
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const parsed = parseMessageLinkToken(match[0]);
    if (!parsed) continue;
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    urls.push(parsed.href);
    if (urls.length >= maxCount) {
      break;
    }
  }
  return urls;
}

export function splitMessageTextSegments(body: string): MessageTextSegment[] {
  if (!body) {
    return [];
  }
  const regex = new RegExp(messageURLPattern);
  const segments: MessageTextSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const start = match.index;
    if (start > cursor) {
      segments.push({
        kind: "text",
        value: body.slice(cursor, start)
      });
    }
    const parsed = parseMessageLinkToken(match[0]);
    if (!parsed) {
      segments.push({
        kind: "text",
        value: match[0]
      });
    } else {
      segments.push({
        kind: "link",
        href: parsed.href,
        label: parsed.label
      });
      if (parsed.trailingText) {
        segments.push({
          kind: "text",
          value: parsed.trailingText
        });
      }
    }
    cursor = start + match[0].length;
  }
  if (cursor < body.length) {
    segments.push({
      kind: "text",
      value: body.slice(cursor)
    });
  }
  if (segments.length === 0) {
    segments.push({
      kind: "text",
      value: body
    });
  }
  return segments;
}
