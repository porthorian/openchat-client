import assert from "node:assert/strict";
import test from "node:test";
import { createServer as createServerRequest } from "../../services/serverRegistryClient.ts";
import { normalizeServerCapabilities } from "../../types/capabilities.ts";

test("normalizeServerCapabilities maps features.server_creation", () => {
  const normalized = normalizeServerCapabilities({
    server_name: "Penny Lab",
    server_id: "srv_test",
    api_version: "2026-03-06",
    identity_handshake_modes: ["challenge_signature"],
    user_uid_policy: "server_scoped",
    profile_data_policy: "uid_only",
    transport: { websocket: true, sse: false, polling: false },
    features: {
      messaging: true,
      presence: true,
      attachments: true,
      notifications: true,
      server_creation: true
    },
    limits: {},
    security: { https_required: false, certificate_pinning: "optional" }
  });

  assert.equal(normalized.features.serverCreation, true);
});

test("normalizeServerCapabilities defaults serverCreation=false when missing", () => {
  const normalized = normalizeServerCapabilities({
    server_name: "Penny Lab",
    server_id: "srv_test",
    api_version: "2026-03-06",
    identity_handshake_modes: ["challenge_signature"],
    user_uid_policy: "server_scoped",
    profile_data_policy: "uid_only",
    transport: { websocket: true, sse: false, polling: false },
    features: {
      messaging: true,
      presence: true,
      attachments: true,
      notifications: true
    },
    limits: {},
    security: { https_required: false, certificate_pinning: "optional" }
  });

  assert.equal(normalized.features.serverCreation, false);
});

test("createServer parses ownership claim response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        server: {
          server_id: "aa111111-bbbb-4444-8888-cccccccccccc",
          display_name: "Penny Lab",
          description: "Team server",
          banner_preset: "ocean",
          icon_text: "PL",
          trust_state: "unverified",
          identity_handshake_strategy: "challenge_signature",
          user_identifier_policy: "server_scoped"
        },
        created_by_uid: "uid_backend_scope",
        created_at: "2026-03-06T00:00:00Z",
        ownership_claim: {
          token: "claim_token",
          expires_at: "2026-03-06T00:05:00Z"
        }
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" }
      }
    )) as typeof fetch;

  try {
    const result = await createServerRequest({
      backendUrl: "https://chat.pennylabs.com",
      displayName: "Penny Lab",
      userUID: "uid_backend_scope",
      deviceID: "desktop_test"
    });
    assert.equal(result.profile.serverId, "aa111111-bbbb-4444-8888-cccccccccccc");
    assert.equal(result.ownershipClaimToken, "claim_token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
