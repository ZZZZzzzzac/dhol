import { describe, expect, it } from 'vitest'
import { RoomV2Commands, CommandFailure, type CommandStorage } from '../room-v2-commands'
import type { RoomEvent } from '@dhgc/shared/desktop'

function fixture() {
  let seq = 0
  let fear = 3
  let failNext = false
  const receipts = new Map<string, { payload_hash: string; seq: number; result_json: string }>()
  const dice = new Map<string, unknown>()
  const events: RoomEvent[] = []
  const db: CommandStorage = {
    receipt: (actor, requestId) => receipts.get(`${actor}:${requestId}`) ?? null,
    metaRow: () => ({ room_json: '{}', seq, fear, xcard_json: null }),
    roomExpiresAt: () => '2030-01-01',
    characterHeader: () => null, resources: () => null, nextPosition: () => 0,
    transaction: callback => { if (failNext) { failNext = false; throw new Error('disk failed') } return callback() },
    advance: (next, nextFear) => { seq = next; if (nextFear !== undefined) fear = nextFear },
    saveReceipt: (actor, requestId, hash, receiptSeq, result) => { receipts.set(`${actor}:${requestId}`, { payload_hash: hash, seq: receiptSeq, result_json: JSON.stringify(result) }) },
    saveResources: () => undefined, saveCharacter: () => undefined, deleteCharacter: () => undefined,
    saveDice: (_seq, roll) => { dice.set(roll.id, roll) }, clearDice: () => { dice.clear() },
  }
  return { db, events, dice, commands: new RoomV2Commands(db, event => events.push(event)), fail: () => { failNext = true }, state: () => ({ seq, fear, receipts: receipts.size }) }
}

describe('Room V2 command commits', () => {
  it('deduplicates the same operation and rejects reuse with another payload', async () => {
    const room = fixture()
    const command = { type: 'room.adjustFear' as const, protocolVersion: 2 as const, requestId: 'same', delta: 1 as const }
    const first = await room.commands.mutate('player-a', '甲', command)
    await room.commands.mutate('player-a', '甲', command)
    await room.commands.mutate('player-a', '甲', command)
    expect(room.state()).toMatchObject({ seq: 1, fear: 4, receipts: 1 })
    expect(room.events).toHaveLength(1)
    expect(first.ack.seq).toBe(1)
    await expect(room.commands.mutate('player-a', '甲', { ...command, delta: -1 })).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED' })
  })

  it('does not acknowledge or broadcast failed persistence and accepts the next command', async () => {
    const room = fixture()
    room.fail()
    await expect(room.commands.mutate('player-a', '甲', { type: 'room.adjustFear', protocolVersion: 2, requestId: 'failed', delta: 1 })).rejects.toEqual(new CommandFailure('PERSISTENCE_FAILED', '保存失败，请重试'))
    expect(room.state()).toMatchObject({ seq: 0, fear: 3, receipts: 0 })
    expect(room.events).toHaveLength(0)
    await room.commands.mutate('player-a', '甲', { type: 'room.adjustFear', protocolVersion: 2, requestId: 'next', delta: 1 })
    expect(room.state()).toMatchObject({ seq: 1, fear: 4, receipts: 1 })
  })

  it('returns the original roll after a new command processor reads the receipt', async () => {
    const room = fixture()
    const command = { type: 'dice.roll' as const, protocolVersion: 2 as const, requestId: 'roll-1', payload: { mode: 'standard' as const, modifier_mode: 'normal' as const, repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] } }
    const first = await room.commands.mutate('player-a', '甲', command)
    room.dice.clear()
    const rebuilt = new RoomV2Commands(room.db, event => room.events.push(event))
    const retry = await rebuilt.mutate('player-a', '甲', command)
    expect(retry.ack.seq).toBe(first.ack.seq)
    expect(retry.duplicate).toBe(true)
    expect(room.events).toHaveLength(1)
    expect(room.dice.size).toBe(0)
  })
})
