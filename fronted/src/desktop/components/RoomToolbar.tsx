import type { ReactNode } from 'react'

export default function RoomToolbar({
  roomName,
  inviteCode,
  nickname,
  status,
  save,
  reason,
  activeCount,
  xCardNode,
  onBackup,
  onLeave
}: {
  roomName: string
  inviteCode: string
  nickname: string
  status: string
  save: string
  reason: string | null
  activeCount?: number
  xCardNode?: ReactNode
  onBackup: () => void
  onLeave: () => void
}) {
  const copy = () => void navigator.clipboard?.writeText(inviteCode)

  return <header className="room-toolbar">
    <div className="room-toolbar__brand">
      <div className="brand-logo">DH</div>
      <div>
        <h1 className="brand-title">{roomName}</h1>
      </div>
    </div>
    <div className="room-toolbar__session">
      <button type="button" className="invite-code" onClick={copy} title="复制邀请码">
        <b>{inviteCode}</b>
      </button>
      <div className="connection-badge" data-status={status}>
        <i aria-hidden="true" />
        <span>{status === 'ready' ? '已连接' : status === 'expired' ? '已过期' : '正在连接'}<small>{save}{reason ? ` · ${reason}` : ''}</small></span>
      </div>
      {typeof activeCount === 'number' && <div className="member-count-badge">{activeCount}人在线</div>}
      <span className="nickname">{nickname}</span>
      {xCardNode}
      <button type="button" className="button button--ghost" onClick={onBackup}>备份</button>
      <button type="button" className="button button--ghost" onClick={onLeave}>离开</button>
    </div>
  </header>
}
