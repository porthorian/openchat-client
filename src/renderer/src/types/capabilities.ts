export type CapabilityTransport = "websocket" | "sse" | "polling";
export type IdentityHandshakeMode = "challenge_signature" | "token_proof";
export type UserUIDPolicy = "server_scoped" | "global" | "either";
export type TrustRequirement = "required" | "recommended" | "optional";
export type RTCSignalingTransport = "websocket";
export type RTCTopology = "sfu" | "p2p";
export type RTCIceCredentialType = "none" | "static" | "ephemeral";
export type ProfileDataPolicy = "uid_only" | (string & {});
export type ProfileScope = "global" | "server_scoped";
export type MessageAuthorProfileMode = "live" | "snapshot";

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

export type ProfileDisplayNameRulesResponse = {
  min_length: number;
  max_length: number;
  pattern?: string;
};

export type ProfileAvatarUploadRulesResponse = {
  max_bytes: number;
  mime_types: string[];
  max_width: number;
  max_height: number;
};

export type ProfileCapabilitiesResponse = {
  enabled: boolean;
  scope: ProfileScope;
  fields: string[];
  avatar_modes: Array<"generated" | "uploaded">;
  display_name: ProfileDisplayNameRulesResponse;
  avatar_upload?: ProfileAvatarUploadRulesResponse;
  realtime_event: string;
  message_author_profile_mode: MessageAuthorProfileMode;
};

export type ServerCapabilitiesResponse = {
  server_name: string;
  server_id: string;
  api_version: string;
  build_version?: string;
  build_commit?: string;
  identity_handshake_modes: IdentityHandshakeMode[];
  user_uid_policy: UserUIDPolicy;
  profile_data_policy: ProfileDataPolicy;
  transport: TransportCapabilitiesResponse;
  features: CoreFeatureFlagsResponse;
  limits: CapabilityLimitsResponse;
  security: SecurityCapabilitiesResponse;
  rtc?: RTCCapabilitiesResponse;
  profile?: ProfileCapabilitiesResponse;
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

export type ProfileDisplayNameRules = {
  minLength: number;
  maxLength: number;
  pattern: string | null;
};

export type ProfileAvatarUploadRules = {
  maxBytes: number;
  mimeTypes: string[];
  maxWidth: number;
  maxHeight: number;
};

export type ProfileCapabilities = {
  enabled: boolean;
  scope: ProfileScope;
  fields: string[];
  avatarModes: Array<"generated" | "uploaded">;
  displayName: ProfileDisplayNameRules;
  avatarUpload: ProfileAvatarUploadRules | null;
  realtimeEvent: string;
  messageAuthorProfileMode: MessageAuthorProfileMode;
};

export type ServerCapabilities = {
  serverName: string;
  serverId: string;
  apiVersion: string;
  buildVersion: string | null;
  buildCommit: string | null;
  identityHandshakeModes: IdentityHandshakeMode[];
  userUidPolicy: UserUIDPolicy;
  profileDataPolicy: ProfileDataPolicy;
  transport: TransportCapabilities;
  features: CoreFeatureFlags;
  limits: CapabilityLimits;
  security: SecurityCapabilities;
  rtc: RTCCapabilities | null;
  profile: ProfileCapabilities | null;
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

  const profile = source.profile
    ? {
        enabled: source.profile.enabled,
        scope: source.profile.scope,
        fields: source.profile.fields,
        avatarModes: source.profile.avatar_modes,
        displayName: {
          minLength: source.profile.display_name.min_length,
          maxLength: source.profile.display_name.max_length,
          pattern: source.profile.display_name.pattern ?? null
        },
        avatarUpload: source.profile.avatar_upload
          ? {
              maxBytes: source.profile.avatar_upload.max_bytes,
              mimeTypes: source.profile.avatar_upload.mime_types,
              maxWidth: source.profile.avatar_upload.max_width,
              maxHeight: source.profile.avatar_upload.max_height
            }
          : null,
        realtimeEvent: source.profile.realtime_event,
        messageAuthorProfileMode: source.profile.message_author_profile_mode
      }
    : null;

  return {
    serverName: source.server_name,
    serverId: source.server_id,
    apiVersion: source.api_version,
    buildVersion: source.build_version ?? null,
    buildCommit: source.build_commit ?? null,
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
    rtc,
    profile
  };
}
