import type { MediaPickerItem } from "./MediaPicker";

export interface MediaSlideProps {
  item: MediaPickerItem;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  onToggle: () => void;
}

export function MediaSlide({
  item,
  index,
  isActive,
  isSelected,
  onToggle,
}: MediaSlideProps) {
  const number = String(index + 1).padStart(2, "0");
  const label =
    item.alt?.trim() ||
    `${item.type === "image" ? "Image" : "Video"} ${index + 1}`;

  return (
    <article
      className={`relative shrink-0 w-[min(76vw,610px)] aspect-[1.55/1] overflow-hidden rounded-2xl border bg-[#171929] transition ${isActive ? "border-violet-400/70 opacity-100 shadow-xl" : "border-white/10 opacity-40 saturate-50"}`}
      data-carousel-index={index}
      aria-label={`${item.type === "image" ? "Image" : "Video"} ${number}`}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="absolute inset-0 overflow-hidden bg-[#111320]">
        {item.type === "image" ? (
          <img
            className="block h-full w-full object-contain"
            src={item.src}
            alt={label}
            loading={isActive ? "eager" : "lazy"}
            draggable={false}
          />
        ) : (
          <video
            className="block h-full w-full object-contain"
            src={item.src}
            poster={item.thumbnail}
            aria-label={label}
            controls
            playsInline
            preload="metadata"
            draggable={false}
          />
        )}
      </div>
      <span className="absolute left-3 top-3 max-w-[calc(100%-4.5rem)] truncate rounded-lg border border-violet-200/10 bg-black/70 px-2 py-1 text-[10px] font-semibold tracking-wider text-violet-50 backdrop-blur">
        {item.type === "image" ? "IMAGE" : "VIDEO"} {number}
      </span>
      <button
        className={`absolute right-2.5 top-2.5 z-10 grid h-9 w-9 place-items-center rounded-xl border backdrop-blur transition ${isSelected ? "border-transparent bg-gradient-to-br from-violet-500 to-violet-600 text-white" : "border-violet-300/40 bg-black/70 text-white"}`}
        type="button"
        aria-pressed={isSelected}
        aria-label={`${isSelected ? "Deselect" : "Select"} ${label}`}
        onClick={onToggle}
      >
        {isSelected ? (
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
            <path d="m5 12 4.2 4.2L19 6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="h-3.5 w-3.5 rounded border border-white/80" aria-hidden="true" />
        )}
      </button>
    </article>
  );
}
