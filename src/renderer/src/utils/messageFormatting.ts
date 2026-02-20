import { replaceEmojiShortcodes } from "./emoji.ts";
import { splitMessageTextSegments } from "./linkify.ts";

type MarkdownMarks = {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
};

export type FormattedInlineSegment =
  | {
      kind: "text";
      value: string;
      bold: boolean;
      italic: boolean;
      strikethrough: boolean;
    }
  | {
      kind: "link";
      href: string;
      label: string;
      bold: boolean;
      italic: boolean;
      strikethrough: boolean;
    }
  | {
      kind: "inlineCode";
      value: string;
    };

export type FormattedListItem = {
  depth: number;
  segments: FormattedInlineSegment[];
};

export type FormattedMessageBlock =
  | {
      kind: "paragraph";
      segments: FormattedInlineSegment[];
    }
  | {
      kind: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      segments: FormattedInlineSegment[];
    }
  | {
      kind: "quote";
      segments: FormattedInlineSegment[];
    }
  | {
      kind: "list";
      ordered: boolean;
      start: number;
      items: FormattedListItem[];
    }
  | {
      kind: "code";
      value: string;
      language: string | null;
    }
  | {
      kind: "divider";
    };

type RawInlineSegment =
  | {
      kind: "text";
      value: string;
      marks: MarkdownMarks;
    }
  | {
      kind: "link";
      href: string;
      label: string;
      marks: MarkdownMarks;
    }
  | {
      kind: "inlineCode";
      value: string;
    };

type ParsedInlineCodeSpan = {
  value: string;
  consumed: number;
};

type ParsedMarkdownLink = {
  href: string;
  label: string;
  consumed: number;
};

type ParsedListLine = {
  ordered: boolean;
  start: number;
  depth: number;
  value: string;
};

type MutableListBlock = {
  ordered: boolean;
  start: number;
  items: Array<{ depth: number; value: string }>;
};

const defaultMarks: MarkdownMarks = {
  bold: false,
  italic: false,
  strikethrough: false
};

const atxHeadingPattern = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const dividerLinePattern = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const orderedListLinePattern = /^(\s*)(\d{1,9})([.)])\s+(.*)$/;
const unorderedListLinePattern = /^(\s*)([-+*])\s+(.*)$/;
const openCodeFencePattern = /^(\s{0,3})(`{3,}|~{3,})\s*([\w#+.-]+)?\s*$/;
const quoteLinePattern = /^\s*>\s?/;

function marksEqual(left: MarkdownMarks, right: MarkdownMarks): boolean {
  return left.bold === right.bold && left.italic === right.italic && left.strikethrough === right.strikethrough;
}

function normalizeSafeLinkTarget(rawValue: string): string | null {
  let value = rawValue.trim();
  if (!value) return null;
  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1).trim();
  }
  const firstWhitespace = value.search(/\s/);
  if (firstWhitespace !== -1) {
    value = value.slice(0, firstWhitespace);
  }
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeListDepth(leadingWhitespace: string): number {
  if (!leadingWhitespace) return 0;
  const expanded = leadingWhitespace.replace(/\t/g, "  ");
  return Math.max(0, Math.min(6, Math.floor(expanded.length / 2)));
}

function parseListLine(line: string): ParsedListLine | null {
  const orderedMatch = line.match(orderedListLinePattern);
  if (orderedMatch) {
    const [, leadingWhitespace, numericStart, _separator, value] = orderedMatch;
    const start = Number(numericStart);
    if (!Number.isFinite(start) || start <= 0) return null;
    return {
      ordered: true,
      start,
      depth: normalizeListDepth(leadingWhitespace),
      value
    };
  }
  const unorderedMatch = line.match(unorderedListLinePattern);
  if (!unorderedMatch) return null;
  const [, leadingWhitespace, _marker, value] = unorderedMatch;
  return {
    ordered: false,
    start: 1,
    depth: normalizeListDepth(leadingWhitespace),
    value
  };
}

function isEscapedAt(input: string, index: number): boolean {
  if (index <= 0) return false;
  let slashCount = 0;
  let cursor = index - 1;
  while (cursor >= 0 && input[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }
  return slashCount % 2 === 1;
}

function findClosingDelimiter(input: string, delimiter: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < input.length) {
    const foundIndex = input.indexOf(delimiter, cursor);
    if (foundIndex === -1) {
      return -1;
    }
    if (!isEscapedAt(input, foundIndex)) {
      return foundIndex;
    }
    cursor = foundIndex + delimiter.length;
  }
  return -1;
}

function countSequentialCharacters(input: string, startIndex: number, character: string): number {
  let count = 0;
  let cursor = startIndex;
  while (cursor < input.length && input[cursor] === character) {
    count += 1;
    cursor += 1;
  }
  return count;
}

function parseInlineCodeSpan(input: string, startIndex: number): ParsedInlineCodeSpan | null {
  if (input[startIndex] !== "`") return null;
  const tickCount = countSequentialCharacters(input, startIndex, "`");
  if (tickCount <= 0) return null;
  const fence = "`".repeat(tickCount);
  let cursor = startIndex + tickCount;
  while (cursor < input.length) {
    const closingIndex = input.indexOf(fence, cursor);
    if (closingIndex === -1) return null;
    if (isEscapedAt(input, closingIndex)) {
      cursor = closingIndex + 1;
      continue;
    }
    return {
      value: input.slice(startIndex + tickCount, closingIndex).replace(/\r?\n/g, " "),
      consumed: closingIndex + tickCount - startIndex
    };
  }
  return null;
}

function findBracketPairEnd(input: string, startIndex: number): number {
  let depth = 1;
  let cursor = startIndex;
  while (cursor < input.length) {
    const value = input[cursor];
    if (value === "\\") {
      cursor += 2;
      continue;
    }
    if (value === "[") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (value === "]") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  return -1;
}

function findParenthesizedEnd(input: string, startIndex: number): number {
  let depth = 1;
  let cursor = startIndex;
  while (cursor < input.length) {
    const value = input[cursor];
    if (value === "\\") {
      cursor += 2;
      continue;
    }
    if (value === "(") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (value === ")") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  return -1;
}

function parseMarkdownLinkToken(input: string, startIndex: number): ParsedMarkdownLink | null {
  if (input[startIndex] !== "[" || isEscapedAt(input, startIndex)) return null;
  const bracketEnd = findBracketPairEnd(input, startIndex + 1);
  if (bracketEnd === -1) return null;
  if (input[bracketEnd + 1] !== "(") return null;
  const parenthesisEnd = findParenthesizedEnd(input, bracketEnd + 2);
  if (parenthesisEnd === -1) return null;
  const rawHref = input.slice(bracketEnd + 2, parenthesisEnd);
  const href = normalizeSafeLinkTarget(rawHref);
  if (!href) return null;
  return {
    href,
    label: input.slice(startIndex + 1, bracketEnd),
    consumed: parenthesisEnd - startIndex + 1
  };
}

function parseAutoLinkToken(input: string, startIndex: number): ParsedMarkdownLink | null {
  if (input[startIndex] !== "<" || isEscapedAt(input, startIndex)) return null;
  const endIndex = input.indexOf(">", startIndex + 1);
  if (endIndex === -1) return null;
  const rawTarget = input.slice(startIndex + 1, endIndex);
  const href = normalizeSafeLinkTarget(rawTarget);
  if (!href) return null;
  const label = rawTarget.trim() || href;
  return {
    href,
    label,
    consumed: endIndex - startIndex + 1
  };
}

function isClosingCodeFence(line: string, character: "`" | "~", minLength: number): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith(character)) return false;
  const runLength = countSequentialCharacters(trimmed, 0, character);
  if (runLength < minLength) return false;
  const remainder = trimmed.slice(runLength).trim();
  return remainder.length === 0;
}

function parseInlineSegments(input: string, marks: MarkdownMarks): RawInlineSegment[] {
  if (!input) return [];

  const segments: RawInlineSegment[] = [];
  let buffer = "";
  let cursor = 0;

  const flushBuffer = () => {
    if (!buffer) return;
    segments.push({
      kind: "text",
      value: buffer,
      marks: { ...marks }
    });
    buffer = "";
  };

  while (cursor < input.length) {
    if (input[cursor] === "\\") {
      const escaped = input[cursor + 1];
      if (escaped && "\\`*_~:[]()!<>".includes(escaped)) {
        buffer += escaped;
        cursor += 2;
        continue;
      }
    }

    if (input[cursor] === "!" && input[cursor + 1] === "[") {
      const markdownImage = parseMarkdownLinkToken(input, cursor + 1);
      if (markdownImage) {
        flushBuffer();
        segments.push({
          kind: "link",
          href: markdownImage.href,
          label: markdownImage.label.trim() || markdownImage.href,
          marks: { ...marks }
        });
        cursor += markdownImage.consumed + 1;
        continue;
      }
    }

    const inlineCode = parseInlineCodeSpan(input, cursor);
    if (inlineCode) {
      flushBuffer();
      segments.push({
        kind: "inlineCode",
        value: inlineCode.value
      });
      cursor += inlineCode.consumed;
      continue;
    }

    const autoLink = parseAutoLinkToken(input, cursor);
    if (autoLink) {
      flushBuffer();
      segments.push({
        kind: "link",
        href: autoLink.href,
        label: autoLink.label,
        marks: { ...marks }
      });
      cursor += autoLink.consumed;
      continue;
    }

    const markdownLink = parseMarkdownLinkToken(input, cursor);
    if (markdownLink) {
      flushBuffer();
      segments.push({
        kind: "link",
        href: markdownLink.href,
        label: markdownLink.label,
        marks: { ...marks }
      });
      cursor += markdownLink.consumed;
      continue;
    }

    if (input.startsWith("**", cursor)) {
      const closing = findClosingDelimiter(input, "**", cursor + 2);
      if (closing > cursor + 2) {
        flushBuffer();
        segments.push(
          ...parseInlineSegments(input.slice(cursor + 2, closing), {
            ...marks,
            bold: true
          })
        );
        cursor = closing + 2;
        continue;
      }
    }

    if (input.startsWith("__", cursor)) {
      const closing = findClosingDelimiter(input, "__", cursor + 2);
      if (closing > cursor + 2) {
        flushBuffer();
        segments.push(
          ...parseInlineSegments(input.slice(cursor + 2, closing), {
            ...marks,
            bold: true
          })
        );
        cursor = closing + 2;
        continue;
      }
    }

    if (input.startsWith("~~", cursor)) {
      const closing = findClosingDelimiter(input, "~~", cursor + 2);
      if (closing > cursor + 2) {
        flushBuffer();
        segments.push(
          ...parseInlineSegments(input.slice(cursor + 2, closing), {
            ...marks,
            strikethrough: true
          })
        );
        cursor = closing + 2;
        continue;
      }
    }

    if (input[cursor] === "*") {
      const closing = findClosingDelimiter(input, "*", cursor + 1);
      if (closing > cursor + 1) {
        flushBuffer();
        segments.push(
          ...parseInlineSegments(input.slice(cursor + 1, closing), {
            ...marks,
            italic: true
          })
        );
        cursor = closing + 1;
        continue;
      }
    }

    if (input[cursor] === "_") {
      const closing = findClosingDelimiter(input, "_", cursor + 1);
      if (closing > cursor + 1) {
        flushBuffer();
        segments.push(
          ...parseInlineSegments(input.slice(cursor + 1, closing), {
            ...marks,
            italic: true
          })
        );
        cursor = closing + 1;
        continue;
      }
    }

    buffer += input[cursor];
    cursor += 1;
  }

  flushBuffer();
  return segments;
}

function mergeAdjacentTextSegments(segments: FormattedInlineSegment[]): FormattedInlineSegment[] {
  if (segments.length <= 1) return segments;
  const merged: FormattedInlineSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.kind !== "text" || segment.kind !== "text") {
      merged.push(segment);
      continue;
    }
    if (!marksEqual(previous, segment)) {
      merged.push(segment);
      continue;
    }
    previous.value += segment.value;
  }
  return merged;
}

function formatInlineText(input: string): FormattedInlineSegment[] {
  if (!input) return [];
  const parsed = parseInlineSegments(input, defaultMarks);
  const formatted: FormattedInlineSegment[] = [];
  parsed.forEach((segment) => {
    if (segment.kind === "inlineCode") {
      formatted.push({
        kind: "inlineCode",
        value: segment.value
      });
      return;
    }

    if (segment.kind === "link") {
      const label = replaceEmojiShortcodes(segment.label);
      formatted.push({
        kind: "link",
        href: segment.href,
        label,
        ...segment.marks
      });
      return;
    }

    const emojiExpanded = replaceEmojiShortcodes(segment.value);
    const split = splitMessageTextSegments(emojiExpanded);
    split.forEach((piece) => {
      if (piece.kind === "link") {
        formatted.push({
          kind: "link",
          href: piece.href,
          label: piece.label,
          ...segment.marks
        });
        return;
      }
      if (!piece.value) return;
      formatted.push({
        kind: "text",
        value: piece.value,
        ...segment.marks
      });
    });
  });
  return mergeAdjacentTextSegments(formatted);
}

function parseMessageBodyString(body: string): FormattedMessageBlock[] {
  const normalized = body.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return [];

  const lines = normalized.split("\n");
  const blocks: FormattedMessageBlock[] = [];
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  let openCodeBlock: {
    fenceLine: string;
    fenceCharacter: "`" | "~";
    fenceLength: number;
    language: string | null;
    lines: string[];
  } | null = null;
  let openList: MutableListBlock | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join("\n");
    blocks.push({
      kind: "paragraph",
      segments: formatInlineText(text)
    });
    paragraphLines = [];
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    const text = quoteLines.join("\n");
    blocks.push({
      kind: "quote",
      segments: formatInlineText(text)
    });
    quoteLines = [];
  };

  const flushList = () => {
    if (!openList || openList.items.length === 0) {
      openList = null;
      return;
    }
    blocks.push({
      kind: "list",
      ordered: openList.ordered,
      start: openList.start,
      items: openList.items.map((item) => {
        return {
          depth: item.depth,
          segments: formatInlineText(item.value)
        };
      })
    });
    openList = null;
  };

  for (const line of lines) {
    if (openCodeBlock) {
      if (isClosingCodeFence(line, openCodeBlock.fenceCharacter, openCodeBlock.fenceLength)) {
        blocks.push({
          kind: "code",
          value: openCodeBlock.lines.join("\n"),
          language: openCodeBlock.language
        });
        openCodeBlock = null;
        continue;
      }
      openCodeBlock.lines.push(line);
      continue;
    }

    const fenceMatch = line.match(openCodeFencePattern);
    if (fenceMatch) {
      flushParagraph();
      flushQuote();
      flushList();
      openCodeBlock = {
        fenceLine: line,
        fenceCharacter: fenceMatch[2][0] as "`" | "~",
        fenceLength: fenceMatch[2].length,
        language: fenceMatch[3]?.toLowerCase() ?? null,
        lines: []
      };
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushQuote();
      flushList();
      continue;
    }

    if (quoteLinePattern.test(line)) {
      flushParagraph();
      flushList();
      quoteLines.push(line.replace(quoteLinePattern, ""));
      continue;
    }

    flushQuote();

    const headingMatch = line.match(atxHeadingPattern);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.max(1, Math.min(6, headingMatch[1].length)) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        kind: "heading",
        level,
        segments: formatInlineText(headingMatch[2].trim())
      });
      continue;
    }

    if (dividerLinePattern.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "divider"
      });
      continue;
    }

    const parsedListLine = parseListLine(line);
    if (parsedListLine) {
      flushParagraph();
      if (!openList || openList.ordered !== parsedListLine.ordered) {
        flushList();
        openList = {
          ordered: parsedListLine.ordered,
          start: parsedListLine.start,
          items: []
        };
      }
      if (parsedListLine.ordered && openList.items.length === 0) {
        openList.start = parsedListLine.start;
      }
      openList.items.push({
        depth: parsedListLine.depth,
        value: parsedListLine.value
      });
      continue;
    }

    if (openList) {
      const continuationMatch = line.match(/^(\s+)(.+)$/);
      const lastItem = openList.items[openList.items.length - 1];
      if (continuationMatch && lastItem) {
        const [, leadingWhitespace, value] = continuationMatch;
        const continuationDepth = normalizeListDepth(leadingWhitespace);
        if (continuationDepth >= Math.max(1, lastItem.depth)) {
          lastItem.value = `${lastItem.value}\n${value.trimEnd()}`;
          continue;
        }
      }
      flushList();
    }

    paragraphLines.push(line);
  }

  if (openCodeBlock) {
    blocks.push({
      kind: "paragraph",
      segments: formatInlineText([openCodeBlock.fenceLine, ...openCodeBlock.lines].join("\n"))
    });
  }

  flushParagraph();
  flushQuote();
  flushList();
  return blocks;
}

function normalizeMessageBody(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean" || typeof input === "bigint") {
    return String(input);
  }
  if (input === null || typeof input === "undefined") {
    return "";
  }
  try {
    return JSON.stringify(input);
  } catch (_error) {
    return String(input);
  }
}

export function formatMessageBody(input: unknown): FormattedMessageBlock[] {
  return parseMessageBodyString(normalizeMessageBody(input));
}
