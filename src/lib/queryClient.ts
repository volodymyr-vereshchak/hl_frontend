import { QueryClient } from '@tanstack/react-query'

/**
 * Shared React Query client. Retries are handled inside the API client
 * (idempotent-only, with 401 re-auth), so we keep Query's own retry off to
 * avoid double retry storms against the backend.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})
