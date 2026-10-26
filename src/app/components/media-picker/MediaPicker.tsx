import { useCallback, useId, useRef, useState } from "react";
import { useMediaSelection } from "./hooks/useMediaSelection";
import { MediaCarousel } from "./MediaCarousel";
import { MediaPickerDialog } from "./MediaPickerDialog";
import { MediaPickerFooter } from "./MediaPickerFooter";
import "./media-picker.css";

export interface MediaPickerItem {
  id: string;
  type: "image" | "video";
  src: string;
  thumbnail?: string;
  alt?: string;
  fileName?: string;
}

export interface MediaPickerProps {
  items: readonly MediaPickerItem[];
  title?: string;
  triggerLabel?: string;
  open?: boolean;
  defaultOpen?: boolean;
  loading?: boolean;
  status?: string;
  hideTrigger?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectionChange?: (selectedItems: readonly MediaPickerItem[]) => void;
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
  loading = false,
  status,
  hideTrigger = false,
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
      {!hideTrigger && (
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
      )}

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
                {loading
                  ? status || "Extracting media…"
                  : `${items.length} ${items.length === 1 ? "item" : "items"} · ${imageCount} ${imageCount === 1 ? "image" : "images"} · ${videoCount} ${videoCount === 1 ? "video" : "videos"}`}
              </p>
            </div>
          </div>
          <div className="mp-header-actions">
            <button
              className={`mp-select-all-top ${selection.allSelected ? "is-selected" : ""}`}
              type="button"
              aria-pressed={selection.allSelected}
              onClick={selection.toggleAll}
              disabled={items.length === 0 || loading}
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
            loading={loading}
          />
          <p className="mp-swipe-hint">
            {loading
              ? "Loading media…"
              : "Drag or swipe horizontally to browse"}
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
          disabled={isDownloading || loading}
          onToggleAll={selection.toggleAll}
          onDownload={handleDownload}
        />
      </MediaPickerDialog>
    </div>
  );
}

export default MediaPicker;
