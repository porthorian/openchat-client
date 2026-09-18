import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

/** Keeps focus in a mounted modal and returns it to its opener on close. */
export function useDialogFocus(isOpen: () => boolean, dialog: Ref<HTMLElement | null>, close: () => void): void {
  let opener: HTMLElement | null = null;
  let inertSiblings: Array<{ element: HTMLElement; wasInert: boolean }> = [];
  function focusFirst(): void {
    const target = dialog.value?.querySelector<HTMLElement>("[data-initial-focus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
    (target ?? dialog.value)?.focus();
  }
  watch(isOpen, async (open) => {
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      const backdrop = dialog.value?.parentElement;
      inertSiblings = backdrop?.parentElement
        ? [...backdrop.parentElement.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== backdrop)
          .map((element) => ({ element, wasInert: element.inert }))
        : [];
      for (const item of inertSiblings) item.element.inert = true;
      focusFirst();
    } else {
      await nextTick();
      for (const item of inertSiblings) item.element.inert = item.wasInert;
      inertSiblings = [];
      if (opener?.isConnected) opener.focus();
      opener = null;
    }
  }, { immediate: true });
  function onKeydown(event: KeyboardEvent): void {
    if (!isOpen() || !dialog.value) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const candidates = [...dialog.value.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((item) => item.getClientRects().length > 0);
    if (candidates.length === 0) {
      event.preventDefault();
      dialog.value.focus();
      return;
    }
    const first = candidates[0];
    const last = candidates[candidates.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function onFocusIn(event: FocusEvent): void {
    if (isOpen() && dialog.value && !dialog.value.contains(event.target as Node)) focusFirst();
  }
  document.addEventListener("focusin", onFocusIn);
  onBeforeUnmount(() => {
    document.removeEventListener("focusin", onFocusIn);
    dialog.value?.removeEventListener("keydown", onKeydown);
    for (const item of inertSiblings) item.element.inert = item.wasInert;
  });
  watch(dialog, (element, previous) => {
    previous?.removeEventListener("keydown", onKeydown);
    element?.addEventListener("keydown", onKeydown);
  });
}
