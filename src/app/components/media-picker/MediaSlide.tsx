import type { MediaPickerItem } from "./MediaPicker";

export interface MediaSlideProps {
  item: MediaPickerItem;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  onToggle: () => void;
}

export function MediaSlide({ item, index, isActive, isSelected, onToggle }: MediaSlideProps) {
  const number = String(index + 1).padStart(2, "0");
  const label = item.alt?.trim() || `${item.type === "image" ? "Image" : "Video"} ${index + 1}`;

  return (
    <article
      className={`mp-slide ${isActive ? "is-active" : ""}`}
      data-carousel-index={index}
      aria-label={`${item.type === "image" ? "Image" : "Video"} ${number}`}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="mp-media-frame">
        {item.type === "image" ? (
          <img
            className="mp-media"
            src={item.src}
            alt={label}
            loading={isActive ? "eager" : "lazy"}
            draggable={false}
          />
        ) : (
          <video
            className="mp-media"
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
      <span className="mp-media-badge">
        {item.type === "image" ? "IMAGE" : "VIDEO"} {number}
      </span>
      <button
        className={`mp-pick-button ${isSelected ? "is-selected" : ""}`}
        type="button"
        aria-pressed={isSelected}
        aria-label={`${isSelected ? "Deselect" : "Select"} ${label}`}
        onClick={onToggle}
      >
        {isSelected ? (
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
            <path d="m5 12 4.2 4.2L19 6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : <span className="mp-pick-empty" aria-hidden="true" />}
      </button>
    </article>
  );
}
