import { test, expect, _electron as electron } from "@playwright/test";
import axe from "axe-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function launchIsolated() {
  const userData = await mkdtemp(path.join(tmpdir(), "openchat-electron-test-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${userData}`, "--no-sandbox"] });
  return { app, page: await app.firstWindow(), userData };
}

test("onboarding has keyboard focus and no axe WCAG findings", async () => {
  const { app, page, userData } = await launchIsolated();
  try {
    await expect(page.getByRole("heading", { name: "Set up your profile" })).toBeVisible();
    expect(await page.evaluate(() => typeof window.openchat?.getAppVersion)).toBe("function");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
    await page.evaluate(axe.source);
    const results = await page.evaluate(() => (window as typeof window & { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] }
    }));
    expect(results.violations.map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) }))).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("settings persist after restart and profile is not uploaded", async () => {
  const launched = await launchIsolated();
  let { app, page } = launched;
  const { userData } = launched;
  const uploads: string[] = [];
  const trackProfileRequest = (request: { url(): string; method(): string }) => {
    if (/profile/i.test(request.url()) && !["GET", "HEAD"].includes(request.method())) uploads.push(request.url());
  };
  page.on("request", trackProfileRequest);
  await page.route("http://127.0.0.1:9/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  try {
    await expect(page.getByRole("heading", { name: "Set up your profile" })).toBeVisible();
    await page.evaluate(() => {
      const now = new Date().toISOString();
      localStorage.setItem("openchat.identity.v1", JSON.stringify({
        rootIdentityId: "identity_e2etest", uidMode: "server_scoped", disclosureAcknowledged: true,
        hasCompletedSetup: true, username: "Smoke User", avatarMode: "generated",
        avatarPresetId: "horizon", avatarImageDataUrl: null,
        ageVerifiedAt: now, privacyPolicyAcceptedAt: now, termsOfServiceAcceptedAt: now,
        hasViewedPrivacyPolicy: true, hasViewedTermsOfService: true
      }));
      localStorage.setItem("openchat.server-registry.v1", JSON.stringify({ servers: [{
        serverId: "server-test", displayName: "Test", iconText: "T", description: "",
        backendUrl: "http://127.0.0.1:9", trustState: "unverified",
        identityHandshakeStrategy: "challenge_signature", userIdentifierPolicy: "server_scoped",
        capabilities: { profile: { enabled: true, scope: "global" } }
      }, {
        serverId: "server-other", displayName: "Other", iconText: "O", description: "",
        backendUrl: "http://127.0.0.1:9", trustState: "unverified",
        identityHandshakeStrategy: "challenge_signature", userIdentifierPolicy: "server_scoped"
      }] }));
    });
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.evaluate(axe.source);
    const darkAudit = await page.evaluate(() => (window as typeof window & { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] }
    }));
    expect(darkAudit.violations
      .map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) }))).toEqual([]);
    expect(uploads).toEqual([]);
    await page.evaluate(() => localStorage.setItem("openchat.profile-consent.v1", JSON.stringify({
      version: 1, grants: { "global:http://127.0.0.1:9": { grantedAt: new Date().toISOString() } }
    })));
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();
    expect(uploads).toEqual([]);
    await page.evaluate(axe.source);
    await page.locator(".user-identity-btn").click();
    await page.locator(".profile-status-trigger").click();
    const menuAudit = await page.evaluate(() => (window as typeof window & { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] }
    }));
    expect(menuAudit.violations
      .map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) }))).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Other" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Notification Settings/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await page.getByRole("dialog", { name: "Notifications" }).getByRole("combobox", { name: "Other" }).selectOption("mentions");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("openchat.settings.v1")!).notificationPolicyByServer["server-other"])).toBe("mentions");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Open user settings" }).click();
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByLabel("Color theme").selectOption("light");
    await page.getByRole("button", { name: "Accessibility" }).click();
    await page.getByLabel("Text size").selectOption("200");
    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(page.getByLabel("Text size")).toBeVisible();
    expect(await page.locator(".user-settings-modal").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.setViewportSize(originalViewport ?? { width: 1280, height: 800 });
    await page.evaluate(axe.source);
    const audit = await page.evaluate(() => (window as typeof window & { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] }
    }));
    expect(audit.violations
      .map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) }))).toEqual([]);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const workspaceAudit = await page.evaluate(() => (window as typeof window & { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] }
    }));
    expect(workspaceAudit.violations
      .map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) }))).toEqual([]);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await expect(page.getByRole("dialog", { name: "My Account" })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe("200%");
    await page.getByRole("button", { name: "Open user settings" }).click();
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByLabel("Color theme").selectOption("system");
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce", contrast: "more" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
    await page.evaluate(axe.source);
    const contrastAudit = await page.evaluate(() => (window as typeof window & { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] }
    }));
    expect(contrastAudit.violations
      .map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) }))).toEqual([]);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference", contrast: "no-preference" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByLabel("Color theme").selectOption("light");
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${userData}`, "--no-sandbox"] });
    app.context().on("request", trackProfileRequest);
    page = await app.firstWindow();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe("200%");
    expect(uploads).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    await rm(userData, { recursive: true, force: true });
  }
});
