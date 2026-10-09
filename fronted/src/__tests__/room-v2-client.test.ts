import { describe, expect, it } from 'vitest'
import { RoomClient, type RoomSocket } from '../desktop/sync/room-client'

function fakeSocket() {
  const sent: unknown[] = []
  const socket = { readyState: 1, onopen: null, onmessage: null, onclose: null, onerror: null, send: (value: string) => { sent.push(JSON.parse(value)) }, close: () => undefined } as RoomSocket
  return { socket, sent }
}

describe('Room V2 client', () => {
  it('waits for snapshot before allowing commands and retries the same pending ID after reconnect', () => {
    const sockets = [fakeSocket(), fakeSocket()]
    let nextSocket = 0
    const statuses: string[] = []
    const timers: (() => void)[] = []
    const client = new RoomClient({
      roomId: 'room-a', websocketUrl: 'ws://room-a', socketFactory: () => sockets[nextSocket++].socket,
      setTimer: callback => { timers.push(callback); return setTimeout(() => undefined, 1) }, clearTimer: handle => clearTimeout(handle),
      pendingIds: () => ['same-request-id'], afterSeq: () => 3,
      onMessage: () => undefined, onStatus: status => { statuses.push(status) },
    })
    client.connect()
    const first = sockets[0]
    expect(client.send({ type: 'room.adjustFear', protocolVersion: 2, requestId: 'new', delta: 1 })).toBe(false)
    first.socket.onopen?.call(first.socket as WebSocket, new Event('open'))
    expect(first.sent[0]).toMatchObject({ type: 'room.sync', afterSeq: 3, pendingRequestIds: ['same-request-id'] })
    client.ready()
    first.socket.onclose?.call(first.socket as WebSocket, { code: 1006, reason: 'network' } as CloseEvent)
    expect(client.connectionStatus).toBe('reconnecting')
    timers[0]()
    const second = sockets[1]
    second.socket.onopen?.call(second.socket as WebSocket, new Event('open'))
    expect(second.sent[0]).toMatchObject({ pendingRequestIds: ['same-request-id'] })
    expect(statuses).toContain('synchronizing')
    client.destroy()
  })

  it('stops reconnecting after an expired room close', () => {
    const { socket } = fakeSocket()
    let retries = 0
    const client = new RoomClient({ roomId: 'room-a', websocketUrl: 'ws://room-a', socketFactory: () => socket,
      setTimer: () => { retries++; return setTimeout(() => undefined, 1) }, pendingIds: () => [], afterSeq: () => 0,
      onMessage: () => undefined, onStatus: () => undefined })
    client.connect()
    socket.onclose?.call(socket as WebSocket, { code: 1008, reason: 'Room expired' } as CloseEvent)
    expect(client.connectionStatus).toBe('expired')
    expect(retries).toBe(0)
    client.destroy()
  })
})
