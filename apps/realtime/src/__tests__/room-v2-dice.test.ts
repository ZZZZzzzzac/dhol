import { describe, expect, it } from 'vitest'
import daggerheart from '../../../../packages/shared/src/__tests__/fixtures/daggerheart-sheet.json'
import type { CharacterSheetJson, DiceRollRecord, RoomEvent } from '@dhgc/shared/desktop'
import { RoomV2Commands, type CommandStorage, type RollCommandMetric, type RoomV2CommandOptions } from '../room-v2-commands'
import { RoomV2DurableObject } from '../room-v2'

function fixture(options: RoomV2CommandOptions = {}, persistenceOrder?: string[]) {
  let seq = 0
  let activeTransactions = 0
  const receipts = new Map<string, { payload_hash: string; seq: number; result_json: string }>()
  const dice: DiceRollRecord[] = []
  const events: RoomEvent[] = []
  const metrics: RollCommandMetric[] = []
  const db: CommandStorage = {
    receipt: (actor, requestId) => receipts.get(`${actor}:${requestId}`) ?? null,
    metaRow: () => ({ room_json: '{}', seq, fear: 0, xcard_json: null }),
    roomExpiresAt: () => '2030-01-01T00:00:00.000Z',
    characterHeader: () => null,
    resources: () => null,
    nextPosition: () => 0,
    transaction: callback => { activeTransactions++; try { return callback() } finally { activeTransactions-- } },
    advance: next => { persistenceOrder?.push(`advance:${next}`); seq = next },
    saveReceipt: (actor, requestId, hash, receiptSeq, result) => { persistenceOrder?.push(`receipt:${requestId}`); receipts.set(`${actor}:${requestId}`, { payload_hash: hash, seq: receiptSeq, result_json: JSON.stringify(result) }) },
    saveResources: () => undefined,
    saveCharacter: () => undefined,
    deleteCharacter: () => undefined,
    saveDice: (rollSeq, roll) => { expect(activeTransactions).toBe(1); persistenceOrder?.push(`save:${rollSeq}:${roll.actor_name}`); dice.push(roll) },
    clearDice: () => undefined,
  }
  const commands = new RoomV2Commands(db, event => { expect(activeTransactions).toBe(0); persistenceOrder?.push(`publish:${event.seq}`); events.push(event) }, { ...options, onRollMetric: metric => { metrics.push(metric); options.onRollMetric?.(metric) } })
  return { commands, db, dice, events, metrics, receipts, seq: () => seq }
}

const standardRoll = (requestId: string) => ({
  type: 'dice.roll' as const,
  protocolVersion: 2 as const,
  requestId,
  payload: { mode: 'standard' as const, modifier_mode: 'normal' as const, repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] },
})

describe('Room V2 dice hot path', () => {
  it('authorizes a WebSocket roll without reading or parsing the complete room metadata', async () => {
    const sent: unknown[] = []
    const session = { aud: 'dhol-room-v2', roomId: 'room', inviteCode: 'ABC123', playerId: 'player-a', nickname: '甲', exp: Math.floor(Date.now() / 1000) + 60 }
    const room = Object.create(RoomV2DurableObject.prototype) as unknown as {
      db: Record<string, unknown>
      commands: Record<string, unknown>
      webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void>
    }
    room.db = {
      meta: () => { throw new Error('complete meta must stay cold') },
      sessionAccess: (playerId: string) => ({ roomId: 'room', inviteCode: 'ABC123', expiresAt: '2030-01-01T00:00:00.000Z', member: playerId === 'player-a' }),
    }
    room.commands = { mutate: async () => ({ ack: { type: 'operation.ack', requestId: 'roll-hot', seq: 1 }, event: null, duplicate: false }) }
    const socket = {
      deserializeAttachment: () => session,
      send: (value: string) => sent.push(JSON.parse(value)),
      close: () => { throw new Error('valid session must not close') },
    }

    await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify(standardRoll('roll-hot')))
    expect(sent).toEqual([{ type: 'operation.ack', requestId: 'roll-hot', seq: 1 }])
  })

  it.each([
    [{ roomId: 'room', inviteCode: 'ABC123', expiresAt: '2030-01-01T00:00:00.000Z', member: false }, 'Session expired'],
    [{ roomId: 'another-room', inviteCode: 'ABC123', expiresAt: '2030-01-01T00:00:00.000Z', member: true }, 'Session expired'],
    [{ roomId: 'room', inviteCode: 'ABC123', expiresAt: '2020-01-01T00:00:00.000Z', member: true }, 'Room expired'],
  ])('rejects missing membership, mismatched rooms, and expired rooms using minimal access data', async (access, expectedReason) => {
    const room = Object.create(RoomV2DurableObject.prototype) as unknown as {
      db: Record<string, unknown>
      commands: Record<string, unknown>
      webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void>
    }
    room.db = { meta: () => { throw new Error('complete meta must stay cold') }, sessionAccess: () => access }
    room.commands = { mutate: async () => { throw new Error('unauthorized command reached commit') } }
    const closed: string[] = []
    const socket = {
      deserializeAttachment: () => ({ aud: 'dhol-room-v2', roomId: 'room', inviteCode: 'ABC123', playerId: 'player-a', nickname: '甲', exp: Math.floor(Date.now() / 1000) + 60 }),
      send: () => undefined,
      close: (_code: number, reason: string) => { closed.push(reason) },
    }
    await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify(standardRoll('rejected')))
    expect(closed).toEqual([expectedReason])
  })

  it('persists once, then gives initiator and observers the same formal roll', async () => {
    const room = fixture()
    const result = await room.commands.mutate('player-a', '甲', standardRoll('roll-1'))
    const event = room.events[0]

    expect(event).toMatchObject({ type: 'dice.rolled', requestId: 'roll-1', seq: result.ack.seq })
    expect(event.type === 'dice.rolled' && event.roll).toEqual(room.dice[0])
    expect(event.type === 'dice.rolled' && event.roll.id).toBe(room.dice[0].id)
    expect(new TextEncoder().encode(JSON.stringify(event)).byteLength).toBeLessThanOrEqual(2 * 1024)
    expect(room.metrics).toHaveLength(1)
    expect(room.metrics[0]).toMatchObject({ requestId: 'roll-1', eventBytes: expect.any(Number) })
    expect(room.metrics[0].queueMs).toBeGreaterThanOrEqual(0)
    expect(room.metrics[0].storageMs).toBeGreaterThanOrEqual(0)
    expect(room.metrics[0].broadcastMs).toBeGreaterThanOrEqual(0)
  })

  it('records a large pool at its actual size without truncating results', async () => {
    const room = fixture()
    const command = standardRoll('large')
    command.payload.dice = [4, 6, 8, 10, 12, 20, 100].map(sides => ({ sides, count: 100 }))
    command.payload.repeat = 20
    const result = await room.commands.mutate('player-a', '甲', command)
    const roll = result.event?.type === 'dice.rolled' ? result.event.roll : null

    expect(roll?.results[0].terms).toHaveLength(7)
    expect(roll?.results[0].terms.every(term => term.rolls.length === 2_000)).toBe(true)
    expect(room.metrics[0].eventBytes).toBeGreaterThan(2 * 1024)
  })

  it('fans out twenty operations with identical roll IDs and results for both clients', async () => {
    const room = fixture()
    for (let index = 0; index < 20; index++) await room.commands.mutate(index % 2 ? 'player-a' : 'player-b', index % 2 ? '甲' : '乙', standardRoll(`pair-${index}`))
    const initiatorView = room.events.map(event => structuredClone(event))
    const observerView = room.events.map(event => JSON.parse(JSON.stringify(event)) as RoomEvent)

    expect(initiatorView).toHaveLength(20)
    expect(observerView).toEqual(initiatorView)
    expect(observerView.map(event => event.type === 'dice.rolled' ? event.roll.id : null)).toEqual(
      initiatorView.map(event => event.type === 'dice.rolled' ? event.roll.id : null),
    )
  })

  it('preserves arrival order while hashing, then stores before broadcasting with observable queue time', async () => {
    let clock = 0
    let releaseFirst!: () => void
    const firstHash = new Promise<void>(resolve => { releaseFirst = resolve })
    const hashOrder: string[] = []
    const persistenceOrder: string[] = []
    const room = fixture({
      now: () => clock++,
      hash: async value => {
        const requestId = (value as { requestId: string }).requestId
        hashOrder.push(requestId)
        if (requestId === 'first') await firstHash
        return requestId
      },
    }, persistenceOrder)
    const first = room.commands.mutate('player-a', '甲', standardRoll('first'))
    const second = room.commands.mutate('player-b', '乙', standardRoll('second'))
    await Promise.resolve()
    expect(hashOrder).toEqual(['first'])
    releaseFirst()
    await Promise.all([first, second])

    expect(hashOrder).toEqual(['first', 'second'])
    expect(room.events.map(event => event.seq)).toEqual([1, 2])
    expect(room.dice.map(roll => roll.actor_name)).toEqual(['甲', '乙'])
    expect(room.seq()).toBe(2)
    expect([...room.receipts.values()].map(receipt => receipt.seq)).toEqual([1, 2])
    expect(persistenceOrder).toEqual([
      'save:1:甲', 'advance:1', 'receipt:first', 'publish:1',
      'save:2:乙', 'advance:2', 'receipt:second', 'publish:2',
    ])
    expect(room.metrics[1].queueMs).toBeGreaterThan(0)
  })

  it('serializes fifty rolls with concurrent large character replacements and reports positive queue time', async () => {
    let clock = 0
    const room = fixture({ now: () => clock++ })
    const largeSheet = { ...daggerheart, name: '压力角色', stageEightLoad: '测'.repeat(200_000) } as unknown as CharacterSheetJson
    const work: Promise<unknown>[] = []
    for (let index = 0; index < 50; index++) {
      work.push(room.commands.mutate(index % 2 ? 'player-a' : 'player-b', index % 2 ? '甲' : '乙', standardRoll(`roll-${index}`)))
      if (index % 5 === 0) work.push(room.commands.replace('delivery', `sheet-${index}`, { ...largeSheet, name: `压力角色-${index}` }))
    }
    await Promise.all(work)

    expect(room.dice).toHaveLength(50)
    expect(new Set(room.dice.map(roll => roll.id))).toHaveLength(50)
    expect(room.metrics).toHaveLength(50)
    expect(room.metrics.slice(1).some(metric => metric.queueMs > 0)).toBe(true)
  })
})
