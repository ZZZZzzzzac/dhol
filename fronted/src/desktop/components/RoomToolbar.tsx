import { useState, type ReactNode } from 'react'
import { buildRoomLink } from '../room-links'

export default function RoomToolbar({
  roomName,
  inviteCode,
  status,
  activeCount,
  xCardNode,
  onExport,
  onLeave,
  onDelete,
}: {
  roomName: string
  inviteCode: string
  status: string
  activeCount?: number
  xCardNode?: ReactNode
  onExport: () => void
  onLeave: () => void
  onDelete?: () => void
}) {
  const copy = () => void navigator.clipboard?.writeText(inviteCode)
  const [shareLink, setShareLink] = useState('')
  const [shareStatus, setShareStatus] = useState('')
  async function share() {
    const link = buildRoomLink(window.location.href, inviteCode)
    setShareLink(link)
    setShareStatus('正在复制…')
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(link)
      setShareStatus('链接已复制，可发送给其他玩家。')
    } catch {
      setShareStatus('无法自动复制，请选择下方链接手动复制。')
    }
  }

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
      <div className="room-share">
        <button type="button" className="button button--ghost" aria-expanded={Boolean(shareLink)} onClick={() => void share()}>分享链接</button>
        {shareLink && <div className="room-share__popover" role="group" aria-label="房间分享链接">
          <p role="status">{shareStatus}</p>
          <input aria-label="房间链接" readOnly value={shareLink} onFocus={event => event.currentTarget.select()} />
          <button type="button" className="button button--ghost" onClick={() => setShareLink('')}>关闭分享链接</button>
        </div>}
      </div>
      <button type="button" className="button button--ghost" onClick={onExport}>导出</button>
      <button type="button" className="button button--ghost" onClick={onLeave}>退出房间</button>
      {onDelete && <button type="button" className="button button--danger" onClick={onDelete}>删除房间</button>}
    </div>
  </header>
}
