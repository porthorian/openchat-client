import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { FormattedInlineSegment, FormattedMessageBlock } from "./messageFormatting.ts";
import { formatMessageBody } from "./messageFormatting.ts";

function collectInlineSegments(blocks: FormattedMessageBlock[]): FormattedInlineSegment[] {
  const segments: FormattedInlineSegment[] = [];
  blocks.forEach((block) => {
    if (block.kind === "paragraph" || block.kind === "quote" || block.kind === "heading") {
      segments.push(...block.segments);
      return;
    }
    if (block.kind === "list") {
      block.items.forEach((item) => {
        segments.push(...item.segments);
      });
    }
  });
  return segments;
}

function collectLinks(blocks: FormattedMessageBlock[]): Array<{ href: string; label: string }> {
  return collectInlineSegments(blocks)
    .filter((segment): segment is Extract<FormattedInlineSegment, { kind: "link" }> => segment.kind === "link")
    .map((segment) => {
      return {
        href: segment.href,
        label: segment.label
      };
    });
}

function flattenText(blocks: FormattedMessageBlock[]): string {
  const chunks: string[] = [];
  blocks.forEach((block) => {
    if (block.kind === "code") {
      chunks.push(block.value);
      return;
    }
    if (block.kind === "divider") {
      chunks.push("---");
      return;
    }
    if (block.kind === "list") {
      block.items.forEach((item) => {
        item.segments.forEach((segment) => {
          if (segment.kind === "link") {
            chunks.push(segment.label);
            return;
          }
          chunks.push(segment.value);
        });
      });
      return;
    }
    block.segments.forEach((segment) => {
      if (segment.kind === "link") {
        chunks.push(segment.label);
        return;
      }
      chunks.push(segment.value);
    });
  });
  return chunks.join("\n");
}

test("rejects unsafe markdown/autolink protocols and preserves readable fallback text", () => {
  const message = [
    "[safe](https://example.com/docs)",
    "[bad-js](javascript:alert(1))",
    "[bad-data](data:text/html;base64,AAAA)",
    "<https://example.com>",
    "<javascript:alert(1)>"
  ].join(" ");
  const blocks = formatMessageBody(message);
  const links = collectLinks(blocks);

  assert.equal(links.length, 2);
  assert.ok(links.some((item) => item.href.startsWith("https://example.com/docs")));
  assert.ok(links.some((item) => item.href.startsWith("https://example.com/")));
  assert.ok(links.every((item) => /^https?:\/\//.test(item.href)));

  const text = flattenText(blocks);
  assert.match(text, /javascript:alert\(1\)/);
  assert.match(text, /data:text\/html;base64,AAAA/);
});

test("renders raw html payloads as inert text segments", () => {
  const payload = '<img src=x onerror=alert(1)><script>alert("xss")</script>';
  const blocks = formatMessageBody(payload);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, "paragraph");
  assert.equal(collectLinks(blocks).length, 0);
  assert.match(flattenText(blocks), /<img src=x onerror=alert\(1\)>/);
  assert.match(flattenText(blocks), /<script>alert\("xss"\)<\/script>/);
});

test("keeps potentially dangerous html inside fenced code blocks as plain code text", () => {
  const payload = "```html\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n```";
  const blocks = formatMessageBody(payload);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, "code");
  if (blocks[0]?.kind !== "code") {
    assert.fail("Expected a code block");
  }
  assert.match(blocks[0].value, /onerror=alert\(1\)/);
  assert.match(blocks[0].value, /<script>alert\(1\)<\/script>/);
});

test("markdown image syntax degrades to safe link output", () => {
  const blocks = formatMessageBody("![avatar](https://cdn.example.com/avatar.png)");
  const links = collectLinks(blocks);

  assert.equal(links.length, 1);
  assert.ok(links[0]?.href.startsWith("https://cdn.example.com/avatar.png"));
  assert.equal(links[0]?.label, "avatar");
});

test("formatted output model never exposes raw html fields", () => {
  const blocks = formatMessageBody("**Hello** <script>alert(1)</script> `code` [docs](https://example.com)");

  collectInlineSegments(blocks).forEach((segment) => {
    assert.equal("html" in (segment as Record<string, unknown>), false);
    assert.equal("dangerouslySetInnerHTML" in (segment as Record<string, unknown>), false);
  });
});

test("chat message renderer template does not use unsafe html sinks", async () => {
  const rowPath = path.join(process.cwd(), "src/renderer/src/components/ChatMessageRow.vue");
  const source = await readFile(rowPath, "utf8");

  assert.doesNotMatch(source, /\bv-html\s*=/);
  assert.doesNotMatch(source, /\bdangerouslySetInnerHTML\b/);
  assert.doesNotMatch(source, /\binnerHTML\b/);
  assert.doesNotMatch(source, /\binsertAdjacentHTML\b/);
});
