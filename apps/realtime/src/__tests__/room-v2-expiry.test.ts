import { describe, expect, it } from 'vitest'
import { RoomV2DurableObject } from '../room-v2'

describe('Room V2 expiry', () => {
  it('closes sockets, removes the alarm, and deletes the room storage', async () => {
    const calls: string[] = []
    let row: { room_json: string; seq: number; fear: number; xcard_json: null } | null = {
      room_json: JSON.stringify({ roomId: 'old', inviteCode: 'ABC123', expiresAt: '2026-01-01T00:00:00.000Z', players: [] }), seq: 4, fear: 2, xcard_json: null,
    }
    const ctx = {
      storage: {
        sql: { exec: (query: string) => ({ toArray: () => query.startsWith('SELECT room_json') && row ? [row] : [] }) },
        deleteAlarm: async () => { calls.push('alarm') },
        deleteAll: async () => { calls.push('storage'); row = null },
      },
      getWebSockets: () => [{ close: () => { calls.push('socket') } }],
      blockConcurrencyWhile: (callback: () => Promise<void>) => callback(),
    }
    const room = new RoomV2DurableObject(ctx as never, { SESSION_SECRET: 'test' } as never)
    await room.alarm()
    expect(calls).toEqual(['socket', 'alarm', 'storage'])
    const join = await room.fetch(new Request('https://internal/internal/v2/join', { method: 'POST', body: JSON.stringify({ playerId: 'new', nickname: 'test' }) }))
    expect(join.status).toBe(404)
  })
})
