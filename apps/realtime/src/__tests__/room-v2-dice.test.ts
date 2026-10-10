import { describe, expect, it } from 'vitest'
import daggerheart from '../../../../packages/shared/src/__tests__/fixtures/daggerheart-sheet.json'
import type { CharacterSheetJson, DiceRollRecord, RoomEvent } from '@dhgc/shared/desktop'
import { RoomV2Commands, type CommandStorage, type RollCommandMetric } from '../room-v2-commands'

function fixture() {
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
    advance: next => { seq = next },
    saveReceipt: (actor, requestId, hash, receiptSeq, result) => receipts.set(`${actor}:${requestId}`, { payload_hash: hash, seq: receiptSeq, result_json: JSON.stringify(result) }),
    saveResources: () => undefined,
    saveCharacter: () => undefined,
    deleteCharacter: () => undefined,
    saveDice: (_seq, roll) => { expect(activeTransactions).toBe(1); dice.push(roll) },
    clearDice: () => undefined,
  }
  const commands = new RoomV2Commands(db, event => { expect(activeTransactions).toBe(0); events.push(event) }, { onRollMetric: metric => metrics.push(metric) })
  return { commands, dice, events, metrics }
}

const standardRoll = (requestId: string) => ({
  type: 'dice.roll' as const,
  protocolVersion: 2 as const,
  requestId,
  payload: { mode: 'standard' as const, modifier_mode: 'normal' as const, repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] },
})

describe('Room V2 dice hot path', () => {
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

  it('serializes fifty rolls with concurrent large character replacements and reports queue time', async () => {
    const room = fixture()
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
    expect(room.metrics.some(metric => metric.queueMs >= 0)).toBe(true)
  })
})
