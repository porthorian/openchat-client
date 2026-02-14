import type { ServerCapabilities } from "@renderer/types/capabilities";

export type UIDMode = "server_scoped" | "global";
export type AvatarMode = "generated" | "uploaded";

export type OnboardingProfileInput = {
  username: string;
  avatarMode: AvatarMode;
  avatarPresetId: string;
  avatarImageDataUrl: string | null;
};

export type OnboardingComplianceInput = {
  isAgeVerified: boolean;
  hasViewedPrivacyPolicy: boolean;
  hasViewedTermsOfService: boolean;
  hasAcceptedPrivacyPolicy: boolean;
  hasAcceptedTermsOfService: boolean;
};

export type OnboardingSetupInput = OnboardingProfileInput & OnboardingComplianceInput;

export type ServerProfile = {
  serverId: string;
  displayName: string;
  backendUrl: string;
  iconText: string;
  trustState: "verified" | "unverified";
  identityHandshakeStrategy: "challenge_signature" | "token_proof";
  userIdentifierPolicy: "server_scoped" | "global" | "either";
  capabilities?: ServerCapabilities;
  capabilitiesFetchedAt?: string;
};

export type SessionStatus = "disconnected" | "connecting" | "active" | "expired";
