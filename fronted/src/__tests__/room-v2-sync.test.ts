import { describe, expect, it } from 'vitest'
import type { RoomSocket } from '../desktop/sync/room-client'
import { RoomSync } from '../desktop/state/room-sync'
import { createRoomV2Fixture } from '../../../packages/shared/src/__tests__/fixtures/room-v2-fixture'

function harness(roomId = 'room-fixture') {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  const sent: unknown[] = []
  const socket = { readyState: 1, onopen: null, onmessage: null, onclose: null, onerror: null, send: (value: string) => { sent.push(JSON.parse(value)) }, close: () => undefined } as RoomSocket
  const sync = new RoomSync({ roomId, actorId: 'player-a', websocketUrl: 'ws://example.test', storage, client: { socketFactory: () => socket } })
  sync.start()
  socket.onopen?.call(socket as WebSocket, new Event('open'))
  const room = createRoomV2Fixture(roomId)
  sync.receive({ type: 'room.snapshot', protocolVersion: 2, room, receipts: [] })
  return { sync, room, socket, sent, storage }
}

describe('Room V2 sync', () => {
  it('updates presence without advancing room sequence or changing dice', () => {
    const { sync, room } = harness()
    const dice = sync.getState().room?.dice
    sync.receive({
      type: 'room.presence', protocolVersion: 2,
      members: room.members.map(member => member.id === 'player-b' ? { ...member, online: false } : member),
    })
    expect(sync.getState().room?.members.filter(member => member.online)).toHaveLength(1)
    expect(sync.getState().room?.seq).toBe(room.seq)
    expect(sync.getState().room?.dice).toBe(dice)
    sync.destroy()
  })

  it('retains optimistic hope after ACK until the event is applied', () => {
    const { sync, room } = harness()
    const name = room.characters[0].name
    const generation = room.characters[0].generation
    const requestId = sync.submit({ type: 'character.adjustHope', name, generation, delta: 1 })
    expect(sync.getState().room!.characters[0].resources.hope).toBe(room.characters[0].resources.hope + 1)
    sync.receive({ type: 'operation.ack', requestId, seq: 1 })
    expect(sync.pending()).toHaveLength(1)
    expect(sync.getState().room!.characters[0].resources.hope).toBe(room.characters[0].resources.hope + 1)
    sync.receive({ type: 'character.resourcesChanged', requestId, seq: 1, name, generation, resources: { ...room.characters[0].resources, hope: room.characters[0].resources.hope + 1 } })
    expect(sync.pending()).toHaveLength(0)
    expect(sync.getState().room!.characters[0].resources.hope).toBe(room.characters[0].resources.hope + 1)
    expect(sync.getState().save).toBe('saved')
    sync.destroy()
  })

  it('keeps a gold chest mark through the pending command, event, and refreshed snapshot', () => {
    const { sync, room, sent } = harness()
    const character = room.characters[0]
    const requestId = sync.submit({ type: 'character.setMark', name: character.name, generation: character.generation, resource: 'gold', index: 20, marked: true })
    expect(sent.at(-1)).toMatchObject({ resource: 'gold', index: 20, marked: true })
    expect(sync.getState().room?.characters[0].resources.gold?.[20]).toBe(true)
    const resources = { ...character.resources, gold: [...(character.resources.gold ?? Array(21).fill(false))] }
    resources.gold[20] = true
    sync.receive({ type: 'character.resourcesChanged', requestId, seq: 1, name: character.name, generation: character.generation, resources })
    expect(sync.pending()).toHaveLength(0)
    sync.receive({ type: 'room.snapshot', protocolVersion: 2, room: { ...room, seq: 1, characters: [{ ...character, resources }] }, receipts: [] })
    expect(sync.getState().room?.characters[0].resources.gold?.[20]).toBe(true)
    sync.destroy()
  })

  it('ignores old snapshots and requests a current snapshot for gaps', () => {
    const { sync, room, sent } = harness()
    sync.receive({ type: 'room.snapshot', protocolVersion: 2, room: { ...room, seq: 12, fear: { value: 5, max: 12 } }, receipts: [] })
    sync.receive({ type: 'room.snapshot', protocolVersion: 2, room: { ...room, seq: 11, fear: { value: 1, max: 12 } }, receipts: [] })
    expect(sync.getConfirmed()!.seq).toBe(12)
    expect(sync.getConfirmed()!.fear.value).toBe(5)
    sync.receive({ type: 'room.fearChanged', seq: 14, requestId: 'other', fear: { value: 6, max: 12 } })
    expect(sent.at(-1)).toMatchObject({ type: 'room.sync', afterSeq: 12 })
    sync.destroy()
  })

  it('removes a lost ACK operation from a matching snapshot receipt before projection', () => {
    const { sync, room, storage } = harness()
    const requestId = sync.submit({ type: 'room.adjustFear', delta: 1 })
    const reloaded = new RoomSync({ roomId: room.roomId, actorId: 'player-a', websocketUrl: 'ws://example.test', storage })
    reloaded.receive({ type: 'room.snapshot', protocolVersion: 2, room: { ...room, seq: 1, fear: { value: 1, max: 12 } }, receipts: [{ type: 'operation.ack', requestId, seq: 1 }] })
    expect(reloaded.pending()).toHaveLength(0)
    expect(reloaded.getState().room!.fear.value).toBe(1)
    sync.destroy(); reloaded.destroy()
  })

  it('discards stale generation operations and detail fetches', async () => {
    const { sync, room } = harness()
    const old = room.characters[0]
    const requestId = sync.submit({ type: 'character.adjustHope', name: old.name, generation: old.generation, delta: 1 })
    let resolve!: (value: unknown) => void
    const detail = sync.detail(old.name, old.generation, () => new Promise(complete => { resolve = complete }))
    sync.receive({ type: 'character.replaced', requestId: 'delivery-new', seq: 1, name: old.name, generation: 1, summary: { ...old, generation: 1 } })
    sync.receive({ type: 'character.replaced', requestId: 'delivery-newer', seq: 2, name: old.name, generation: 2, summary: { ...old, generation: 2 } })
    resolve({ sheet: 'old' })
    await expect(detail).rejects.toThrow('重新投递')
    expect(sync.pending().some(entry => entry.command.requestId === requestId)).toBe(false)
    expect(sync.ui.getState().notice).toContain('重新投递')
    sync.destroy()
  })

  it('does not notify a character subscriber for a dice event', () => {
    const { sync, room } = harness()
    let characterUpdates = 0
    const unsubscribe = sync.subscribeCharacter(room.characters[0].name, () => { characterUpdates++ })
    sync.receive({
      type: 'dice.rolled', requestId: 'roll', seq: 1,
      roll: { id: 'roll', created_at: '2026-10-09T00:00:00.000Z', actor_player_id: 'player-a', actor_name: '甲', normalized_formula: '1d20',
        request: { mode: 'standard', modifier_mode: 'normal', repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] }, mode: 'standard', modifier_mode: 'normal',
        results: [{ total: 10, critical: false, primary_rolls: [10], terms: [{ notation: '1d20', sides: 20, count: 1, rolls: [10], subtotal: 10 }] }],
      },
    })
    expect(characterUpdates).toBe(0)
    unsubscribe(); sync.destroy()
  })

  it('retries a detail read after a canceled request', async () => {
    const { sync, room } = harness()
    const character = room.characters[0]
    await expect(sync.detail(character.name, character.generation, async () => { throw new Error('aborted') })).rejects.toThrow('aborted')
    await expect(sync.detail(character.name, character.generation, async () => ({ sheet: 'retry' }))).resolves.toEqual({ sheet: 'retry' })
    sync.destroy()
  })

  it('applies the formal roll and clears its pending request in one UI notification', () => {
    const { sync } = harness()
    const requestId = sync.submit({ type: 'dice.roll', payload: { mode: 'standard', modifier_mode: 'normal', repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] } })
    let updates = 0
    const unsubscribe = sync.subscribe(() => { updates++ })
    sync.receive({
      type: 'dice.rolled', requestId, seq: 1,
      roll: { id: 'formal-roll', created_at: '2026-10-10T00:00:00.000Z', actor_player_id: 'player-a', actor_name: '甲', normalized_formula: '1d20',
        request: { mode: 'standard', modifier_mode: 'normal', repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] }, mode: 'standard', modifier_mode: 'normal',
        results: [{ total: 12, critical: false, primary_rolls: [12], terms: [{ notation: '1d20', sides: 20, count: 1, rolls: [12], subtotal: 12 }] }],
      },
    })
    expect(sync.getState().room?.dice.at(-1)?.id).toBe('formal-roll')
    expect(sync.pending()).toHaveLength(0)
    expect(updates).toBe(1)
    unsubscribe(); sync.destroy()
  })
})
