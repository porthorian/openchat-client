export type PersistedCallMediaPreferences = {
  selectedInputDeviceId: string;
  selectedOutputDeviceId: string;
  selectedCameraDeviceId: string;
  inputVolume: number;
  outputVolume: number;
};

export type PersistedCallMediaPreferencesDefaults = {
  defaultInputDeviceId: string;
  defaultOutputDeviceId: string;
  defaultCameraDeviceId: string;
  defaultInputVolume: number;
  defaultOutputVolume: number;
};

export function normalizePersistedCallMediaPreferences(
  payload: Partial<PersistedCallMediaPreferences>,
  defaults: PersistedCallMediaPreferencesDefaults
): PersistedCallMediaPreferences {
  const selectedInputDeviceId =
    String(payload.selectedInputDeviceId ?? "").trim() || defaults.defaultInputDeviceId;
  const selectedOutputDeviceId =
    String(payload.selectedOutputDeviceId ?? "").trim() || defaults.defaultOutputDeviceId;
  const selectedCameraDeviceId =
    String(payload.selectedCameraDeviceId ?? "").trim() || defaults.defaultCameraDeviceId;

  const inputVolumeValue = Number(payload.inputVolume);
  const outputVolumeValue = Number(payload.outputVolume);
  const inputVolume = Number.isFinite(inputVolumeValue)
    ? Math.max(0, Math.min(200, Math.round(inputVolumeValue)))
    : defaults.defaultInputVolume;
  const outputVolume = Number.isFinite(outputVolumeValue)
    ? Math.max(0, Math.min(100, Math.round(outputVolumeValue)))
    : defaults.defaultOutputVolume;

  return {
    selectedInputDeviceId,
    selectedOutputDeviceId,
    selectedCameraDeviceId,
    inputVolume,
    outputVolume
  };
}

export function parsePersistedCallMediaPreferences(
  rawPayload: string | null | undefined,
  defaults: PersistedCallMediaPreferencesDefaults
): PersistedCallMediaPreferences | null {
  const normalizedPayload = String(rawPayload ?? "").trim();
  if (!normalizedPayload) return null;

  try {
    const parsed = JSON.parse(normalizedPayload) as Partial<PersistedCallMediaPreferences>;
    return normalizePersistedCallMediaPreferences(parsed, defaults);
  } catch (_error) {
    return null;
  }
}
