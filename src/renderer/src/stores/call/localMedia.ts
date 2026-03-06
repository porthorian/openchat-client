export function buildMicrophoneConstraints(inputDeviceId: string, defaultDeviceId: string): MediaTrackConstraints {
  const useCustomInputDevice = inputDeviceId.trim() && inputDeviceId !== defaultDeviceId;
  return {
    channelCount: 1,
    sampleRate: 48000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(useCustomInputDevice ? { deviceId: { exact: inputDeviceId } } : {})
  };
}
