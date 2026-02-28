import assert from "node:assert/strict";
import test from "node:test";
import { decodeHtmlEntities, sanitizeText } from "./openGraphText.ts";

test("decodeHtmlEntities decodes supported entities", () => {
  assert.equal(decodeHtmlEntities("&lt;b&gt;hi&lt;/b&gt;"), "<b>hi</b>");
  assert.equal(decodeHtmlEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(decodeHtmlEntities("&#39;x&#39; &nbsp; y"), "'x'   y");
  assert.equal(decodeHtmlEntities("&unknown;"), "&unknown;");
});

test("decodeHtmlEntities does not double-unescape nested entities", () => {
  assert.equal(decodeHtmlEntities("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
  assert.equal(decodeHtmlEntities("&amp;amp;"), "&amp;");
});

test("sanitizeText keeps encoded html payloads inert", () => {
  const value = "&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;";
  const sanitized = sanitizeText(value, 500);

  assert.equal(sanitized, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.doesNotMatch(sanitized ?? "", /<script>/i);
});
