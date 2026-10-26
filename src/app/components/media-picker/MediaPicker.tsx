import { useCallback, useId, useRef, useState } from "react";
import { useMediaSelection } from "./hooks/useMediaSelection";
import { MediaCarousel } from "./MediaCarousel";
import { MediaPickerDialog } from "./MediaPickerDialog";
import { MediaPickerFooter } from "./MediaPickerFooter";
import "./media-picker.css";

export interface MediaPickerItem {
  /** Stable key used for selection. */
  id: string;
  type: "image" | "video";
  /** URL of the original image or video. */
  src: string;
  /** Optional video poster or lower-resolution image preview. */
  thumbnail?: string;
  alt?: string;
  /** Optional filename used when the built-in download handler is used. */
  fileName?: string;
}

export interface MediaPickerProps {
  /** Real media URLs to display. An empty array renders an empty state, not placeholder media. */
  items: readonly MediaPickerItem[];
  title?: string;
  triggerLabel?: string;
  /** Supply `open` to control the dialog externally. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectionChange?: (selectedItems: readonly MediaPickerItem[]) => void;
  /** Override the built-in URL download behavior (for example, to create a ZIP). */
  onDownload?: (
    selectedItems: readonly MediaPickerItem[],
  ) => void | Promise<void>;
}

function defaultFileName(item: MediaPickerItem, index: number): string {
  if (item.fileName?.trim()) return item.fileName.trim();

  try {
    const pathname = new URL(item.src, window.location.href).pathname;
    const lastSegment = pathname.split("/").filter(Boolean).at(-1);
    if (lastSegment) {
      const decoded = decodeURIComponent(lastSegment).replace(
        /[\\/:*?"<>|\p{Cc}]/gu,
        "_",
      );
      if (decoded && decoded !== "." && decoded !== "..") return decoded;
    }
  } catch {
    // Fall through to a type-based filename when the URL cannot be parsed.
  }

  return `${item.type}-${index + 1}.${item.type === "image" ? "jpg" : "mp4"}`;
}

async function downloadFromUrls(
  items: readonly MediaPickerItem[],
): Promise<void> {
  // Fetch to blobs so cross-origin URLs without download support do not navigate away from the page.
  const files = await Promise.all(
    items.map(async (item, index) => {
      const response = await fetch(item.src);
      if (!response.ok) {
        throw new Error(
          `Could not download ${defaultFileName(item, index)} (HTTP ${response.status}).`,
        );
      }
      return {
        name: defaultFileName(item, index),
        blob: await response.blob(),
      };
    }),
  );

  for (const file of files) {
    const objectUrl = URL.createObjectURL(file.blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

export function MediaPicker({
  items,
  title = "Choose your media",
  triggerLabel = "Browse media",
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  onSelectionChange,
  onDownload,
}: MediaPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const isControlled = controlledOpen !== undefined;
  const isOpen = controlledOpen ?? internalOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
      if (!nextOpen) triggerRef.current?.focus({ preventScroll: true });
    },
    [isControlled, onOpenChange],
  );

  const handleClose = useCallback(() => setOpen(false), [setOpen]);
  const selection = useMediaSelection(items, onSelectionChange);
  const imageCount = items.filter((item) => item.type === "image").length;
  const videoCount = items.length - imageCount;

  const handleDownload = useCallback(async () => {
    if (selection.selectedItems.length === 0 || isDownloading) return;

    setIsDownloading(true);
    setDownloadError(null);
    try {
      if (onDownload) await onDownload(selection.selectedItems);
      else await downloadFromUrls(selection.selectedItems);
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "The selected media could not be downloaded. Check the media URLs or provide an onDownload handler.",
      );
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, onDownload, selection.selectedItems]);

  return (
    <div className="mp-root">
      <button
        ref={triggerRef}
        className="mp-trigger inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        {triggerLabel}
      </button>

      <MediaPickerDialog
        open={isOpen}
        title={title}
        titleId={titleId}
        onClose={handleClose}
      >
        <header className="mp-header">
          <div className="mp-heading-group">
            <div className="mp-heading-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="3.5"
                  y="4"
                  width="17"
                  height="16"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <circle cx="8.5" cy="9" r="1.5" fill="currentColor" />
                <path
                  d="m5 17 4.6-4.5 3 2.6 2.5-2.2 4 4.1"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="mp-heading-copy">
              <h2 className="mp-title" id={titleId}>
                {title}
              </h2>
              <p className="mp-subtitle">
                {items.length} {items.length === 1 ? "item" : "items"}
                <span aria-hidden="true"> · </span>
                {imageCount} {imageCount === 1 ? "image" : "images"}
                <span aria-hidden="true"> · </span>
                {videoCount} {videoCount === 1 ? "video" : "videos"}
              </p>
            </div>
          </div>
          <div className="mp-header-actions">
            <button
              className={`mp-select-all-top ${selection.allSelected ? "is-selected" : ""}`}
              type="button"
              aria-pressed={selection.allSelected}
              onClick={selection.toggleAll}
              disabled={items.length === 0}
            >
              <span aria-hidden="true">{selection.allSelected ? "✓" : ""}</span>
              {selection.allSelected ? "Deselect all" : "Select all"}
            </button>
            <button
              className="mp-close"
              type="button"
              data-dialog-close="true"
              aria-label="Close media picker"
              onClick={() => setOpen(false)}
            >
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m6 6 12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <section className="mp-content" aria-label="Media selection">
          <MediaCarousel
            items={items}
            selectedIds={selection.selectedIds}
            onToggleSelection={selection.toggle}
          />
          <p className="mp-swipe-hint">
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 12V5.8a1.5 1.5 0 0 1 3 0V11 4.8a1.5 1.5 0 0 1 3 0V11 6.8a1.5 1.5 0 0 1 3 0v7.5l1.1-1.3a1.7 1.7 0 0 1 2.7 2.1l-3.5 5a3 3 0 0 1-2.5 1.3h-3.2a4 4 0 0 1-3.3-1.7L5.7 16a1.7 1.7 0 0 1 2.3-2.4L10 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Drag or swipe horizontally to browse
          </p>
          {downloadError && (
            <p className="mp-error" role="alert">
              {downloadError}
            </p>
          )}
        </section>

        <MediaPickerFooter
          selectedCount={selection.selectedItems.length}
          totalCount={items.length}
          allSelected={selection.allSelected}
          disabled={isDownloading}
          onToggleAll={selection.toggleAll}
          onDownload={handleDownload}
        />
      </MediaPickerDialog>
    </div>
  );
}

export default MediaPicker;
