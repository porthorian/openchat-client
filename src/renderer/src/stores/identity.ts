import { defineStore } from "pinia";
import { DEFAULT_AVATAR_PRESET_ID } from "@renderer/utils/avatarPresets";
import { projectUID } from "@renderer/utils/uid";
import type { AvatarMode, OnboardingSetupInput, UIDMode } from "@renderer/types/models";

const IDENTITY_STORAGE_KEY = "openchat.identity.v1";

type PersistedIdentityState = {
  rootIdentityId: string;
  uidMode: UIDMode;
  disclosureAcknowledged: boolean;
  hasCompletedSetup: boolean;
  username: string;
  avatarMode: AvatarMode;
  avatarPresetId: string;
  avatarImageDataUrl: string | null;
  ageVerifiedAt: string | null;
  privacyPolicyAcceptedAt: string | null;
  termsOfServiceAcceptedAt: string | null;
  hasViewedPrivacyPolicy: boolean;
  hasViewedTermsOfService: boolean;
};

function createIdentityId(): string {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues) {
    throw new Error("Secure random number generator is unavailable.");
  }

  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(8);
  webCrypto.getRandomValues(randomBytes);
  const randomSegment = Array.from(randomBytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `identity_${randomSegment}`;
}

function normalizeUsername(value: string): string {
  return value.trim().slice(0, 32);
}

function normalizeUIDMode(value: unknown): UIDMode {
  return value === "global" ? "global" : "server_scoped";
}

function normalizeAvatarMode(value: unknown): AvatarMode {
  return value === "uploaded" ? "uploaded" : "generated";
}

function readPersistedIdentity(): PersistedIdentityState | null {
  if (typeof window === "undefined") return null;
  let rawPayload: string | null = null;
  try {
    rawPayload = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
  } catch (_error) {
    return null;
  }
  if (!rawPayload) return null;

  try {
    const parsed = JSON.parse(rawPayload) as Partial<PersistedIdentityState>;
    return {
      rootIdentityId: typeof parsed.rootIdentityId === "string" ? parsed.rootIdentityId : "",
      uidMode: normalizeUIDMode(parsed.uidMode),
      disclosureAcknowledged: Boolean(parsed.disclosureAcknowledged ?? true),
      hasCompletedSetup: Boolean(parsed.hasCompletedSetup),
      username: normalizeUsername(typeof parsed.username === "string" ? parsed.username : ""),
      avatarMode: normalizeAvatarMode(parsed.avatarMode),
      avatarPresetId: typeof parsed.avatarPresetId === "string" ? parsed.avatarPresetId : DEFAULT_AVATAR_PRESET_ID,
      avatarImageDataUrl: typeof parsed.avatarImageDataUrl === "string" ? parsed.avatarImageDataUrl : null,
      ageVerifiedAt: typeof parsed.ageVerifiedAt === "string" ? parsed.ageVerifiedAt : null,
      privacyPolicyAcceptedAt: typeof parsed.privacyPolicyAcceptedAt === "string" ? parsed.privacyPolicyAcceptedAt : null,
      termsOfServiceAcceptedAt: typeof parsed.termsOfServiceAcceptedAt === "string" ? parsed.termsOfServiceAcceptedAt : null,
      hasViewedPrivacyPolicy: Boolean(parsed.hasViewedPrivacyPolicy),
      hasViewedTermsOfService: Boolean(parsed.hasViewedTermsOfService)
    };
  } catch (_error) {
    return null;
  }
}

function writePersistedIdentity(state: PersistedIdentityState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(state));
  } catch (_error) {
    // Local profile persistence is best-effort for now.
  }
}

export const useIdentityStore = defineStore("identity", {
  state: () => ({
    isInitialized: false,
    hasCompletedSetup: false,
    rootIdentityId: "",
    uidMode: "server_scoped" as UIDMode,
    disclosureAcknowledged: true,
    username: "",
    avatarMode: "generated" as AvatarMode,
    avatarPresetId: DEFAULT_AVATAR_PRESET_ID,
    avatarImageDataUrl: null as string | null,
    ageVerifiedAt: null as string | null,
    privacyPolicyAcceptedAt: null as string | null,
    termsOfServiceAcceptedAt: null as string | null,
    hasViewedPrivacyPolicy: false,
    hasViewedTermsOfService: false
  }),
  getters: {
    disclosureMessage(state): string {
      return state.uidMode === "server_scoped"
        ? "This server sees only a server-scoped UID and proof."
        : "This server sees only a global UID and proof.";
    },
    profileDisplayName(state): string {
      const normalized = normalizeUsername(state.username);
      return normalized || "Unknown User";
    }
  },
  actions: {
    persistIdentity(): void {
      writePersistedIdentity({
        rootIdentityId: this.rootIdentityId,
        uidMode: this.uidMode,
        disclosureAcknowledged: this.disclosureAcknowledged,
        hasCompletedSetup: this.hasCompletedSetup,
        username: normalizeUsername(this.username),
        avatarMode: this.avatarMode,
        avatarPresetId: this.avatarPresetId || DEFAULT_AVATAR_PRESET_ID,
        avatarImageDataUrl: this.avatarImageDataUrl,
        ageVerifiedAt: this.ageVerifiedAt,
        privacyPolicyAcceptedAt: this.privacyPolicyAcceptedAt,
        termsOfServiceAcceptedAt: this.termsOfServiceAcceptedAt,
        hasViewedPrivacyPolicy: this.hasViewedPrivacyPolicy,
        hasViewedTermsOfService: this.hasViewedTermsOfService
      });
    },
    ensureIdentityId(): void {
      if (this.rootIdentityId) return;
      this.rootIdentityId = createIdentityId();
    },
    initializeIdentity(): void {
      if (this.isInitialized) return;
      const persisted = readPersistedIdentity();
      if (persisted) {
        this.rootIdentityId = persisted.rootIdentityId;
        this.uidMode = persisted.uidMode;
        this.disclosureAcknowledged = persisted.disclosureAcknowledged;
        this.hasCompletedSetup = Boolean(
          persisted.hasCompletedSetup &&
            persisted.rootIdentityId &&
            persisted.username &&
            persisted.ageVerifiedAt &&
            persisted.privacyPolicyAcceptedAt &&
            persisted.termsOfServiceAcceptedAt
        );
        this.username = persisted.username;
        this.avatarMode = persisted.avatarMode;
        this.avatarPresetId = persisted.avatarPresetId || DEFAULT_AVATAR_PRESET_ID;
        this.avatarImageDataUrl = persisted.avatarImageDataUrl;
        this.ageVerifiedAt = persisted.ageVerifiedAt;
        this.privacyPolicyAcceptedAt = persisted.privacyPolicyAcceptedAt;
        this.termsOfServiceAcceptedAt = persisted.termsOfServiceAcceptedAt;
        this.hasViewedPrivacyPolicy = persisted.hasViewedPrivacyPolicy;
        this.hasViewedTermsOfService = persisted.hasViewedTermsOfService;
      }
      this.isInitialized = true;
    },
    completeSetup(payload: OnboardingSetupInput): void {
      if (!this.isInitialized) {
        this.initializeIdentity();
      }
      const username = normalizeUsername(payload.username);
      if (!username) {
        throw new Error("Username is required.");
      }
      if (!payload.isAgeVerified) {
        throw new Error("Age verification is required.");
      }
      if (!payload.hasViewedPrivacyPolicy || !payload.hasAcceptedPrivacyPolicy) {
        throw new Error("Privacy policy must be viewed and accepted.");
      }
      if (!payload.hasViewedTermsOfService || !payload.hasAcceptedTermsOfService) {
        throw new Error("Terms of service must be viewed and accepted.");
      }
      this.ensureIdentityId();
      this.username = username;
      this.avatarMode = normalizeAvatarMode(payload.avatarMode);
      this.avatarPresetId = payload.avatarPresetId || DEFAULT_AVATAR_PRESET_ID;
      this.avatarImageDataUrl = this.avatarMode === "uploaded" ? payload.avatarImageDataUrl ?? null : null;
      const now = new Date().toISOString();
      this.ageVerifiedAt = now;
      this.privacyPolicyAcceptedAt = now;
      this.termsOfServiceAcceptedAt = now;
      this.hasViewedPrivacyPolicy = true;
      this.hasViewedTermsOfService = true;
      this.hasCompletedSetup = true;
      this.persistIdentity();
    },
    getUIDForServer(serverId: string): string {
      if (!this.isInitialized) {
        this.initializeIdentity();
      }
      if (!this.rootIdentityId) {
        this.ensureIdentityId();
        this.persistIdentity();
      }
      return projectUID(this.rootIdentityId, serverId, this.uidMode);
    },
    setUIDMode(mode: UIDMode): void {
      this.uidMode = mode;
      this.persistIdentity();
    }
  }
});
