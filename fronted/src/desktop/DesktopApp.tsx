import { useState } from 'react'
import DesktopLanding from './DesktopLanding'
import DesktopRoom from './DesktopRoom'
import type { DesktopSession } from './desktop-api'
import './desktop.css'

const SESSION_KEY = 'dhol:desktop:v2:session'

function restore(): DesktopSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as DesktopSession | null
    return value && typeof value.roomId === 'string' && typeof value.playerId === 'string' && typeof value.websocketUrl === 'string' ? value : null
  } catch { return null }
}

export default function DesktopApp() {
  const [session, setSession] = useState<DesktopSession | null>(restore)
  function enter(next: DesktopSession) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    setSession(next)
  }
  function leave() {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }
  return session
    ? <DesktopRoom key={`${session.roomId}:${session.playerId}`} session={session} onLeave={leave} />
    : <DesktopLanding onEnter={enter} />
}
