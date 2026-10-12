import type { ReactNode } from 'react'

export default function RoomToolbar({
  roomName,
  inviteCode,
  status,
  activeCount,
  xCardNode,
  onExport,
  onLeave,
}: {
  roomName: string
  inviteCode: string
  status: string
  activeCount?: number
  xCardNode?: ReactNode
  onExport: () => void
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
        <span>{status === 'ready' ? '已连接' : status === 'expired' ? '已过期' : '正在连接'}</span>
      </div>
      {typeof activeCount === 'number' && <div className="member-count-badge">{activeCount}人在线</div>}
    </div>
    <div className="room-toolbar__actions">
      {xCardNode}
      <button type="button" className="button button--ghost" onClick={onExport}>导出</button>
      <button type="button" className="button button--ghost" onClick={onLeave}>退出房间</button>
    </div>
  </header>
}
