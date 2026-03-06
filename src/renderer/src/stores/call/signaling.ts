import type { SignalEnvelope } from "@renderer/services/rtcClient";

export function parseSignalEnvelopeMessage(rawMessage: string): SignalEnvelope | null {
  try {
    return JSON.parse(rawMessage) as SignalEnvelope;
  } catch (_error) {
    return null;
  }
}

export function payloadAsRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return {};
}
