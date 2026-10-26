import type { KeyboardEvent } from "react";
import { useDragCarousel } from "./hooks/useDragCarousel";
import type { MediaPickerItem } from "./MediaPicker";
import { MediaSlide } from "./MediaSlide";

export interface MediaCarouselProps {
  items: readonly MediaPickerItem[];
  selectedIds: ReadonlySet<string>;
  onToggleSelection: (id: string) => void;
  loading?: boolean;
}

const SKELETONS = [0, 1, 2];

export function MediaCarousel({
  items,
  selectedIds,
  onToggleSelection,
  loading = false,
}: MediaCarouselProps) {
  const count = loading ? SKELETONS.length : items.length;
  const carousel = useDragCarousel(count);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      carousel.goTo(carousel.activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      carousel.goTo(carousel.activeIndex - 1);
    } else if (
      (event.key === " " || event.key === "Enter") &&
      event.target === event.currentTarget &&
      !loading
    ) {
      event.preventDefault();
      const item = items[carousel.activeIndex];
      if (item) onToggleSelection(item.id);
    }
  };

  return (
    <section
      ref={carousel.viewportRef}
      className={`mp-viewport ${carousel.isDragging ? "is-dragging" : ""}`}
      aria-label="Media carousel. Drag horizontally or use the left and right arrow keys."
      aria-busy={loading || undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={carousel.onPointerDown}
      onPointerMove={carousel.onPointerMove}
      onPointerUp={carousel.onPointerUp}
      onPointerCancel={carousel.onPointerUp}
      onLostPointerCapture={carousel.onLostPointerCapture}
    >
      {loading ? (
        <div
          ref={carousel.trackRef}
          className={`mp-track ${carousel.isDragging ? "is-dragging" : ""}`}
          style={{ transform: `translate3d(${carousel.translateX}px, 0, 0)` }}
        >
          {SKELETONS.map((id, index) => (
            <article
              key={id}
              className={`mp-slide ${index === carousel.activeIndex ? "is-active" : ""}`}
              data-carousel-index={index}
              aria-hidden="true"
            >
              <div className="skeleton h-full w-full" />
            </article>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mp-empty-state" role="status">
          No media available.
        </div>
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
      {!loading && items.length > 1 && (
        <div className="mp-pagination" aria-hidden="true">
          {items.map((item, index) => (
            <span
              key={item.id}
              className={`mp-pagination-dot ${index === carousel.activeIndex ? "is-active" : ""}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
