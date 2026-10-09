import { useState, type FormEvent } from 'react'
import { apiBase, type DesktopSession } from './desktop-api'

interface SessionResponse { session: DesktopSession; room: { roomId: string } }

export default function DesktopLanding({ onEnter }: { onEnter: (session: DesktopSession) => void }) {
  const [nickname, setNickname] = useState('')
  const [roomName, setRoomName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent, action: 'create' | 'join') {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBase()}/api/v2/rooms${action === 'join' ? '/join' : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'join'
          ? { nickname, invite_code: inviteCode.trim().toUpperCase() }
          : { nickname, room_name: roomName }),
      })
      const result = await response.json() as SessionResponse & { code?: string }
      if (!response.ok) throw new Error(result.code === 'ROOM_NOT_FOUND' ? '找不到这个房间' : result.code === 'ROOM_FULL' ? '房间已满' : '无法进入房间，请检查输入后重试')
      onEnter(result.session)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '网络连接失败') }
    finally { setBusy(false) }
  }

  return <main className="desktop-shell desktop-landing">
    <h1>在线桌面面板</h1>
    <p>创建房间或输入六位邀请码加入。</p>
    <label>你的称呼<input value={nickname} maxLength={24} onChange={event => setNickname(event.target.value)} required /></label>
    <form onSubmit={event => void submit(event, 'create')}>
      <label>房间名称<input value={roomName} maxLength={60} onChange={event => setRoomName(event.target.value)} placeholder="未命名房间" /></label>
      <button disabled={busy || !nickname.trim()}>创建房间</button>
    </form>
    <form onSubmit={event => void submit(event, 'join')}>
      <label>六位邀请码<input value={inviteCode} maxLength={6} onChange={event => setInviteCode(event.target.value.toUpperCase())} required /></label>
      <button disabled={busy || !nickname.trim() || !/^[A-Z0-9]{6}$/.test(inviteCode.trim())}>加入房间</button>
    </form>
    {error && <p className="desktop-error" role="alert">{error}</p>}
  </main>
}
