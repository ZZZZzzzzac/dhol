import { useState, type ChangeEvent, type FormEvent } from 'react'
import { apiBase, type DesktopSession } from './desktop-api'

interface SessionResponse { session: DesktopSession; room: { roomId: string }; code?: string }
const errors: Record<string, string> = { ROOM_NOT_FOUND: '找不到这个房间。', ROOM_FULL: '房间已满。', ROOM_EXPIRED: '房间已过期。', RATE_LIMITED: '操作太频繁，请稍后重试。', INVALID_BACKUP: '备份文件无效或不是新版房间备份。' }

export default function DesktopLanding({ onEnter }: { onEnter: (session: DesktopSession) => void }) {
  const [nickname, setNickname] = useState('')
  const [roomName, setRoomName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [backup, setBackup] = useState<unknown>(null)
  const [backupName, setBackupName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function request(path: string, body: unknown) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBase()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as SessionResponse
      if (!response.ok) throw new Error(errors[result.code ?? ''] ?? '无法进入房间，请检查输入后重试。')
      onEnter(result.session)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '网络连接失败。') } finally { setBusy(false) }
  }
  function submit(event: FormEvent, action: 'create' | 'join') { event.preventDefault(); void request(`/api/v2/rooms${action === 'join' ? '/join' : ''}`, action === 'join' ? { nickname, invite_code: inviteCode.trim().toUpperCase() } : { nickname, room_name: roomName }) }
  async function chooseBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    setBackupName(file.name); setError('')
    try { setBackup(JSON.parse(await file.text()) as unknown) } catch { setBackup(null); setError('无法读取这个 JSON 文件。') }
  }
  return <main className="desktop-landing">
    <section className="landing-intro"><p>DHOL · ROOM V2</p><h1>让桌面上的每次变化，都可靠抵达。</h1><p>四角色摘要、完整只读卡面、实时资源与服务器掷骰。房间状态只有一个权威来源，刷新和重连不会让已保存的标记消失。</p></section>
    <section className="landing-panel"><div className="landing-card"><p className="muted">全新桌面版</p><h2>进入在线面板</h2><label htmlFor="nickname">你的称呼<input id="nickname" value={nickname} maxLength={24} autoComplete="nickname" onChange={event => setNickname(event.target.value)} required /></label>
      <div className="landing-actions"><form onSubmit={event => submit(event, 'create')}><strong>创建新房间</strong><label htmlFor="room-name">房间名称<input id="room-name" value={roomName} maxLength={60} onChange={event => setRoomName(event.target.value)} placeholder="未命名房间" /></label><button className="button button--primary" disabled={busy || !nickname.trim()}>创建房间</button></form>
        <form onSubmit={event => submit(event, 'join')}><strong>加入已有房间</strong><label htmlFor="invite-code">六位邀请码<input id="invite-code" value={inviteCode} maxLength={6} spellCheck={false} onChange={event => setInviteCode(event.target.value.toUpperCase())} placeholder="ABC123" required /></label><button className="button button--primary" disabled={busy || !nickname.trim() || !/^[A-Z0-9]{6}$/.test(inviteCode.trim())}>加入房间</button></form></div>
      <div className="restore-box"><strong>从新版备份创建房间</strong><p className="muted">恢复会创建新的房间实例和邀请码，不复用旧会话。</p><label htmlFor="backup-file">选择 JSON 备份<input id="backup-file" type="file" accept="application/json,.json" onChange={event => void chooseBackup(event)} /></label>{backupName && <p className="muted">已选择：{backupName}</p>}<button className="button" disabled={busy || !nickname.trim() || !backup} onClick={() => void request('/api/v2/rooms/restore', { nickname, backup })}>恢复为新房间</button></div>
      {error && <p className="desktop-error" role="alert">{error}</p>}
    </div></section>
  </main>
}
