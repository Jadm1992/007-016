import { useCallback, useId, useRef, useState } from "react";
import { useMediaSelection } from "./hooks/useMediaSelection";
import { MediaCarousel } from "./MediaCarousel";
import { MediaPickerDialog } from "./MediaPickerDialog";
import { MediaPickerFooter } from "./MediaPickerFooter";

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
      const decoded = decodeURIComponent(lastSegment).replace(/[\\/:*?"<>|\p{Cc}]/gu, "_");
      if (decoded && decoded !== "." && decoded !== "..") return decoded;
    }
  } catch {
    // Fall through.
  }
  return `${item.type}-${index + 1}.${item.type === "image" ? "jpg" : "mp4"}`;
}

async function downloadFromUrls(items: readonly MediaPickerItem[]): Promise<void> {
  const files = await Promise.all(
    items.map(async (item, index) => {
      const response = await fetch(item.src);
      if (!response.ok) throw new Error(`Could not download ${defaultFileName(item, index)} (HTTP ${response.status}).`);
      return { name: defaultFileName(item, index), blob: await response.blob() };
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
      setDownloadError(error instanceof Error ? error.message : "The selected media could not be downloaded.");
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, onDownload, selection.selectedItems]);

  return (
    <div>
      {!hideTrigger && (
        <button
          ref={triggerRef}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => setOpen(true)}
        >
          {triggerLabel}
        </button>
      )}

      <MediaPickerDialog open={isOpen} title={title} titleId={titleId} onClose={handleClose}>
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold text-white" id={titleId}>{title}</h2>
            <p className="mt-1 text-xs text-zinc-400">
              {loading
                ? status || "Extracting media…"
                : `${items.length} ${items.length === 1 ? "item" : "items"} · ${imageCount} ${imageCount === 1 ? "image" : "images"} · ${videoCount} ${videoCount === 1 ? "video" : "videos"}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className={`rounded-xl border px-3 py-2 text-xs font-medium disabled:opacity-40 ${selection.allSelected ? "border-transparent bg-gradient-to-br from-violet-500 to-violet-600 text-white" : "border-violet-300/30 bg-black/40 text-violet-200"}`}
              type="button"
              aria-pressed={selection.allSelected}
              onClick={selection.toggleAll}
              disabled={items.length === 0 || loading}
            >
              {selection.allSelected ? "Deselect all" : "Select all"}
            </button>
            <button
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-zinc-300"
              type="button"
              data-dialog-close="true"
              aria-label="Close media picker"
              onClick={() => setOpen(false)}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <section className="min-h-0 px-6 pt-4" aria-label="Media selection">
          <MediaCarousel
            items={items}
            selectedIds={selection.selectedIds}
            onToggleSelection={selection.toggle}
            loading={loading}
          />
          <p className="mt-3 text-center text-xs text-zinc-500">
            {loading ? "Loading media…" : "Drag or swipe horizontally to browse"}
          </p>
          {downloadError && <p className="mt-3 text-xs text-red-300" role="alert">{downloadError}</p>}
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
