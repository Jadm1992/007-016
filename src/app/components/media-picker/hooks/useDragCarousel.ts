import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export interface DragCarouselState {
  viewportRef: RefObject<HTMLDivElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  activeIndex: number;
  translateX: number;
  isDragging: boolean;
  goTo: (index: number) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: () => void;
}

export function useDragCarousel(itemCount: number): DragCarouselState {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTranslateRef = useRef(0);

  const measureOffset = useCallback((index: number) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const slide = track?.querySelector<HTMLElement>(`[data-carousel-index="${index}"]`);
    if (!viewport || !track || !slide) return 0;
    return viewport.clientWidth / 2 - (slide.offsetLeft + slide.offsetWidth / 2);
  }, []);

  const goTo = useCallback((index: number) => {
    setActiveIndex(Math.max(0, Math.min(Math.max(0, itemCount - 1), index)));
  }, [itemCount]);

  useLayoutEffect(() => {
    if (!draggingRef.current) setTranslateX(measureOffset(activeIndex));
  }, [activeIndex, itemCount, measureOffset]);

  useEffect(() => {
    const reposition = () => {
      if (!draggingRef.current) setTranslateX(measureOffset(activeIndex));
    };
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [activeIndex, measureOffset]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, video, audio, a, select, textarea")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    draggingRef.current = true;
    movedRef.current = false;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    startTranslateRef.current = translateX;
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [translateX]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const deltaX = event.clientX - startXRef.current;
    const deltaY = event.clientY - startYRef.current;
    if (Math.abs(deltaX) > 5 && Math.abs(deltaX) > Math.abs(deltaY) * 0.8) movedRef.current = true;
    if (movedRef.current) setTranslateX(startTranslateRef.current + deltaX);
  }, []);

  const finishDrag = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);

    const deltaX = event ? event.clientX - startXRef.current : 0;
    if (!movedRef.current) {
      setTranslateX(measureOffset(activeIndex));
      return;
    }

    const track = trackRef.current;
    const firstSlide = track?.querySelector<HTMLElement>("[data-carousel-index='0']");
    const trackStyles = track ? getComputedStyle(track) : null;
    const stride = firstSlide && trackStyles
      ? firstSlide.getBoundingClientRect().width + (Number.parseFloat(trackStyles.columnGap || trackStyles.gap) || 0)
      : 1;
    const steps = Math.max(1, Math.round(Math.abs(deltaX) / Math.max(stride, 1)));
    if (Math.abs(deltaX) >= 36) {
      setActiveIndex((current) => Math.max(0, Math.min(Math.max(0, itemCount - 1), current + (deltaX < 0 ? steps : -steps))));
    } else {
      setTranslateX(measureOffset(activeIndex));
    }
    movedRef.current = false;
  }, [activeIndex, itemCount, measureOffset]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => finishDrag(event), [finishDrag]);
  const onLostPointerCapture = useCallback(() => finishDrag(), [finishDrag]);

  return {
    viewportRef,
    trackRef,
    activeIndex,
    translateX,
    isDragging,
    goTo,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onLostPointerCapture,
  };
}
