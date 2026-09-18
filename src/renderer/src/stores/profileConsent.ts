import type { ProfileScope } from "@renderer/types/capabilities";

export type ProfileConsentRecord = { grantedAt: string };
export type ProfileConsentData = Record<string, ProfileConsentRecord>;

export function profileConsentKey(serverId: string, backendUrl: string, scope: ProfileScope): string | null {
  if (!serverId.trim()) return null;
  try {
    const url = new URL(backendUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    return scope === "global" ? `global:${normalized}` : `server:${normalized}:${serverId}`;
  } catch {
    return null;
  }
}

export function parseProfileConsent(raw: string | null): ProfileConsentData {
  if (!raw) return {};
  try {
    const payload = JSON.parse(raw) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    const parsed = payload as { version?: unknown; grants?: unknown };
    if (parsed.version !== 1 || !parsed.grants || typeof parsed.grants !== "object" || Array.isArray(parsed.grants)) return {};
    const grants: ProfileConsentData = {};
    for (const [key, value] of Object.entries(parsed.grants)) {
      if (!key.startsWith("global:") && !key.startsWith("server:")) return {};
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const date = (value as { grantedAt?: unknown }).grantedAt;
      if (typeof date !== "string" || !Number.isFinite(Date.parse(date))) return {};
      grants[key] = { grantedAt: date };
    }
    return grants;
  } catch {
    return {};
  }
}
