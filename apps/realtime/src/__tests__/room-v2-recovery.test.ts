import { describe, expect, it } from 'vitest'
import { createRoomV2Fixture } from '../../../../packages/shared/src/__tests__/fixtures/room-v2-fixture'
import daggerheart from '../../../../packages/shared/src/__tests__/fixtures/daggerheart-sheet.json'
import { RoomV2Commands, type CommandStorage } from '../room-v2-commands'
import { resourcesFromSheet, type CharacterResources, type CharacterSheetJson } from '@dhgc/shared/desktop'

describe('Room V2 recovery contract', () => {
  const initialRoom = createRoomV2Fixture()
  function persistedRoom() {
    const character = initialRoom.characters[0]
    let seq = 1
    let resources: CharacterResources = structuredClone(character.resources)
    const receipts = new Map<string, { payload_hash: string; seq: number; result_json: string }>()
    const db: CommandStorage = {
      receipt: (actor, requestId) => receipts.get(`${actor}:${requestId}`) ?? null,
      metaRow: () => ({ room_json: '{}', seq, fear: 0, xcard_json: null }),
      roomExpiresAt: () => '2030-01-01',
      characterHeader: name => name === character.name ? { name, generation: 1, position: 0 } : null,
      resources: () => structuredClone(resources), nextPosition: () => 1,
      transaction: callback => callback(),
      advance: next => { seq = next },
      saveReceipt: (actor, requestId, hash, receiptSeq, result) => { receipts.set(`${actor}:${requestId}`, { payload_hash: hash, seq: receiptSeq, result_json: JSON.stringify(result) }) },
      saveResources: (_name, next) => { resources = structuredClone(next) },
      saveCharacter: () => undefined, deleteCharacter: () => undefined, saveDice: () => undefined, clearDice: () => undefined,
    }
    return { db, resources: () => resources, seq: () => seq }
  }
  it('starts from an unmarked synthetic JSON room', () => {
    expect(initialRoom.characters[0].resources.hp.every(mark => !mark)).toBe(true)
    expect(initialRoom.characters[0].resources.stress.every(mark => !mark)).toBe(true)
  })
  it('reads marked hp and stress from persisted resources after reconstructing a command processor', async () => {
    const room = persistedRoom()
    const original = new RoomV2Commands(room.db, () => undefined)
    const name = initialRoom.characters[0].name
    await original.mutate('player-a', '甲', { type: 'character.setMark', protocolVersion: 2, requestId: 'hp', name, generation: 1, resource: 'hp', index: 0, marked: true })
    await original.mutate('player-a', '甲', { type: 'character.setMark', protocolVersion: 2, requestId: 'stress', name, generation: 1, resource: 'stress', index: 0, marked: true })
    const rebuilt = new RoomV2Commands(room.db, () => undefined)
    expect(room.resources().hp[0]).toBe(true)
    expect(room.resources().stress[0]).toBe(true)
    expect(room.seq()).toBe(3)
    const retry = await rebuilt.mutate('player-a', '甲', { type: 'character.setMark', protocolVersion: 2, requestId: 'hp', name, generation: 1, resource: 'hp', index: 0, marked: true })
    expect(retry.duplicate).toBe(true)
    expect(room.seq()).toBe(3)
  })
  it('returns a receipt after persistence succeeded but its ACK was lost', async () => {
    const room = persistedRoom()
    const command = { type: 'room.adjustFear' as const, protocolVersion: 2 as const, requestId: 'lost-ack', delta: 1 as const }
    const first = await new RoomV2Commands(room.db, () => undefined).mutate('player-a', '甲', command)
    const second = await new RoomV2Commands(room.db, () => undefined).mutate('player-a', '甲', command)
    expect(second.ack).toEqual(first.ack)
    expect(second.duplicate).toBe(true)
    expect(room.seq()).toBe(2)
  })

  it('does not overwrite later resource marks when the original delivery is retried', async () => {
    let seq = 0
    let generation: number | null = null
    let resources: CharacterResources | null = null
    const receipts = new Map<string, { payload_hash: string; seq: number; result_json: string }>()
    const sheet = daggerheart as CharacterSheetJson
    const db: CommandStorage = {
      receipt: (actor, requestId) => receipts.get(`${actor}:${requestId}`) ?? null,
      metaRow: () => ({ room_json: '{}', seq, fear: 0, xcard_json: null }),
      roomExpiresAt: () => '2030-01-01',
      characterHeader: name => generation === null ? null : { name, generation, position: 0 },
      resources: () => resources ? structuredClone(resources) : null,
      nextPosition: () => 0,
      transaction: callback => callback(),
      advance: next => { seq = next },
      saveReceipt: (actor, requestId, hash, receiptSeq, result) => { receipts.set(`${actor}:${requestId}`, { payload_hash: hash, seq: receiptSeq, result_json: JSON.stringify(result) }) },
      saveResources: (_name, next) => { resources = structuredClone(next) },
      saveCharacter: (_name, nextGeneration, _position, delivered) => {
        generation = nextGeneration
        resources = structuredClone(resourcesFromSheet(delivered))
      },
      deleteCharacter: () => undefined, saveDice: () => undefined, clearDice: () => undefined,
    }
    const commands = new RoomV2Commands(db, () => undefined)

    const first = await commands.replace('delivery', 'delivery-1', sheet)
    await commands.mutate('player-a', '甲', {
      type: 'character.setMark', protocolVersion: 2, requestId: 'mark-1',
      name: sheet.name, generation: first.ack.seq, resource: 'stress', index: 0, marked: true,
    })
    const markedSeq = seq
    const retry = await new RoomV2Commands(db, () => undefined).replace('delivery', 'delivery-1', sheet)

    expect(db.resources(sheet.name)?.stress[0]).toBe(true)
    expect(seq).toBe(markedSeq)
    expect(retry.ack).toEqual(first.ack)
    expect(retry.action).toBe(first.action)
    expect(retry.duplicate).toBe(true)
  })
})
