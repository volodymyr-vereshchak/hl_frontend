import { create } from 'zustand'

/**
 * Sending somebody from one admin tab to another, with a row in mind.
 *
 * The monitor lists sites and their settings now live on the enterprise card,
 * so "why is this one not polling" ends at a form on a different tab. Asking
 * an operator to switch tabs and find the same site again by name — down a
 * list of hundreds — is how a screen gets a reputation for being read-only.
 *
 * A store rather than a route because the admin tabs are not routed: the tab
 * is remembered in localStorage, and there is nothing in the URL to point at.
 * The request is consumed by whoever handles it, so a later visit to that tab
 * does not reopen the form.
 */
interface AdminNavigation {
  tab: string | null
  /** The enterprise to open for editing once that tab is shown. */
  enterpriseId: number | null
  /** The ДПД line to open, for the rows of the monitor that are lines. */
  dpdLineId: number | null
  openEnterprise: (id: number) => void
  openDpdLine: (id: number) => void
  taken: () => void
}

/**
 * The same request from another browser tab, where the store is empty: the
 * admin page reads this parameter once, hands it to the store and drops it
 * from the address, so a reload does not reopen the form.
 */
export const EDIT_ENTERPRISE_PARAM = 'edit-enterprise'

/** A link that opens the enterprise's card for editing in the admin. */
export const enterpriseEditHref = (id: number) => `/admin?${EDIT_ENTERPRISE_PARAM}=${id}`

export const useAdminNavigation = create<AdminNavigation>((set) => ({
  tab: null,
  enterpriseId: null,
  dpdLineId: null,
  openEnterprise: (id) => set({ tab: 'enterprises', enterpriseId: id, dpdLineId: null }),
  openDpdLine: (id) => set({ tab: 'dpd-lines', dpdLineId: id, enterpriseId: null }),
  taken: () => set({ tab: null, enterpriseId: null, dpdLineId: null }),
}))
