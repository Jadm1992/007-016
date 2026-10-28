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
    } else if ((event.key === " " || event.key === "Enter") && event.target === event.currentTarget && !loading) {
      event.preventDefault();
      const item = items[carousel.activeIndex];
      if (item) onToggleSelection(item.id);
    }
  };

  return (
    <section
      ref={carousel.viewportRef}
      className={`relative overflow-hidden rounded-2xl touch-pan-x select-none ${carousel.isDragging ? "cursor-grabbing" : "cursor-grab"}`}
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
          className={`flex w-max min-w-full items-center gap-4 ${carousel.isDragging ? "" : "transition-transform duration-300"}`}
          style={{ transform: `translate3d(${carousel.translateX}px, 0, 0)` }}
        >
          {SKELETONS.map((id, index) => (
            <article
              key={id}
              className={`shrink-0 w-[75vw] max-w-[280px] sm:w-[280px] aspect-[1.55/1] overflow-hidden rounded-2xl border ${index === carousel.activeIndex ? "border-violet-400/70" : "border-white/10 opacity-40"}`}
              data-carousel-index={index}
              aria-hidden="true"
            >
              <div className="h-full w-full animate-pulse bg-zinc-800" />
            </article>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-violet-300/20 p-6 text-sm text-zinc-400" role="status">
          No media available.
        </div>
      ) : (
        <div
          ref={carousel.trackRef}
          className={`flex w-max min-w-full items-center gap-4 ${carousel.isDragging ? "" : "transition-transform duration-300"}`}
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
        <div className="mt-4 flex items-center justify-center gap-2" aria-hidden="true">
          {items.map((item, index) => (
            <span
              key={item.id}
              className={`h-1.5 rounded-full transition-all ${index === carousel.activeIndex ? "w-5 bg-violet-400" : "w-1.5 bg-zinc-600"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
