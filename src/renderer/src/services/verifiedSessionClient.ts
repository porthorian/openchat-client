import type { StoredVerifiedSession } from "@shared/ipc";

const inMemorySessions = new Map<string, StoredVerifiedSession>();

function normalizedBackendURL(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Verified sessions require HTTPS or a local development backend.");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid backend URL.");
  return url.toString().replace(/\/$/, "");
}

export async function loadVerifiedSession(serverId: string, backendUrl: string): Promise<StoredVerifiedSession | null> {
  const endpoint = normalizedBackendURL(backendUrl);
  const cached = inMemorySessions.get(serverId) ?? await window.openchat.identity.loadSession(serverId);
  if (!cached || cached.backendUrl !== endpoint || Date.parse(cached.expiresAt) <= Date.now()) {
    inMemorySessions.delete(serverId);
    return null;
  }
  inMemorySessions.set(serverId, cached);
  return cached;
}

export async function establishVerifiedSession(params: {
  serverId: string;
  backendUrl: string;
  deviceID: string;
  legacyUID?: string;
}): Promise<StoredVerifiedSession> {
  const backendUrl = normalizedBackendURL(params.backendUrl);
  const existing = await loadVerifiedSession(params.serverId, backendUrl);
  if (existing) return existing;
  const publicKey = await window.openchat.identity.publicKey();
  const challengeResponse = await fetch(`${backendUrl}/v1/servers/${encodeURIComponent(params.serverId)}/sessions/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKey, device_id: params.deviceID, user_uid: params.legacyUID })
  });
  if (!challengeResponse.ok) throw new Error(`Session challenge failed (${challengeResponse.status}).`);
  const challenge = await challengeResponse.json() as { challenge_id: string; server_id: string; user_uid: string; payload: string };
  if (challenge.server_id !== params.serverId || !challenge.challenge_id || !challenge.user_uid || !challenge.payload) {
    throw new Error("Invalid session challenge response.");
  }
  const signature = await window.openchat.identity.signChallenge(challenge.payload);
  const response = await fetch(`${backendUrl}/v1/servers/${encodeURIComponent(params.serverId)}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id: challenge.challenge_id, signature })
  });
  if (!response.ok) throw new Error(`Verified session failed (${response.status}).`);
  const body = await response.json() as { server_id: string; user_uid: string; token: string; expires_at: string };
  if (body.server_id !== params.serverId || body.user_uid !== challenge.user_uid || !body.token || !Number.isFinite(Date.parse(body.expires_at))) {
    throw new Error("Invalid verified session response.");
  }
  const session: StoredVerifiedSession = {
    serverId: params.serverId,
    backendUrl,
    userUID: body.user_uid,
    token: body.token,
    expiresAt: body.expires_at
  };
  await window.openchat.identity.storeSession(session);
  inMemorySessions.set(params.serverId, session);
  return session;
}

export function tokenForServer(serverId: string, backendUrl: string): string | null {
  const cached = inMemorySessions.get(serverId);
  let endpoint: string;
  try { endpoint = normalizedBackendURL(backendUrl); } catch { return null; }
  if (!cached || cached.backendUrl !== endpoint || Date.parse(cached.expiresAt) <= Date.now()) return null;
  return cached.token;
}

export function tokenForUIDAndBackend(userUID: string, backendUrl: string): string | null {
  let endpoint: string;
  try { endpoint = normalizedBackendURL(backendUrl); } catch { return null; }
  for (const session of inMemorySessions.values()) {
    if (session.userUID === userUID && session.backendUrl === endpoint && Date.parse(session.expiresAt) > Date.now()) return session.token;
  }
  return null;
}

export async function clearVerifiedSession(serverId: string): Promise<void> {
  inMemorySessions.delete(serverId);
  await window.openchat.identity.clearSession(serverId);
}
