export type CapabilityTransport = "websocket" | "sse" | "polling";
export type IdentityHandshakeMode = "challenge_signature" | "token_proof";
export type UserUIDPolicy = "server_scoped" | "global" | "either";
export type TrustRequirement = "required" | "recommended" | "optional";
export type RTCSignalingTransport = "websocket";
export type RTCTopology = "sfu" | "p2p";
export type RTCIceCredentialType = "none" | "static" | "ephemeral";
export type ProfileDataPolicy = "uid_only" | (string & {});

export type TransportCapabilitiesResponse = {
  websocket: boolean;
  sse: boolean;
  polling: boolean;
};

export type CoreFeatureFlagsResponse = {
  messaging?: boolean;
  presence?: boolean;
  attachments?: boolean;
  notifications?: boolean;
};

export type CapabilityLimitsResponse = {
  max_message_bytes?: number;
  max_upload_bytes?: number;
  rate_limit_per_minute?: number;
  max_call_participants?: number;
};

export type SecurityCapabilitiesResponse = {
  https_required: boolean;
  certificate_pinning: TrustRequirement;
  tls_fingerprint?: string;
};

export type RTCFeatureFlagsResponse = {
  voice: boolean;
  video: boolean;
  screenshare: boolean;
  simulcast: boolean;
};

export type RTCIceServerResponse = {
  urls: string[];
  username?: string;
  credential?: string;
  credential_type?: RTCIceCredentialType;
  expires_at?: string | null;
};

export type RTCConnectionPolicyResponse = {
  join_timeout_ms: number;
  answer_timeout_ms: number;
  ice_restart_enabled: boolean;
  reconnect_backoff_ms: number[];
};

export type RTCCapabilitiesResponse = {
  protocol_version: string;
  signaling_url: string;
  signaling_transport: RTCSignalingTransport;
  topologies: RTCTopology[];
  features: RTCFeatureFlagsResponse;
  ice_servers: RTCIceServerResponse[];
  connection_policy: RTCConnectionPolicyResponse;
};

export type ServerCapabilitiesResponse = {
  server_name: string;
  server_id: string;
  api_version: string;
  identity_handshake_modes: IdentityHandshakeMode[];
  user_uid_policy: UserUIDPolicy;
  profile_data_policy: ProfileDataPolicy;
  transport: TransportCapabilitiesResponse;
  features: CoreFeatureFlagsResponse;
  limits: CapabilityLimitsResponse;
  security: SecurityCapabilitiesResponse;
  rtc?: RTCCapabilitiesResponse;
};

export type TransportCapabilities = {
  websocket: boolean;
  sse: boolean;
  polling: boolean;
};

export type CoreFeatureFlags = {
  messaging: boolean;
  presence: boolean;
  attachments: boolean;
  notifications: boolean;
};

export type CapabilityLimits = {
  maxMessageBytes: number | null;
  maxUploadBytes: number | null;
  rateLimitPerMinute: number | null;
  maxCallParticipants: number | null;
};

export type SecurityCapabilities = {
  httpsRequired: boolean;
  certificatePinning: TrustRequirement;
  tlsFingerprint: string | null;
};

export type RTCFeatureFlags = {
  voice: boolean;
  video: boolean;
  screenshare: boolean;
  simulcast: boolean;
};

export type RTCIceServer = {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType: RTCIceCredentialType;
  expiresAt: string | null;
};

export type RTCConnectionPolicy = {
  joinTimeoutMs: number;
  answerTimeoutMs: number;
  iceRestartEnabled: boolean;
  reconnectBackoffMs: number[];
};

export type RTCCapabilities = {
  protocolVersion: string;
  signalingUrl: string;
  signalingTransport: RTCSignalingTransport;
  topologies: RTCTopology[];
  features: RTCFeatureFlags;
  iceServers: RTCIceServer[];
  connectionPolicy: RTCConnectionPolicy;
};

export type ServerCapabilities = {
  serverName: string;
  serverId: string;
  apiVersion: string;
  identityHandshakeModes: IdentityHandshakeMode[];
  userUidPolicy: UserUIDPolicy;
  profileDataPolicy: ProfileDataPolicy;
  transport: TransportCapabilities;
  features: CoreFeatureFlags;
  limits: CapabilityLimits;
  security: SecurityCapabilities;
  rtc: RTCCapabilities | null;
};

export function normalizeServerCapabilities(source: ServerCapabilitiesResponse): ServerCapabilities {
  const rtc = source.rtc
    ? {
        protocolVersion: source.rtc.protocol_version,
        signalingUrl: source.rtc.signaling_url,
        signalingTransport: source.rtc.signaling_transport,
        topologies: source.rtc.topologies,
        features: {
          voice: source.rtc.features.voice,
          video: source.rtc.features.video,
          screenshare: source.rtc.features.screenshare,
          simulcast: source.rtc.features.simulcast
        },
        iceServers: source.rtc.ice_servers.map((iceServer) => ({
          urls: iceServer.urls,
          username: iceServer.username,
          credential: iceServer.credential,
          credentialType: iceServer.credential_type ?? "none",
          expiresAt: iceServer.expires_at ?? null
        })),
        connectionPolicy: {
          joinTimeoutMs: source.rtc.connection_policy.join_timeout_ms,
          answerTimeoutMs: source.rtc.connection_policy.answer_timeout_ms,
          iceRestartEnabled: source.rtc.connection_policy.ice_restart_enabled,
          reconnectBackoffMs: source.rtc.connection_policy.reconnect_backoff_ms
        }
      }
    : null;

  return {
    serverName: source.server_name,
    serverId: source.server_id,
    apiVersion: source.api_version,
    identityHandshakeModes: source.identity_handshake_modes,
    userUidPolicy: source.user_uid_policy,
    profileDataPolicy: source.profile_data_policy,
    transport: {
      websocket: source.transport.websocket,
      sse: source.transport.sse,
      polling: source.transport.polling
    },
    features: {
      messaging: source.features.messaging ?? false,
      presence: source.features.presence ?? false,
      attachments: source.features.attachments ?? false,
      notifications: source.features.notifications ?? false
    },
    limits: {
      maxMessageBytes: source.limits.max_message_bytes ?? null,
      maxUploadBytes: source.limits.max_upload_bytes ?? null,
      rateLimitPerMinute: source.limits.rate_limit_per_minute ?? null,
      maxCallParticipants: source.limits.max_call_participants ?? null
    },
    security: {
      httpsRequired: source.security.https_required,
      certificatePinning: source.security.certificate_pinning,
      tlsFingerprint: source.security.tls_fingerprint ?? null
    },
    rtc
  };
}
