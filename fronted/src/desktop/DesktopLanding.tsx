import { useState, type ChangeEvent, type FormEvent } from 'react'
import { apiBase, type DesktopSession } from './desktop-api'

interface SessionResponse { session: DesktopSession; room: { roomId: string }; code?: string }
const errors: Record<string, string> = {
  ROOM_NOT_FOUND: '找不到这个房间。',
  ROOM_FULL: '房间已满。',
  ROOM_EXPIRED: '房间已过期。',
  RATE_LIMITED: '操作太频繁，请稍后重试。',
  INVALID_BACKUP: '备份文件无效或不是新版房间备份。'
}

export default function DesktopLanding({ onEnter, initialInviteCode = '' }: { onEnter: (session: DesktopSession) => void; initialInviteCode?: string }) {
  const [nickname, setNickname] = useState('')
  const [roomName, setRoomName] = useState('')
  const [inviteCode, setInviteCode] = useState(initialInviteCode)
  const [backup, setBackup] = useState<unknown>(null)
  const [backupName, setBackupName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function request(path: string, body: unknown) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${apiBase()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const result = await response.json() as SessionResponse
      if (!response.ok) throw new Error(errors[result.code ?? ''] ?? '无法进入房间，请检查输入后重试。')
      onEnter(result.session)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '网络连接失败。')
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent, action: 'create' | 'join') {
    event.preventDefault()
    void request(
      `/api/v2/rooms${action === 'join' ? '/join' : ''}`,
      action === 'join'
        ? { nickname: nickname.trim(), invite_code: inviteCode.trim().toUpperCase() }
        : { nickname: nickname.trim(), room_name: roomName.trim() }
    )
  }

  async function chooseBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBackupName(file.name)
    setError('')
    try {
      setBackup(JSON.parse(await file.text()) as unknown)
    } catch {
      setBackup(null)
      setError('无法读取这个备份文件。')
    }
  }

  const hasNickname = nickname.trim().length > 0
  const canJoin = hasNickname && /^[A-Z0-9]{6}$/.test(inviteCode.trim())
  const canRestore = hasNickname && Boolean(backup)

  return (
    <main className="desktop-landing">
      <div className="landing-window">
        {/* 顶部标题栏 */}
        <header className="landing-window__head">
          <h1>匕首之心在线面板</h1>
          <p className="landing-window__notice">
            玩家请从SRD车卡器<a href="https://dhsheet.top" target="_blank" rel="noreferrer">dhsheet.top</a>直接发送角色卡至房间，无需文件导入
          </p>
        </header>

        <div className="landing-window__body">
          {/* 玩家称呼（全局前提） */}
          <section className="landing-identity-bar">
            <label htmlFor="nickname">你的称呼</label>
            <input
              id="nickname"
              className="landing-identity-input"
              value={nickname}
              maxLength={24}
              autoComplete="nickname"
              placeholder="请输入称呼（必填）"
              onChange={event => setNickname(event.target.value)}
              required
            />
          </section>

          {/* 错误提示 */}
          {error && <p className="landing-error-bar" role="alert">{error}</p>}

          {/* 三栏核心动作区 */}
          <div className="landing-grid">
            {/* 1. 创建房间 */}
            <section className="landing-action-cell">
              <header className="landing-action-cell__head">
                <h2>创建房间</h2>
              </header>
              <form className="landing-action-cell__body" onSubmit={event => submit(event, 'create')}>
                <div className="landing-form-group">
                  <input
                    id="room-name"
                    aria-label="房间名称"
                    className="landing-input"
                    value={roomName}
                    maxLength={60}
                    onChange={event => setRoomName(event.target.value)}
                    placeholder="未命名房间"
                  />
                </div>
                <button type="submit" className="landing-btn-submit" disabled={busy || !hasNickname}>
                  创建房间
                </button>
              </form>
            </section>

            {/* 2. 加入房间 */}
            <section className="landing-action-cell">
              <header className="landing-action-cell__head">
                <h2>加入房间</h2>
              </header>
              <form className="landing-action-cell__body" onSubmit={event => submit(event, 'join')}>
                <div className="landing-form-group">
                  <input
                    id="invite-code"
                    aria-label="六位邀请码"
                    className="landing-input landing-input--mono"
                    value={inviteCode}
                    maxLength={6}
                    spellCheck={false}
                    onChange={event => setInviteCode(event.target.value.toUpperCase())}
                    required
                  />
                </div>
                <button type="submit" className="landing-btn-submit" disabled={busy || !canJoin}>
                  加入房间
                </button>
              </form>
            </section>

            {/* 3. 恢复房间 */}
            <section className="landing-action-cell">
              <header className="landing-action-cell__head">
                <h2>恢复房间</h2>
              </header>
              <div className="landing-action-cell__body">
                <div className="landing-form-group">
                  <label htmlFor="backup-file" className="landing-file-btn">
                    {backupName ? backupName : '点击选择备份文件'}
                  </label>
                  <input
                    id="backup-file"
                    type="file"
                    className="landing-file-hidden"
                    accept="application/json,.json"
                    onChange={event => void chooseBackup(event)}
                  />
                </div>
                <button
                  type="button"
                  className="landing-btn-submit landing-btn-submit--outline"
                  disabled={busy || !canRestore}
                  onClick={() => void request('/api/v2/rooms/restore', { nickname: nickname.trim(), backup })}
                >
                  恢复房间
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
