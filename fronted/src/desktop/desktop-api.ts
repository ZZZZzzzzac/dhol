export interface DesktopSession {
  roomId: string
  inviteCode: string
  playerId: string
  nickname: string
  token: string
  websocketUrl: string
}

export function apiBase(): string {
  const configured = import.meta.env.VITE_REALTIME_API_BASE
  return typeof configured === 'string' && configured.trim() ? configured.replace(/\/$/, '') : import.meta.env.DEV ? 'http://127.0.0.1:8787' : window.location.origin
}
