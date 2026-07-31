import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Height of the element in `targetRef`, re-measured after every commit and
 * whenever the element in `containerRef` resizes.
 *
 * Both triggers are needed, and neither is the obvious one. ResizeObserver
 * reports nothing at all for `<thead>` and `<tfoot>` — table sections are not
 * laid out as ordinary boxes — so the row cannot watch itself; what changes its
 * height is the width it is handed, which is the scroll container. Commits
 * cover the rest: new columns or a totals row appearing change the row without
 * the container moving at all.
 *
 * Used to keep the scrollbars off the sticky header and totals row, which is
 * why the value has to follow a header wrapping onto a second line rather than
 * being assumed once.
 */
export function useMeasuredHeight(
  targetRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>,
): number {
  const [height, setHeight] = useState(0)

  const measure = useCallback(() => {
    // 0 when the element is not rendered — no totals row in the parameters
    // archive, and the scrollbar there runs all the way to the bottom.
    setHeight(targetRef.current?.getBoundingClientRect().height ?? 0)
  }, [targetRef])

  useLayoutEffect(measure)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, measure])

  return height
}

/**
 * Width of the element in `ref`, followed through resizes.
 *
 * For deciding how many things fit across it — an axis cannot know how many
 * labels it has room for from the number of data points alone.
 */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [ref])

  return width
}

/** Convenience for the common shape: a scroll container with a sticky header
 *  and, optionally, a sticky totals row. */
export function useStickyRowHeights() {
  const containerRef = useRef<HTMLDivElement>(null)
  const theadRef = useRef<HTMLTableSectionElement>(null)
  const tfootRef = useRef<HTMLTableSectionElement>(null)
  return {
    containerRef,
    theadRef,
    tfootRef,
    theadHeight: useMeasuredHeight(theadRef, containerRef),
    tfootHeight: useMeasuredHeight(tfootRef, containerRef),
  }
}
