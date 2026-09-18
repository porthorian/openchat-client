import type { RTCConnectionPolicy } from "@renderer/types/capabilities";

export const MINIMUM_RTC_RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

export const DEFAULT_RTC_CONNECTION_POLICY: RTCConnectionPolicy = {
  joinTimeoutMs: 12_000,
  answerTimeoutMs: 10_000,
  iceRestartEnabled: true,
  reconnectBackoffMs: [...MINIMUM_RTC_RECONNECT_BACKOFF_MS]
};

function boundedMilliseconds(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

export function normalizeRTCConnectionPolicy(policy: RTCConnectionPolicy | null | undefined): RTCConnectionPolicy {
  const advertised = Array.isArray(policy?.reconnectBackoffMs) ? policy.reconnectBackoffMs.slice(0, 5) : [];
  const backoff = MINIMUM_RTC_RECONNECT_BACKOFF_MS.map((minimum, index) =>
    boundedMilliseconds(advertised[index] ?? advertised[advertised.length - 1], minimum, minimum, 30_000)
  );
  return {
    joinTimeoutMs: boundedMilliseconds(policy?.joinTimeoutMs, 12_000, 3_000, 30_000),
    answerTimeoutMs: boundedMilliseconds(policy?.answerTimeoutMs, 10_000, 3_000, 20_000),
    iceRestartEnabled: policy?.iceRestartEnabled === true,
    reconnectBackoffMs: backoff
  };
}

export function reconnectDelay(policy: RTCConnectionPolicy, completedAttempts: number): number | null {
  return policy.reconnectBackoffMs[completedAttempts] ?? null;
}

export function nextPeerRecoveryAction(step: number, iceRestartEnabled: boolean): "restart_ice" | "rebuild_peer" | "rejoin" {
  if (step === 0 && iceRestartEnabled) return "restart_ice";
  if (step < 2) return "rebuild_peer";
  return "rejoin";
}

export function restoredCaptureAfterJoin(canSpeak: boolean): { microphone: boolean; camera: false; screen: false } {
  return { microphone: canSpeak, camera: false, screen: false };
}

export function isRetryableHTTPStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isRetryableSignalError(code: string, retryable: boolean): boolean {
  if (code === "rtc_join_denied" || code === "rtc_permission_denied" || code === "rtc_ticket_replayed" || code === "rtc_media_denied") return false;
  if (code === "rtc_ticket_expired" || code === "rtc_join_ticket_expired") return true;
  return retryable;
}
