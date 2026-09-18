import { nextTick, type Ref } from "vue";

/** Shared arrow-key and focus-return behavior for in-app popup menus. */
export function useMenuKeyboard(menu: Ref<HTMLElement | null>, close: () => void) {
  let opener: HTMLElement | null = null;
  const items = () => [...(menu.value?.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])") ?? [])]
    .filter((item) => item.getClientRects().length > 0);

  async function openedBy(trigger: HTMLElement | null): Promise<void> {
    opener = trigger;
    await nextTick();
    items()[0]?.focus();
  }

  function closeAndReturn(): void {
    close();
    const target = opener;
    opener = null;
    void nextTick(() => { if (target?.isConnected) target.focus(); });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndReturn();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = items();
    if (!options.length) return;
    event.preventDefault();
    const index = options.findIndex((item) => item === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : event.key === "ArrowDown" ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
    options[next].focus();
  }

  return { openedBy, closeAndReturn, onKeydown };
}
