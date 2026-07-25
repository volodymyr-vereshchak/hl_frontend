import { api } from '@/lib/apiClient'
import type { User } from '@/types'

export const authApi = {
  me: () => api.get<User>('/auth/me'),
  login: (username: string, password: string, rememberMe = false) =>
    api.post<User>('/auth/login', { username, password, remember_me: rememberMe }),
  logout: () => api.post<true>('/auth/logout'),
}
