import { useCallback, useRef, useState } from 'react'

/**
 * Border-box height of an element, kept current as it resizes.
 *
 * A callback ref rather than `useRef` + `useEffect`: the measured node comes
 * and goes with the render — a totals row only exists once rows have arrived —
 * and the callback fires on both mount and unmount, so there is no stale
 * observer left behind and no height held over from a table that is gone.
 */
export function useElementHeight<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [height, setHeight] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect()
    if (!node) {
      setHeight(0)
      return
    }
    setHeight(node.getBoundingClientRect().height)
    observer.current = new ResizeObserver(([entry]) => {
      // Border box, not content box: the totals row draws a border on top.
      setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
    })
    observer.current.observe(node)
  }, [])

  return [ref, height]
}
