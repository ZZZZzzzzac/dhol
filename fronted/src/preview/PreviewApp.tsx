import { useEffect, useState } from 'react'
import { LandingPage } from '../pages/LandingPage'
import { RoomPage } from '../pages/RoomPage'

/** Temporary test entry. Phase five will point this route at DesktopApp. */
export default function PreviewApp() {
  const [inRoom, setInRoom] = useState(false)
  useEffect(() => {
    document.title = '在线面板测试版'
  }, [])
  return inRoom
    ? <RoomPage onLeaveRoom={() => setInRoom(false)} />
    : <LandingPage onEnterRoom={() => setInRoom(true)} />
}
