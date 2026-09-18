import assert from "node:assert/strict";
import test from "node:test";
import { parseProfileConsent, profileConsentKey } from "./profileConsent.ts";

test("profile consent is bound to advertised scope and backend", () => {
  const server = profileConsentKey("one", "https://chat.example.test/api/", "server_scoped");
  const otherServer = profileConsentKey("two", "https://chat.example.test/api", "server_scoped");
  const global = profileConsentKey("one", "https://chat.example.test/api", "global");
  assert.notEqual(server, otherServer);
  assert.notEqual(server, global);
  assert.equal(global, profileConsentKey("two", "https://chat.example.test/api/", "global"));
  assert.notEqual(global, profileConsentKey("one", "https://other.example.test/api", "global"));
  assert.equal(profileConsentKey("one", "http://chat.example.test", "global"), null);
});

test("corrupt or invalid consent fails closed", () => {
  const key = profileConsentKey("one", "https://chat.example.test", "server_scoped")!;
  const valid = { version: 1, grants: { [key]: { grantedAt: "2026-09-18T00:00:00.000Z" } } };
  assert.deepEqual(parseProfileConsent(JSON.stringify(valid)), valid.grants);
  assert.deepEqual(parseProfileConsent("broken"), {});
  assert.deepEqual(parseProfileConsent(JSON.stringify({ ...valid, version: 2 })), {});
  assert.deepEqual(parseProfileConsent(JSON.stringify({ version: 1, grants: { ...valid.grants, bad: {} } })), {});
});
