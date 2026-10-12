export interface DesktopSession {
  roomId: string
  inviteCode: string
  playerId: string
  nickname: string
  token: string
  websocketUrl: string
}

export function resolveApiBase(configured: unknown, dev: boolean, origin: string): string {
  if (typeof configured === 'string' && configured.trim()) return configured.replace(/\/$/, '')
  return dev ? 'http://127.0.0.1:8787' : origin.replace(/\/$/, '')
}

export function resolveWebsocketUrl(base: string, session: Pick<DesktopSession, 'inviteCode' | 'token'>): string {
  const url = new URL(`/api/v2/rooms/${session.inviteCode}/ws`, `${base}/`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = new URLSearchParams({ token: session.token }).toString()
  return url.toString()
}

export function apiBase(): string {
  return resolveApiBase(import.meta.env.VITE_REALTIME_API_BASE, import.meta.env.DEV, window.location.origin)
}
