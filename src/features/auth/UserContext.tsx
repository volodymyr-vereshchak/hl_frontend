import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { setSessionHandlers, type SessionLostReason } from '@/lib/apiClient'
import type { User } from '@/types'
import { authApi } from './authApi'

interface UserContextValue {
  user: User | null
  loading: boolean
  /** Why the last session ended, for the login screen to explain itself. */
  sessionNotice: SessionLostReason | null
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  logout: () => Promise<void>
}

const UserContext = createContext<UserContextValue | null>(null)

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionNotice, setSessionNotice] = useState<SessionLostReason | null>(null)

  // Hydrate the session on mount.
  useEffect(() => {
    authApi
      .me()
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  // When a 401 + transparent /auth/me re-auth both fail, the session is truly
  // gone → drop to the login screen instead of looping on failing requests.
  useEffect(() => {
    setSessionHandlers({
      onSessionLost: (reason) => {
        setUser(null)
        // Only a session the backend ended on purpose is worth a notice; an
        // ordinary expiry is what the login form is for.
        setSessionNotice(reason === 'expired' ? null : reason)
      },
    })
    return () => setSessionHandlers({ onSessionLost: undefined })
  }, [])

  const login = async (username: string, password: string, rememberMe = false) => {
    const data = await authApi.login(username, password, rememberMe)
    setUser(data)
    setSessionNotice(null)
  }

  const logout = async () => {
    await authApi.logout()
    setUser(null)
    setSessionNotice(null)
  }

  return <UserContext value={{ user, loading, sessionNotice, login, logout }}>{children}</UserContext>
}

export function useUser(): UserContextValue {
  const ctx = use(UserContext)
  if (!ctx) throw new Error('useUser must be used within UserProvider')
  return ctx
}
