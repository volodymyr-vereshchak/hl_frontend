/**
 * Everything the reader set up to look at the "no poll" result: which view,
 * what is filtered out, where in the list they were.
 *
 * It lives outside `UnpolledReport` and is held by the page, on purpose.
 * Clicking a row hides the report to move the selection in the tree, which
 * unmounts the component — with the state inside, coming back handed the reader
 * a report reset to the top with every filter dropped, right after they had
 * narrowed it to the rows they were working through.
 */
export interface UnpolledFilters {
  mode: 'list' | 'summary'
  search: string
  status: string | null
  correctors: string[]
  page: number
  pageSize: number
}

export const EMPTY_UNPOLLED_FILTERS: UnpolledFilters = {
  mode: 'list',
  search: '',
  status: null,
  correctors: [],
  page: 1,
  pageSize: 50,
}
