import type { KeyboardEvent } from "react";
import type { MediaPickerItem } from "./MediaPicker";
import { MediaSlide } from "./MediaSlide";
import { useDragCarousel } from "./hooks/useDragCarousel";

export interface MediaCarouselProps {
  items: readonly MediaPickerItem[];
  selectedIds: ReadonlySet<string>;
  onToggleSelection: (id: string) => void;
}

export function MediaCarousel({ items, selectedIds, onToggleSelection }: MediaCarouselProps) {
  const carousel = useDragCarousel(items.length);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      carousel.goTo(carousel.activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      carousel.goTo(carousel.activeIndex - 1);
    } else if ((event.key === " " || event.key === "Enter") && event.target === event.currentTarget) {
      event.preventDefault();
      const item = items[carousel.activeIndex];
      if (item) onToggleSelection(item.id);
    }
  };

  return (
    <div
      ref={carousel.viewportRef}
      className={`mp-viewport ${carousel.isDragging ? "is-dragging" : ""}`}
      role="region"
      aria-label="Media carousel. Drag horizontally or use the left and right arrow keys."
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={carousel.onPointerDown}
      onPointerMove={carousel.onPointerMove}
      onPointerUp={carousel.onPointerUp}
      onPointerCancel={carousel.onPointerUp}
      onLostPointerCapture={carousel.onLostPointerCapture}
    >
      {items.length === 0 ? (
        <div className="mp-empty-state" role="status">No media available.</div>
      ) : (
        <div
          ref={carousel.trackRef}
          className={`mp-track ${carousel.isDragging ? "is-dragging" : ""}`}
          style={{ transform: `translate3d(${carousel.translateX}px, 0, 0)` }}
        >
          {items.map((item, index) => (
            <MediaSlide
              key={item.id}
              item={item}
              index={index}
              isActive={index === carousel.activeIndex}
              isSelected={selectedIds.has(item.id)}
              onToggle={() => onToggleSelection(item.id)}
            />
          ))}
        </div>
      )}
      {items.length > 1 && (
        <div className="mp-pagination" aria-hidden="true">
          {items.map((item, index) => (
            <span key={item.id} className={`mp-pagination-dot ${index === carousel.activeIndex ? "is-active" : ""}`} />
          ))}
        </div>
      )}
    </div>
  );
}
