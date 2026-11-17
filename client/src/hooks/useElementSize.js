import { useLayoutEffect, useRef, useState } from 'react';

const ZERO = { width: 0, height: 0 };

/**
 * Live size of an element, for components that size their CONTENT from their
 * container (the board, the timeline).
 *
 * Measured synchronously on mount (useLayoutEffect), so the first paint
 * already has a size — a board that appears one frame late visibly flickers —
 * then tracked with a ResizeObserver. Values are floored and an unchanged size
 * keeps the previous object, so sub-pixel jitter never re-renders.
 *
 * The element must get its size from its PARENT (flex/grid slot), not from
 * the content sized from this measurement, or the two would feed each other.
 *
 * @returns {[React.MutableRefObject<HTMLElement|null>, {width:number, height:number}]}
 */
export function useElementSize() {
  // ── Refs / State ──
  const ref = useRef(null);
  const [size, setSize] = useState(ZERO);

  // ── Effects ──
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;   // jsdom (tests)
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

export default useElementSize;