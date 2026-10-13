import { useState } from 'react'
import DesktopLanding from './DesktopLanding'
import DesktopRoom from './DesktopRoom'
import { apiBase, resolveWebsocketUrl, type DesktopSession } from './desktop-api'
import { roomCodeFromSearch } from './room-links'
import './desktop.css'

const SESSION_KEY = 'dhol:desktop:v2:session'

function normalize(session: DesktopSession): DesktopSession {
  return { ...session, websocketUrl: resolveWebsocketUrl(apiBase(), session) }
}

function restore(targetRoom: string | null): DesktopSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as DesktopSession | null
    if (targetRoom && value?.inviteCode !== targetRoom) return null
    return value && typeof value.roomId === 'string' && typeof value.inviteCode === 'string' && typeof value.playerId === 'string' && typeof value.token === 'string' ? normalize(value) : null
  } catch { return null }
}

export default function DesktopApp() {
  const [targetRoom, setTargetRoom] = useState(() => roomCodeFromSearch(window.location.search))
  const [session, setSession] = useState<DesktopSession | null>(() => restore(targetRoom))
  function enter(next: DesktopSession) {
    const normalized = normalize(next)
    localStorage.setItem(SESSION_KEY, JSON.stringify(normalized))
    const url = new URL(window.location.href)
    url.searchParams.set('room', normalized.inviteCode)
    window.history.replaceState(null, '', url)
    setTargetRoom(normalized.inviteCode)
    setSession(normalized)
  }
  function leave() {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }
  return session
    ? <DesktopRoom key={`${session.roomId}:${session.playerId}`} session={session} onLeave={leave} />
    : <DesktopLanding onEnter={enter} initialInviteCode={targetRoom ?? ''} />
}
