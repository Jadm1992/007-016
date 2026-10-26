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
    <footer className="mp-footer">
      <div className="mp-footer-summary">
        <button className="mp-secondary-button" type="button" onClick={onToggleAll} disabled={totalCount === 0 || disabled}>
          {allSelected ? "Deselect all media" : "Select all media"}
        </button>
        <p className="mp-selected-summary" aria-live="polite">
          Selected <strong>{selectedCount}</strong> of {totalCount}
        </p>
      </div>
      <button
        className="mp-download-button"
        type="button"
        disabled={selectedCount === 0 || disabled}
        onClick={() => void onDownload()}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v3h16v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{disabled ? "Preparing download…" : selectedCount ? `Download ${selectedCount} selected` : "Download selected"}</span>
      </button>
    </footer>
  );
}
