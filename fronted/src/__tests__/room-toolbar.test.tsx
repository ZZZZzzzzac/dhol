import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import RoomToolbar from '../desktop/components/RoomToolbar'

it('shows the destructive room action only to the room creator', () => {
  const common = { roomName: '测试房间', inviteCode: 'ABC123', status: 'ready', onExport: vi.fn(), onLeave: vi.fn() }
  expect(renderToStaticMarkup(<RoomToolbar {...common} onDelete={vi.fn()} />)).toContain('删除房间')
  expect(renderToStaticMarkup(<RoomToolbar {...common} />)).not.toContain('删除房间')
  expect(renderToStaticMarkup(<RoomToolbar {...common} />)).toContain('分享链接')
})
