export interface MediaPickerFooterProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  disabled?: boolean;
  onToggleAll: () => void;
  onDownload: () => void | Promise<void>;
}

export function MediaPickerFooter({
  selectedCount,
  totalCount,
  allSelected,
  disabled = false,
  onToggleAll,
  onDownload,
}: MediaPickerFooterProps) {
  return (
    <footer className="mt-5 flex flex-col gap-3 border-t border-white/10 bg-black/10 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center justify-between gap-3">
        <button
          className="rounded-xl border border-[#30304a] bg-[#1b1c2b] px-3.5 py-2.5 text-sm font-medium text-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          onClick={onToggleAll}
          disabled={totalCount === 0 || disabled}
        >
          {allSelected ? "Deselect all media" : "Select all media"}
        </button>
        <p className="whitespace-nowrap text-xs text-zinc-400" aria-live="polite">
          Selected <strong className="font-bold text-violet-300">{selectedCount}</strong> of {totalCount}
        </p>
      </div>
      <button
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 px-5 text-sm font-semibold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-56"
        type="button"
        disabled={selectedCount === 0 || disabled}
        onClick={() => void onDownload()}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v3h16v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          {disabled ? "Preparing download…" : selectedCount ? `Download ${selectedCount} selected` : "Download selected"}
        </span>
      </button>
    </footer>
  );
}
