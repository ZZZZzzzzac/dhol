import { describe, expect, it } from 'vitest'
import { resolveApiBase, resolveWebsocketUrl } from '../desktop/desktop-api'

describe('desktop API base', () => {
  it('uses the Pages origin in production so WebSockets stay same-origin', () => {
    expect(resolveApiBase(undefined, false, 'https://screenol.pages.dev/')).toBe('https://screenol.pages.dev')
  })

  it('keeps explicit deployments and the local Worker override', () => {
    expect(resolveApiBase('https://stage.example.test/', false, 'https://screenol.pages.dev')).toBe('https://stage.example.test')
    expect(resolveApiBase(undefined, true, 'http://localhost:5173')).toBe('http://127.0.0.1:8787')
  })

  it('rebuilds persisted WebSocket URLs against the active API origin', () => {
    expect(resolveWebsocketUrl('https://screenol.pages.dev', { inviteCode: 'ABC123', token: 'session.token' }))
      .toBe('wss://screenol.pages.dev/api/v2/rooms/ABC123/ws?token=session.token')
    expect(resolveWebsocketUrl('http://127.0.0.1:8787', { inviteCode: 'ABC123', token: 'session.token' }))
      .toBe('ws://127.0.0.1:8787/api/v2/rooms/ABC123/ws?token=session.token')
  })
})
