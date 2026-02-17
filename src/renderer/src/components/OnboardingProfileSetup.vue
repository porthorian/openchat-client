<script setup lang="ts">
import { computed, ref } from "vue";
import type { AvatarMode, OnboardingSetupInput } from "@renderer/types/models";
import { DEFAULT_AVATAR_PRESET_ID, GENERATED_AVATAR_PRESETS, avatarPresetById } from "@renderer/utils/avatarPresets";

type OnboardingStep = "profile" | "compliance";
type PolicyDocument = "privacy" | "terms";

const emit = defineEmits<{
  complete: [payload: OnboardingSetupInput];
}>();

const currentStep = ref<OnboardingStep>("profile");
const username = ref("");
const avatarMode = ref<AvatarMode>("generated");
const avatarPresetId = ref(DEFAULT_AVATAR_PRESET_ID);
const avatarImageDataUrl = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

const ageVerified = ref(false);
const hasViewedPrivacyPolicy = ref(false);
const hasViewedTermsOfService = ref(false);
const hasAcceptedPrivacyPolicy = ref(false);
const hasAcceptedTermsOfService = ref(false);
const activePolicyDocument = ref<PolicyDocument | null>(null);

const previewName = computed(() => {
  const trimmed = username.value.trim();
  return trimmed || "New User";
});

const previewInitial = computed(() => {
  return previewName.value.slice(0, 1).toUpperCase();
});

const selectedPreset = computed(() => avatarPresetById(avatarPresetId.value));

function selectAvatarMode(mode: AvatarMode): void {
  avatarMode.value = mode;
  errorMessage.value = null;
}

function selectPreset(id: string): void {
  avatarPresetId.value = id;
  avatarMode.value = "generated";
  errorMessage.value = null;
}

function handleAvatarUpload(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const maxSizeBytes = 2 * 1024 * 1024;
  if (!acceptedTypes.has(file.type)) {
    errorMessage.value = "Use PNG, JPG, or WEBP for your avatar.";
    input.value = "";
    return;
  }
  if (file.size > maxSizeBytes) {
    errorMessage.value = "Avatar must be 2 MB or smaller.";
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== "string") {
      errorMessage.value = "Failed to read avatar file.";
      input.value = "";
      return;
    }
    avatarImageDataUrl.value = reader.result;
    avatarMode.value = "uploaded";
    errorMessage.value = null;
  };
  reader.onerror = () => {
    errorMessage.value = "Failed to read avatar file.";
    input.value = "";
  };
  reader.readAsDataURL(file);
}

function continueToCompliance(): void {
  const normalizedUsername = username.value.trim();
  if (!normalizedUsername) {
    errorMessage.value = "Username is required.";
    return;
  }
  if (avatarMode.value === "uploaded" && !avatarImageDataUrl.value) {
    errorMessage.value = "Upload an avatar image or switch to generated.";
    return;
  }
  errorMessage.value = null;
  currentStep.value = "compliance";
}

function returnToProfile(): void {
  errorMessage.value = null;
  currentStep.value = "profile";
}

function openPolicyDocument(kind: PolicyDocument): void {
  activePolicyDocument.value = kind;
  if (kind === "privacy") {
    hasViewedPrivacyPolicy.value = true;
  } else {
    hasViewedTermsOfService.value = true;
  }
  errorMessage.value = null;
}

function closePolicyDocument(): void {
  activePolicyDocument.value = null;
}

function agreeToPolicyDocument(): void {
  if (activePolicyDocument.value === "privacy") {
    hasAcceptedPrivacyPolicy.value = true;
  } else if (activePolicyDocument.value === "terms") {
    hasAcceptedTermsOfService.value = true;
  }
  errorMessage.value = null;
  closePolicyDocument();
}

function declinePolicyDocument(): void {
  if (activePolicyDocument.value === "privacy") {
    hasAcceptedPrivacyPolicy.value = false;
    errorMessage.value = "You cannot use OpenChat while you disagree with the Privacy Policy.";
  } else if (activePolicyDocument.value === "terms") {
    hasAcceptedTermsOfService.value = false;
    errorMessage.value = "You cannot use OpenChat while you disagree with the Terms of Service.";
  }
  closePolicyDocument();
}

function completeSetup(): void {
  const normalizedUsername = username.value.trim();
  if (!normalizedUsername) {
    errorMessage.value = "Username is required.";
    currentStep.value = "profile";
    return;
  }
  if (!ageVerified.value) {
    errorMessage.value = "Age verification is required.";
    return;
  }
  if (!hasViewedPrivacyPolicy.value) {
    errorMessage.value = "View the Privacy Policy to continue.";
    return;
  }
  if (!hasAcceptedPrivacyPolicy.value) {
    errorMessage.value = "You cannot use OpenChat while you disagree with the Privacy Policy.";
    return;
  }
  if (!hasViewedTermsOfService.value) {
    errorMessage.value = "View the Terms of Service to continue.";
    return;
  }
  if (!hasAcceptedTermsOfService.value) {
    errorMessage.value = "You cannot use OpenChat while you disagree with the Terms of Service.";
    return;
  }

  errorMessage.value = null;
  emit("complete", {
    username: normalizedUsername,
    avatarMode: avatarMode.value,
    avatarPresetId: avatarPresetId.value,
    avatarImageDataUrl: avatarMode.value === "uploaded" ? avatarImageDataUrl.value : null,
    isAgeVerified: ageVerified.value,
    hasViewedPrivacyPolicy: hasViewedPrivacyPolicy.value,
    hasViewedTermsOfService: hasViewedTermsOfService.value,
    hasAcceptedPrivacyPolicy: hasAcceptedPrivacyPolicy.value,
    hasAcceptedTermsOfService: hasAcceptedTermsOfService.value
  });
}
</script>

<template>
  <main class="onboarding-shell">
    <section class="onboarding-card" role="dialog" aria-label="Profile setup">
      <header class="onboarding-header">
        <p class="onboarding-kicker">OpenChat setup</p>
        <h1 v-if="currentStep === 'profile'">Set up your profile</h1>
        <h1 v-else>Complete account verification</h1>
        <p v-if="currentStep === 'profile'">Create your username and choose an avatar. You can edit both later in settings.</p>
        <p v-else>Verify age, review our privacy policy, and accept terms of service to finish onboarding.</p>
      </header>

      <template v-if="currentStep === 'profile'">
        <label class="onboarding-field">
          <span>Username</span>
          <input
            v-model="username"
            type="text"
            maxlength="32"
            autocomplete="nickname"
            placeholder="What should people call you?"
          />
        </label>

        <section class="avatar-section" aria-label="Avatar selection">
          <div class="avatar-mode-row">
            <button
              type="button"
              class="avatar-mode-btn"
              :class="{ 'is-active': avatarMode === 'generated' }"
              @click="selectAvatarMode('generated')"
            >
              Generated
            </button>
            <button
              type="button"
              class="avatar-mode-btn"
              :class="{ 'is-active': avatarMode === 'uploaded' }"
              @click="selectAvatarMode('uploaded')"
            >
              Upload
            </button>
          </div>

          <div v-if="avatarMode === 'generated'" class="avatar-grid">
            <button
              v-for="preset in GENERATED_AVATAR_PRESETS"
              :key="preset.id"
              type="button"
              class="avatar-preset"
              :class="{ 'is-active': preset.id === avatarPresetId }"
              :style="{ background: preset.gradient, color: preset.accent }"
              @click="selectPreset(preset.id)"
            >
              {{ previewInitial }}
            </button>
          </div>

          <div v-else class="avatar-upload">
            <label class="avatar-upload-btn">
              <span>Choose image</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" @change="handleAvatarUpload" />
            </label>
            <p>PNG, JPG, or WEBP. Max 2 MB.</p>
          </div>
        </section>

        <section class="profile-preview" aria-label="Profile preview">
          <div
            class="profile-preview-avatar"
            :style="avatarMode === 'generated' ? { background: selectedPreset.gradient, color: selectedPreset.accent } : {}"
          >
            <img v-if="avatarMode === 'uploaded' && avatarImageDataUrl" :src="avatarImageDataUrl" alt="" />
            <template v-else>{{ previewInitial }}</template>
          </div>
          <div class="profile-preview-copy">
            <strong>{{ previewName }}</strong>
            <small>Local profile data is stored on this device.</small>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="profile-preview" aria-label="Profile preview">
          <div
            class="profile-preview-avatar"
            :style="avatarMode === 'generated' ? { background: selectedPreset.gradient, color: selectedPreset.accent } : {}"
          >
            <img v-if="avatarMode === 'uploaded' && avatarImageDataUrl" :src="avatarImageDataUrl" alt="" />
            <template v-else>{{ previewInitial }}</template>
          </div>
          <div class="profile-preview-copy">
            <strong>{{ previewName }}</strong>
            <small>Review and accept policies to continue.</small>
          </div>
        </section>

        <section class="compliance-section" aria-label="Compliance requirements">
          <label class="compliance-check">
            <input v-model="ageVerified" type="checkbox" />
            <span>I confirm that I am at least 13 years old.</span>
          </label>

          <div class="policy-actions">
            <button type="button" class="policy-action-btn" @click="openPolicyDocument('privacy')">
              {{ hasViewedPrivacyPolicy ? "Privacy Policy Viewed" : "View Privacy Policy" }}
            </button>
            <button type="button" class="policy-action-btn" @click="openPolicyDocument('terms')">
              {{ hasViewedTermsOfService ? "Terms Viewed" : "View Terms of Service" }}
            </button>
          </div>

          <label class="compliance-check">
            <input v-model="hasAcceptedPrivacyPolicy" type="checkbox" :disabled="!hasViewedPrivacyPolicy" />
            <span>I have read and accept the Privacy Policy.</span>
          </label>

          <label class="compliance-check">
            <input v-model="hasAcceptedTermsOfService" type="checkbox" :disabled="!hasViewedTermsOfService" />
            <span>I have read and accept the Terms of Service.</span>
          </label>
        </section>
      </template>

      <div v-if="activePolicyDocument" class="policy-modal-backdrop" role="presentation" @click.self="closePolicyDocument">
        <section class="policy-modal" role="dialog" aria-modal="true">
          <header>
            <h2>{{ activePolicyDocument === "privacy" ? "Privacy Policy" : "Terms of Service" }}</h2>
            <button type="button" class="policy-close-btn" @click="closePolicyDocument">Close</button>
          </header>
          <div class="policy-copy">
            <p v-if="activePolicyDocument === 'privacy'">
              OpenChat stores profile setup details locally on your device. Server communication shares only protocol-required
              identifiers and metadata needed for messaging features.
            </p>
            <p v-if="activePolicyDocument === 'privacy'">
              Uploaded avatars are saved locally for profile rendering. You can replace or remove local profile data from settings.
            </p>
            <p v-if="activePolicyDocument === 'terms'">
              You are responsible for activity under your local account profile and must comply with community/server rules.
            </p>
            <p v-if="activePolicyDocument === 'terms'">
              Abuse, unauthorized access attempts, and disruptive use of server resources are prohibited.
            </p>
            <p>By continuing, you acknowledge these terms for this client application.</p>
          </div>
          <footer>
            <button type="button" class="policy-decline-btn" @click="declinePolicyDocument">Decline</button>
            <button type="button" class="policy-close-btn" @click="agreeToPolicyDocument">Agree</button>
          </footer>
        </section>
      </div>

      <p v-if="errorMessage" class="onboarding-error">{{ errorMessage }}</p>

      <footer class="onboarding-actions">
        <button v-if="currentStep === 'compliance'" type="button" class="onboarding-back-btn" @click="returnToProfile">
          Back
        </button>
        <button
          v-if="currentStep === 'profile'"
          type="button"
          class="onboarding-continue"
          @click="continueToCompliance"
        >
          Continue
        </button>
        <button
          v-else
          type="button"
          class="onboarding-continue"
          @click="completeSetup"
        >
          Complete onboarding
        </button>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.onboarding-shell {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
}

.onboarding-card {
  width: min(560px, 100%);
  border: 1px solid #32374b;
  border-radius: 16px;
  background: linear-gradient(180deg, #1e2332, #181c2a);
  box-shadow: 0 20px 38px rgb(0 0 0 / 38%);
  padding: 18px;
  display: grid;
  gap: 16px;
}

.onboarding-header {
  display: grid;
  gap: 6px;
}

.onboarding-kicker {
  color: #9fb4ef;
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.onboarding-header h1 {
  font-size: 1.42rem;
}

.onboarding-header p {
  color: #c4ccdf;
  font-size: 0.95rem;
}

.onboarding-field {
  display: grid;
  gap: 7px;
}

.onboarding-field span {
  color: #cad2e7;
  font-size: 0.82rem;
  letter-spacing: 0.03em;
}

.onboarding-field input {
  height: 40px;
  border: 1px solid #3d4359;
  border-radius: 9px;
  background: #111623;
  color: #ecf0fb;
  padding: 0 12px;
  outline: none;
}

.onboarding-field input:focus {
  border-color: #5d72aa;
}

.avatar-section {
  display: grid;
  gap: 10px;
}

.avatar-mode-row {
  display: inline-flex;
  gap: 8px;
}

.avatar-mode-btn {
  min-height: 32px;
  border-radius: 8px;
  border: 1px solid #434a61;
  background: #242a3b;
  color: #dce4f6;
  padding: 0 12px;
}

.avatar-mode-btn.is-active {
  border-color: #7084b8;
  background: #334162;
}

.avatar-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.avatar-preset {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  border: 2px solid transparent;
  font-size: 1.15rem;
  font-weight: 800;
}

.avatar-preset.is-active {
  border-color: #ecf0fb;
}

.avatar-upload {
  display: grid;
  gap: 8px;
}

.avatar-upload p {
  color: #aab3c9;
  font-size: 0.82rem;
}

.avatar-upload-btn {
  min-height: 36px;
  width: fit-content;
  border-radius: 8px;
  border: 1px solid #586286;
  background: #2f3a57;
  color: #e8eefb;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
}

.avatar-upload-btn input {
  display: none;
}

.profile-preview {
  border: 1px solid #3a435d;
  border-radius: 12px;
  background: #1c2232;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.profile-preview-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 1.14rem;
  font-weight: 800;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 18%);
}

.profile-preview-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-preview-copy {
  display: grid;
  gap: 2px;
}

.profile-preview-copy strong {
  font-size: 1rem;
}

.profile-preview-copy small {
  color: #a9b2c8;
}

.compliance-section {
  border: 1px solid #3a425a;
  border-radius: 12px;
  background: #1a2133;
  padding: 12px;
  display: grid;
  gap: 12px;
}

.compliance-check {
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  color: #dee5f6;
  font-size: 0.9rem;
}

.compliance-check input {
  margin-top: 2px;
  accent-color: #7891ce;
}

.policy-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.policy-action-btn {
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid #5a6a93;
  background: #2f3d5f;
  color: #eaf0ff;
  padding: 0 12px;
}

.policy-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgb(9 11 16 / 64%);
  display: grid;
  place-items: center;
  padding: 18px;
}

.policy-modal {
  width: min(540px, 100%);
  border-radius: 12px;
  border: 1px solid #3f465e;
  background: linear-gradient(180deg, #1f2637, #181d2c);
  box-shadow: 0 20px 34px rgb(0 0 0 / 42%);
  display: grid;
  gap: 12px;
  padding: 14px;
}

.policy-modal header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.policy-modal h2 {
  font-size: 1.12rem;
}

.policy-copy {
  display: grid;
  gap: 8px;
}

.policy-copy p {
  color: #d7deef;
  font-size: 0.9rem;
  line-height: 1.35;
}

.policy-modal footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.policy-decline-btn {
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid #73444b;
  background: #4d2b31;
  color: #ffe5e8;
  padding: 0 12px;
}

.policy-close-btn {
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid #56648b;
  background: #2d3a59;
  color: #e8eefd;
  padding: 0 12px;
}

.onboarding-error {
  border-radius: 8px;
  border: 1px solid #7a3a40;
  background: #49262c;
  color: #ffd2d7;
  padding: 8px 10px;
  font-size: 0.85rem;
}

.onboarding-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.onboarding-back-btn {
  min-height: 38px;
  border-radius: 9px;
  border: 1px solid #546286;
  background: #2e3851;
  color: #dbe3f5;
  padding: 0 14px;
}

.onboarding-continue {
  min-height: 38px;
  border-radius: 9px;
  border: 1px solid #6980b5;
  background: #3b4d77;
  color: #f2f6ff;
  padding: 0 14px;
}

.onboarding-continue:hover {
  background: #445886;
}

@media (max-width: 760px) {
  .avatar-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
