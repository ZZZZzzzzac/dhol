import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DesktopApp from '../desktop/DesktopApp'
import { buildRoomLink, roomCodeFromSearch } from '../desktop/room-links'
import type { DesktopSession } from '../desktop/desktop-api'

vi.mock('../desktop/DesktopRoom', () => ({
  default: ({ session }: { session: DesktopSession }) => <div>Restored room: {session.inviteCode}</div>,
}))

afterEach(() => vi.unstubAllGlobals())

describe('room invitation links', () => {
  it('accepts only complete six-character codes, normalized to uppercase', () => {
    expect(roomCodeFromSearch('?room=%20abc123%20')).toBe('ABC123')
    for (const search of ['', '?room=', '?room=ABCDE', '?room=ABCDEFG', '?room=AB%2FC12', '?room=测试1234']) {
      expect(roomCodeFromSearch(search)).toBeNull()
    }
  })

  it('shares the current frontend path and room only, without URL credentials or unrelated parameters', () => {
    expect(buildRoomLink('https://screenol.pages.dev/?token=secret&room=OLD123#private', 'ABC123'))
      .toBe('https://screenol.pages.dev/?room=ABC123')
    expect(buildRoomLink('https://user:password@example.com/panel/?debug=true#anchor', 'DEF456'))
      .toBe('https://example.com/panel/?room=DEF456')
  })
})

describe('room link entry', () => {
  function render(search: string, saved: unknown) {
    const storage = { getItem: vi.fn(() => JSON.stringify(saved)), setItem: vi.fn(), removeItem: vi.fn() }
    const request = vi.fn()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { location: { search, origin: 'https://screenol.pages.dev' } })
    vi.stubGlobal('fetch', request)
    const html = renderToStaticMarkup(<DesktopApp />)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    return html
  }
  const session = { roomId: 'room-1', inviteCode: 'ABC123', playerId: 'player-1', nickname: '玩家', token: 'private-token', websocketUrl: '' }

  it('prefills the invitation but requires a nickname and explicit join for a new visitor', () => {
    const html = render('?room=def456', null)
    expect(html).toContain('value="DEF456"')
    expect(html).toMatch(/disabled="">加入房间/)
    expect(html).not.toContain('Restored room:')
  })

  it('restores a matching saved session and preserves normal homepage restoration', () => {
    for (const search of ['?room=abc123', '', '?room=invalid!']) {
      expect(render(search, session)).toContain('Restored room: ABC123')
    }
  })

  it('opens the requested room join form instead of restoring another room, keeping the previous session intact', () => {
    const html = render('?room=DEF456', session)
    expect(html).toContain('value="DEF456"')
    expect(html).not.toContain('Restored room:')
    expect(html).not.toContain('private-token')
  })
})
