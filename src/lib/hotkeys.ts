/**
 * Keyboard shortcuts, matched by hand rather than through Mantine's
 * `useHotkeys`.
 *
 * Two reasons for the hand-rolled matcher:
 *
 * 1. **Layout.** The people using this app type Ukrainian and Russian, so the
 *    keyboard layout is usually Cyrillic. `event.key` then reports the Cyrillic
 *    character for letter and punctuation keys ('[' is 'х'), which means a
 *    binding written as `'['` silently stops working. Punctuation that the
 *    layout genuinely produces ('?', '/') is matched on `event.key` — that is
 *    layout-correct, because Shift+7 on a Russian layout really does report
 *    '?'. Keys that move position instead of character are matched on
 *    `event.code` as well, so both layouts work.
 * 2. **Guards.** Every binding has to stay out of the way of text fields and
 *    of anything modal; keeping that in one place means a new shortcut cannot
 *    forget it.
 */
import { useEffect } from 'react'

export interface Hotkey {
  /** Characters that satisfy the binding, as `event.key` reports them. */
  key?: string[]
  /** Physical keys that satisfy it, as `event.code` reports them. */
  code?: string[]
  alt?: boolean
  shift?: boolean
  ctrl?: boolean
  run: () => void
  /** Skipped while false — a binding for a control that is not on screen. */
  enabled?: boolean
}

const TEXT_INPUT = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** True while the event came from somewhere the user is typing. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  if (TEXT_INPUT.has(el.tagName)) return true
  return el.isContentEditable === true
}

/**
 * True while a dialog is on screen. A modal owns the keyboard: Alt+2 behind an
 * open dialog would navigate away and leave it hanging over the new screen.
 * Mantine renders modals, drawers and confirm dialogs with role="dialog".
 */
function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"]') != null
}

function matches(e: KeyboardEvent, hk: Hotkey): boolean {
  if (hk.enabled === false) return false
  if (!!hk.alt !== e.altKey) return false
  if (!!hk.ctrl !== (e.ctrlKey || e.metaKey)) return false
  // Shift is only required when the binding says so; a binding that asks for a
  // shifted character ('?') already carries Shift in the character itself.
  if (hk.shift && !e.shiftKey) return false
  const byKey = hk.key?.includes(e.key) ?? false
  const byCode = hk.code?.includes(e.code) ?? false
  return byKey || byCode
}

/**
 * Binds `hotkeys` to the document for as long as the component lives. The array
 * may be rebuilt on every render — the effect re-subscribes, which costs one
 * listener swap and keeps the handlers from closing over stale state.
 */
export function useHotkeys(hotkeys: Hotkey[]): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (isModalOpen()) return
      const typing = isTyping(e.target)
      for (const hk of hotkeys) {
        if (!matches(e, hk)) continue
        // Bare keys ('?', '[') are characters the user may be typing; the ones
        // carrying Alt cannot be, so those keep working inside the search box.
        if (typing && !hk.alt && !hk.ctrl) continue
        e.preventDefault()
        hk.run()
        return
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })
}

/** How a binding is written in the help dialog and in button tooltips. */
export const ALT = 'Alt'
export const hint = (keys: string) => `(${keys})`
