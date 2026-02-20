<script setup lang="ts">
import {
  mdiClose,
  mdiContentCopy,
  mdiContentPaste,
  mdiDotsHorizontal,
  mdiDownload,
  mdiInformationOutline,
  mdiLinkVariant,
  mdiOpenInNew
} from "@mdi/js";
import type { MessageAttachment } from "@renderer/types/chat";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  open: boolean;
  attachment: MessageAttachment | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const actionsMenuId = "image-lightbox-actions-menu";
const menuOpen = ref(false);
const detailsOpen = ref(false);
const isCopyingImage = ref(false);
const isSavingImage = ref(false);
const isCheckingClipboard = ref(false);
const canPasteFromClipboard = ref(false);
const menuContextPosition = ref<{ x: number; y: number } | null>(null);
const actionNotice = ref("");
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
const minZoomScale = 1;
const maxZoomScale = 6;
const zoomStep = 0.18;
const zoomScale = ref(minZoomScale);
const imageRef = ref<HTMLImageElement | null>(null);
const imageOffsetX = ref(0);
const imageOffsetY = ref(0);
const isDraggingImage = ref(false);
let dragPointerId: number | null = null;
let dragStartPointerX = 0;
let dragStartPointerY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;

const attachmentUrl = computed(() => props.attachment?.url ?? "");
const attachmentFileName = computed(() => props.attachment?.fileName?.trim() || "image");
const attachmentDimensions = computed(() => {
  if (!props.attachment) return "Unknown";
  if (props.attachment.width <= 0 || props.attachment.height <= 0) return "Unknown";
  return `${props.attachment.width}x${props.attachment.height}`;
});
const attachmentSizeLabel = computed(() => formatBytes(props.attachment?.bytes ?? -1));
const isZoomActive = computed(() => zoomScale.value > minZoomScale + 0.001);
const actionsMenuStyle = computed(() => {
  if (!menuContextPosition.value) {
    return undefined;
  }
  return {
    position: "fixed" as const,
    left: `${menuContextPosition.value.x}px`,
    top: `${menuContextPosition.value.y}px`,
    right: "auto"
  };
});
const imageZoomStyle = computed(() => {
  return {
    transform: `translate3d(${imageOffsetX.value}px, ${imageOffsetY.value}px, 0) scale(${zoomScale.value})`
  };
});

function clearNoticeTimer(): void {
  if (noticeTimer === null) return;
  clearTimeout(noticeTimer);
  noticeTimer = null;
}

function setActionNotice(message: string): void {
  clearNoticeTimer();
  actionNotice.value = message;
  noticeTimer = setTimeout(() => {
    actionNotice.value = "";
    noticeTimer = null;
  }, 2400);
}

function resetLightboxMenus(): void {
  menuOpen.value = false;
  detailsOpen.value = false;
  menuContextPosition.value = null;
  canPasteFromClipboard.value = false;
  isCheckingClipboard.value = false;
}

function closeLightbox(): void {
  resetLightboxMenus();
  resetZoom();
  emit("close");
}

function toggleActionsMenu(): void {
  if (menuOpen.value) {
    resetLightboxMenus();
    return;
  }
  menuContextPosition.value = null;
  menuOpen.value = true;
  detailsOpen.value = false;
  void refreshClipboardPasteAvailability();
}

function openContextActionsMenu(event: MouseEvent): void {
  if (!props.open || !props.attachment) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest(".image-lightbox-menu")) return;
  if (target?.closest(".image-lightbox-details")) return;
  const menuWidth = 250;
  const menuHeight = 224;
  const boundedX = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
  const boundedY = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
  menuContextPosition.value = {
    x: boundedX,
    y: boundedY
  };
  menuOpen.value = true;
  detailsOpen.value = false;
  void refreshClipboardPasteAvailability();
}

async function refreshClipboardPasteAvailability(): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard || !menuOpen.value) {
    canPasteFromClipboard.value = false;
    return;
  }
  isCheckingClipboard.value = true;
  try {
    if (clipboard.read) {
      try {
        const items = await clipboard.read();
        const hasImage = items.some((item) => item.types.some((type) => type.toLowerCase().startsWith("image/")));
        if (hasImage) {
          canPasteFromClipboard.value = true;
          return;
        }
      } catch (_error) {
        // Continue to text-based checks when image reads are blocked.
      }
    }
    if (!clipboard.readText) {
      canPasteFromClipboard.value = false;
      return;
    }
    const text = (await clipboard.readText()).trim();
    canPasteFromClipboard.value = text.length > 0;
  } catch (_error) {
    canPasteFromClipboard.value = false;
  } finally {
    isCheckingClipboard.value = false;
  }
}

function normalizeClipboardURL(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

async function pasteFromClipboard(): Promise<void> {
  if (!menuOpen.value || isCheckingClipboard.value) return;
  const clipboard = navigator.clipboard;
  if (!clipboard) {
    setActionNotice("Clipboard access is unavailable.");
    return;
  }
  try {
    if (clipboard.read) {
      try {
        const items = await clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.toLowerCase().startsWith("image/"));
          if (!imageType) continue;
          const blob = await item.getType(imageType);
          const objectURL = URL.createObjectURL(blob);
          window.open(objectURL, "_blank", "noopener,noreferrer");
          setTimeout(() => {
            URL.revokeObjectURL(objectURL);
          }, 15000);
          setActionNotice("Opened image from clipboard.");
          resetLightboxMenus();
          return;
        }
      } catch (_error) {
        // Continue to text paste if image clipboard reads are blocked.
      }
    }
    const text = clipboard.readText ? (await clipboard.readText()).trim() : "";
    const clipboardURL = normalizeClipboardURL(text);
    if (!clipboardURL) {
      setActionNotice("Clipboard does not contain an image or URL.");
      resetLightboxMenus();
      return;
    }
    window.open(clipboardURL, "_blank", "noopener,noreferrer");
    setActionNotice("Opened URL from clipboard.");
    resetLightboxMenus();
  } catch (_error) {
    setActionNotice("Could not paste from clipboard.");
  }
}

function toggleDetails(): void {
  detailsOpen.value = !detailsOpen.value;
}

async function tryCopyText(value: string): Promise<boolean> {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    await navigator.clipboard.writeText(trimmed);
    return true;
  } catch (_error) {
    const input = document.createElement("textarea");
    input.value = trimmed;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

async function copyImageLink(): Promise<void> {
  if (!attachmentUrl.value) return;
  const copied = await tryCopyText(attachmentUrl.value);
  if (copied) {
    setActionNotice("Image link copied.");
  } else {
    setActionNotice("Could not copy link.");
  }
  resetLightboxMenus();
}

async function copyImageData(): Promise<void> {
  const attachment = props.attachment;
  if (!attachment || isCopyingImage.value) return;

  isCopyingImage.value = true;
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Clipboard image write is unavailable.");
    }

    const response = await fetch(attachment.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.type.toLowerCase().startsWith("image/")) {
      throw new Error("Attachment is not an image.");
    }

    await clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    setActionNotice("Image copied.");
    resetLightboxMenus();
  } catch (_error) {
    setActionNotice("Could not copy image.");
  } finally {
    isCopyingImage.value = false;
  }
}

function downloadImage(): void {
  const attachment = props.attachment;
  if (!attachment || isSavingImage.value) return;

  const savePicker = (
    window as Window & {
      showSaveFilePicker?: (options?: {
        suggestedName?: string;
        types?: Array<{
          description?: string;
          accept: Record<string, string[]>;
        }>;
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;

  if (!savePicker) {
    const anchor = document.createElement("a");
    anchor.href = attachment.url;
    anchor.download = attachmentFileName.value;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setActionNotice("Save picker unavailable. Used browser download.");
    resetLightboxMenus();
    return;
  }

  void (async () => {
    isSavingImage.value = true;
    try {
      const response = await fetch(attachment.url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }
      const blob = await response.blob();
      const mimeType = blob.type || attachment.contentType || "image/*";
      const picker = await savePicker({
        suggestedName: attachmentFileName.value,
        types: [
          {
            description: "Image files",
            accept: {
              [mimeType]: [fileNameExtension(attachmentFileName.value)]
            }
          }
        ]
      });
      const writable = await picker.createWritable();
      await writable.write(blob);
      await writable.close();
      setActionNotice("Image saved.");
      resetLightboxMenus();
    } catch (error) {
      const domExceptionName = error instanceof DOMException ? error.name : "";
      if (domExceptionName === "AbortError") {
        return;
      }
      setActionNotice("Could not save image.");
    } finally {
      isSavingImage.value = false;
    }
  })();
}

function openImageInBrowser(): void {
  if (!attachmentUrl.value) return;
  window.open(attachmentUrl.value, "_blank", "noopener,noreferrer");
  resetLightboxMenus();
}

function clampZoomScale(value: number): number {
  const clamped = Math.max(minZoomScale, Math.min(maxZoomScale, value));
  return Math.round(clamped * 1000) / 1000;
}

function getMaxOffsets(): { x: number; y: number } {
  const image = imageRef.value;
  if (!image) {
    return { x: 0, y: 0 };
  }
  const baseWidth = image.offsetWidth;
  const baseHeight = image.offsetHeight;
  const x = Math.max(0, (baseWidth * zoomScale.value - baseWidth) / 2);
  const y = Math.max(0, (baseHeight * zoomScale.value - baseHeight) / 2);
  return { x, y };
}

function clampOffsetValue(value: number, axis: "x" | "y"): number {
  const maxOffsets = getMaxOffsets();
  const max = axis === "x" ? maxOffsets.x : maxOffsets.y;
  return Math.max(-max, Math.min(max, value));
}

function setImageOffsets(nextX: number, nextY: number): void {
  imageOffsetX.value = clampOffsetValue(nextX, "x");
  imageOffsetY.value = clampOffsetValue(nextY, "y");
}

function stopImageDrag(): void {
  isDraggingImage.value = false;
  dragPointerId = null;
}

function resetZoom(): void {
  zoomScale.value = minZoomScale;
  imageOffsetX.value = 0;
  imageOffsetY.value = 0;
  stopImageDrag();
}

function onImageWheel(event: WheelEvent): void {
  if (!props.open) return;
  event.preventDefault();
  if (event.deltaY === 0) return;

  const direction = event.deltaY < 0 ? 1 : -1;
  const next = clampZoomScale(zoomScale.value + direction * zoomStep);
  zoomScale.value = next;
  if (next <= minZoomScale + 0.001) {
    imageOffsetX.value = 0;
    imageOffsetY.value = 0;
    stopImageDrag();
    return;
  }
  setImageOffsets(imageOffsetX.value, imageOffsetY.value);
}

function onImagePointerDown(event: PointerEvent): void {
  if (!isZoomActive.value) return;
  if (event.button !== 0) return;
  event.preventDefault();
  dragPointerId = event.pointerId;
  dragStartPointerX = event.clientX;
  dragStartPointerY = event.clientY;
  dragStartOffsetX = imageOffsetX.value;
  dragStartOffsetY = imageOffsetY.value;
  isDraggingImage.value = true;
}

function onWindowPointerMove(event: PointerEvent): void {
  if (!isDraggingImage.value) return;
  if (dragPointerId !== null && event.pointerId !== dragPointerId) return;
  const deltaX = event.clientX - dragStartPointerX;
  const deltaY = event.clientY - dragStartPointerY;
  setImageOffsets(dragStartOffsetX + deltaX, dragStartOffsetY + deltaY);
}

function onWindowPointerUp(event: PointerEvent): void {
  if (!isDraggingImage.value) return;
  if (dragPointerId !== null && event.pointerId !== dragPointerId) return;
  stopImageDrag();
}

function onWindowPointerDown(event: PointerEvent): void {
  if (!props.open) return;
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest(".image-lightbox-actions")) return;
  resetLightboxMenus();
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (!props.open || event.key !== "Escape") return;
  if (detailsOpen.value) {
    detailsOpen.value = false;
    return;
  }
  if (menuOpen.value) {
    menuOpen.value = false;
    return;
  }
  closeLightbox();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const precision = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[index]}`;
}

function fileNameExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) {
    return ".png";
  }
  return fileName.slice(dot);
}

watch(
  () => props.open,
  (open) => {
    if (open) return;
    resetLightboxMenus();
    resetZoom();
    actionNotice.value = "";
    clearNoticeTimer();
  }
);

watch(
  () => props.attachment?.attachmentId ?? "",
  () => {
    resetLightboxMenus();
    resetZoom();
    actionNotice.value = "";
    clearNoticeTimer();
  }
);

onMounted(() => {
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onWindowPointerUp);
  window.addEventListener("keydown", onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  window.removeEventListener("pointercancel", onWindowPointerUp);
  window.removeEventListener("keydown", onWindowKeydown);
  clearNoticeTimer();
});
</script>

<template>
  <div v-if="open && attachment" class="image-lightbox-backdrop" role="presentation" @click.self="closeLightbox">
    <section
      class="image-lightbox-shell"
      role="dialog"
      aria-modal="true"
      :aria-label="`Image preview for ${attachmentFileName}`"
      @contextmenu.prevent="openContextActionsMenu"
    >
      <div class="image-lightbox-actions">
        <div class="image-lightbox-toolbar">
          <button type="button" class="image-lightbox-tool-btn" aria-label="Open image in browser" @click="openImageInBrowser">
            <AppIcon :path="mdiOpenInNew" :size="18" />
          </button>
          <button type="button" class="image-lightbox-tool-btn" aria-label="Download image" @click="downloadImage">
            <AppIcon :path="mdiDownload" :size="18" />
          </button>
          <button
            type="button"
            class="image-lightbox-tool-btn"
            aria-label="Image actions"
            aria-haspopup="menu"
            :aria-expanded="menuOpen ? 'true' : 'false'"
            :aria-controls="actionsMenuId"
            @click.stop="toggleActionsMenu"
          >
            <AppIcon :path="mdiDotsHorizontal" :size="18" />
          </button>
        </div>
        <button
          v-if="isZoomActive"
          type="button"
          class="image-lightbox-reset"
          aria-label="Reset image zoom"
          @click="resetZoom"
        >
          Reset
        </button>
        <button type="button" class="image-lightbox-close" aria-label="Close image preview" @click="closeLightbox">
          <AppIcon :path="mdiClose" :size="24" />
        </button>

        <section
          v-if="menuOpen"
          :id="actionsMenuId"
          class="image-lightbox-menu"
          role="menu"
          aria-label="Image actions"
          :style="actionsMenuStyle"
        >
          <button type="button" class="image-lightbox-menu-item" role="menuitem" :disabled="isCopyingImage" @click="copyImageData">
            <span>{{ isCopyingImage ? "Copying image..." : "Copy Image" }}</span>
            <AppIcon :path="mdiContentCopy" :size="18" />
          </button>
          <button type="button" class="image-lightbox-menu-item" role="menuitem" @click="copyImageLink">
            <span>Copy Link</span>
            <AppIcon :path="mdiLinkVariant" :size="18" />
          </button>
          <button
            type="button"
            class="image-lightbox-menu-item"
            role="menuitem"
            :disabled="isCheckingClipboard || !canPasteFromClipboard"
            @click="pasteFromClipboard"
          >
            <span>{{ isCheckingClipboard ? "Checking clipboard..." : "Paste from Clipboard" }}</span>
            <AppIcon :path="mdiContentPaste" :size="18" />
          </button>
          <button type="button" class="image-lightbox-menu-item" role="menuitem" @click="toggleDetails">
            <span>View Details</span>
            <AppIcon :path="mdiInformationOutline" :size="18" />
          </button>
        </section>

        <aside v-if="detailsOpen" class="image-lightbox-details" aria-label="Image details">
          <p class="image-lightbox-detail-label">Filename</p>
          <p class="image-lightbox-detail-value">{{ attachmentFileName }}</p>
          <p class="image-lightbox-detail-label">Size</p>
          <p class="image-lightbox-detail-value">{{ attachmentDimensions }} ({{ attachmentSizeLabel }})</p>
        </aside>
      </div>

      <div
        class="image-lightbox-media"
        :class="{ 'is-zoom-active': isZoomActive, 'is-dragging': isDraggingImage }"
        @click="closeLightbox"
        @wheel="onImageWheel"
      >
        <img
          ref="imageRef"
          class="image-lightbox-image"
          :class="{ 'is-draggable': isZoomActive }"
          :src="attachment.url"
          :alt="attachmentFileName"
          :style="imageZoomStyle"
          @click.stop
          @pointerdown.stop="onImagePointerDown"
        />
      </div>

      <p v-if="actionNotice" class="image-lightbox-notice" role="status" aria-live="polite">{{ actionNotice }}</p>
    </section>
  </div>
</template>
