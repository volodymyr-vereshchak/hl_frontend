/**
 * Clipboard access that also works on the station network.
 *
 * `navigator.clipboard` exists only in a secure context, and HLViewer is served
 * over plain HTTP on an internal address — so on the real deployment the modern
 * API is simply absent. Mantine's `useClipboard` has no fallback for that: it
 * parks the failure in an `error` state nobody renders, and the copy button
 * does nothing at all. Hence the deprecated `execCommand` path below, which is
 * the only thing that still copies outside a secure context.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied, or a document that is not focused — the legacy path
    // is bound to the user gesture instead and often still goes through.
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  // Off-screen, but still rendered and selectable: `display: none` or
  // `visibility: hidden` leaves the selection empty and the copy a no-op.
  // `position: fixed` at the current scroll offset keeps the page from jumping.
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  try {
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

export interface CopyToClipboard {
  /** True for `timeout` ms after a copy that actually landed. */
  copied: boolean
  copy: (text: string) => Promise<boolean>
}

/** Drop-in for Mantine's `useClipboard`, minus the silent failure. */
export function useCopyToClipboard({ timeout = 1500 } = {}): CopyToClipboard {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text)
      window.clearTimeout(timer.current ?? undefined)
      setCopied(ok)
      if (ok) timer.current = window.setTimeout(() => setCopied(false), timeout)
      return ok
    },
    [timeout],
  )

  return { copied, copy }
}
