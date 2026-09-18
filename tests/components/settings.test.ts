import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import UserSettingsModal from "../../src/renderer/src/components/UserSettingsModal.vue";
import ServerRail from "../../src/renderer/src/components/ServerRail.vue";
import ProfilePanelCard from "../../src/renderer/src/components/ProfilePanelCard.vue";
import { useSettingsStore } from "../../src/renderer/src/stores/settings";
import { useIdentityStore } from "../../src/renderer/src/stores/identity";

const modalProps = {
  isOpen: true, initialTab: "my_account" as const, displayName: "Ada", userUID: "uid_1",
  uidMode: "server_scoped" as const, disclosureMessage: "UID only", avatarMode: "generated" as const,
  avatarPresetId: "ocean", avatarImageDataUrl: null, serverId: "one", serverName: "One",
  backendUrl: "https://example.test", profileScope: "server_scoped" as const,
  notificationServerId: "one", notificationServerName: "One",
  profileEnabled: true, profileConsent: false, profileSyncError: null, startupError: null,
  inputDevices: [], selectedInputDeviceId: "", inputVolume: 100, inputDeviceError: null,
  outputDevices: [], selectedOutputDeviceId: "", outputVolume: 100,
  outputSelectionSupported: false, outputDeviceError: null, videoInputDevices: [],
  selectedCameraDeviceId: "", cameraDeviceError: null, micTestActive: false,
  micTestLevel: 0, micTestError: null, cameraTestActive: false,
  cameraTestStream: null, cameraTestError: null
};

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
});

it("persists migrated mute and restores a server's previous policy", () => {
  localStorage.setItem("openchat.chat-notification-prefs.v1", JSON.stringify({ mutedServerIds: ["one"] }));
  const settings = useSettingsStore();
  settings.hydrate();
  expect(settings.policyFor("one")).toBe("off");
  settings.toggleMute("one");
  expect(settings.policyFor("one")).toBe("all");
  settings.setPolicy("one", "mentions");
  settings.toggleMute("one");
  settings.toggleMute("one");
  expect(settings.policyFor("one")).toBe("mentions");
  expect(JSON.parse(localStorage.getItem("openchat.settings.v1")!).version).toBe(1);
});

it("requires fresh profile consent after a capability scope change", () => {
  const identity = useIdentityStore();
  identity.setProfileConsent("one", "https://chat.example.test", "global", true);
  expect(identity.hasProfileConsent("one", "https://chat.example.test", "global")).toBe(true);
  identity.revokeConsentForScopeChange("one", "https://chat.example.test", "global", "server_scoped");
  expect(identity.hasProfileConsent("one", "https://chat.example.test", "global")).toBe(false);
  expect(identity.hasProfileConsent("one", "https://chat.example.test", "server_scoped")).toBe(false);
});

it("revocation clears the whole consent record if a storage rewrite fails", () => {
  const identity = useIdentityStore();
  identity.setProfileConsent("one", "https://chat.example.test", "global", true);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  try {
    identity.setProfileConsent("one", "https://chat.example.test", "global", false);
    expect(identity.hasProfileConsent("one", "https://chat.example.test", "global")).toBe(false);
    expect(localStorage.getItem("openchat.profile-consent.v1")).toBeNull();
  } finally {
    write.mockRestore();
  }
});

describe("settings dialog", () => {
  it("opens the requested section and saves local edits", async () => {
    const wrapper = mount(UserSettingsModal, { props: modalProps });
    expect(wrapper.find('[role="dialog"][aria-modal="true"]').exists()).toBe(true);
    await wrapper.get('input[autocomplete="nickname"]').setValue("Grace");
    await wrapper.get("button.is-primary").trigger("click");
    expect(wrapper.emitted("saveProfile")?.[0]?.[0]).toMatchObject({ username: "Grace" });
    await wrapper.setProps({ initialTab: "notifications" });
    expect(wrapper.get("#user-settings-title").text()).toBe("Notifications");
    wrapper.unmount();
  });

  it("contains Tab and closes with Escape", async () => {
    const originalRects = HTMLElement.prototype.getClientRects;
    HTMLElement.prototype.getClientRects = () => ({ length: 1 } as DOMRectList);
    const wrapper = mount(UserSettingsModal, { props: modalProps, attachTo: document.body });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const focusable = wrapper.findAll("button:not([disabled]), input:not([disabled]), select:not([disabled])");
    const last = focusable.at(-1)!.element as HTMLElement;
    last.focus();
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(focusable[0].element);
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
    HTMLElement.prototype.getClientRects = originalRects;
  });

  it("reports a shortcut conflict while recording", async () => {
    const wrapper = mount(UserSettingsModal, { props: { ...modalProps, initialTab: "keybinds" } });
    const row = wrapper.findAll(".settings-keybind-row").find((item) => item.text().includes("Focus composer"))!;
    const recorder = row.findAll("button")[0];
    await recorder.trigger("click");
    await recorder.trigger("keydown", { key: ",", ctrlKey: true });
    expect(wrapper.get('[role="alert"]').text()).toContain("Already assigned");
    wrapper.unmount();
  });

  it("requests OS notification permission only from its explicit button", async () => {
    const requestPermission = vi.fn(async () => "granted");
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    const wrapper = mount(UserSettingsModal, { props: { ...modalProps, initialTab: "notifications" } });
    expect(requestPermission).not.toHaveBeenCalled();
    await wrapper.get("button.server-modal-btn").trigger("click");
    await flushPromises();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(wrapper.get('[role="status"]').text()).toContain("granted");
    await wrapper.get("select").setValue("mentions");
    expect(useSettingsStore().policyFor("one")).toBe("mentions");
    wrapper.unmount();
    vi.unstubAllGlobals();
  });
});

describe("server menu", () => {
  it("opens notification settings for the selected server", async () => {
    const wrapper = mount(ServerRail, { props: {
      servers: [{ serverId: "one", displayName: "One", iconText: "O", trustState: "verified" } as never],
      activeServerId: "one", unreadByServer: {}, mentionByServer: {}, mutedByServer: {}
    } });
    await wrapper.get("button.server-dot:not(.app-home):not(.utility)").trigger("contextmenu", { clientX: 20, clientY: 20 });
    const button = wrapper.findAll(".server-context-item").find((item) => item.text().includes("Notification Settings"));
    await button!.trigger("click");
    expect(wrapper.emitted("openNotificationSettings")?.[0]).toEqual(["one"]);
    wrapper.unmount();
  });

  it("opens from the keyboard, moves with arrows, and returns focus", async () => {
    const originalRects = HTMLElement.prototype.getClientRects;
    HTMLElement.prototype.getClientRects = () => ({ length: 1 } as DOMRectList);
    const wrapper = mount(ServerRail, { attachTo: document.body, props: {
      servers: [{ serverId: "one", displayName: "One", iconText: "O", trustState: "verified" } as never],
      activeServerId: "one", unreadByServer: {}, mentionByServer: {}, mutedByServer: {}
    } });
    const trigger = wrapper.get('button[aria-label="One"]');
    (trigger.element as HTMLElement).focus();
    await trigger.trigger("keydown", { key: "F10", shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const options = wrapper.findAll('.server-context-menu [role^="menuitem"]');
    expect(document.activeElement).toBe(options[0].element);
    await options[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1].element);
    await options[1].trigger("keydown", { key: "Escape" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
    HTMLElement.prototype.getClientRects = originalRects;
  });
});

it("profile status menu opens and selects a local presence choice by keyboard", async () => {
  const originalRects = HTMLElement.prototype.getClientRects;
  HTMLElement.prototype.getClientRects = () => ({ length: 1 } as DOMRectList);
  const wrapper = mount(ProfilePanelCard, { attachTo: document.body, props: {
    serverName: "One", currentUid: "uid", profileDisplayName: "Ada",
    profileAvatarMode: "generated", profileAvatarPresetId: "horizon",
    profileAvatarImageDataUrl: null, presenceStatus: "online"
  } });
  await wrapper.get(".profile-status-trigger").trigger("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(wrapper.get('[role="menu"]').exists()).toBe(true);
  const busy = wrapper.findAll('[role="menuitemradio"]').find((item) => item.text().includes("Do Not Disturb"))!;
  await busy.trigger("click");
  expect(wrapper.emitted("update:presenceStatus")?.[0]).toEqual(["busy"]);
  wrapper.unmount();
  HTMLElement.prototype.getClientRects = originalRects;
});
