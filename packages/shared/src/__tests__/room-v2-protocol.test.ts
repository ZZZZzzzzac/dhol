import { describe, expect, it } from 'vitest'
import { parseMutationCommand, parseSyncRequest, ROOM_V2_SESSION_AUDIENCE } from '../room-v2-protocol'

describe('v2 protocol', () => {
  it('has a separate audience and exact version', () => {
    expect(ROOM_V2_SESSION_AUDIENCE).toBe('dhol-room-v2')
    expect(() => parseMutationCommand({ type: 'room.adjustFear', protocolVersion: 1, requestId: 'a', delta: 1 })).toThrow('INVALID_COMMAND')
  })
  it('accepts small mutations, rejects full-track writes', () => {
    expect(parseMutationCommand({ type: 'character.setMark', protocolVersion: 2, requestId: 'a', name: '阿岚', generation: 4, resource: 'hp', index: 2, marked: true })).toMatchObject({ index: 2 })
    expect(parseMutationCommand({ type: 'character.setMark', protocolVersion: 2, requestId: 'b', name: ' 阿岚 ', generation: 4, resource: 'hp', index: 2, marked: true })).toMatchObject({ name: '阿岚' })
    expect(parseMutationCommand({ type: 'character.setMark', protocolVersion: 2, requestId: 'gold', name: '阿岚', generation: 4, resource: 'gold', index: 20, marked: true })).toMatchObject({ resource: 'gold', index: 20 })
    expect(() => parseMutationCommand({ type: 'character.setMark', protocolVersion: 2, requestId: 'a', name: '阿岚', generation: 4, resource: 'hp', index: -1, marked: true })).toThrow('INVALID_COMMAND')
    expect(() => parseMutationCommand({ type: 'dice.roll', protocolVersion: 2, requestId: 'c', payload: { mode: 'dual' } })).toThrow('INVALID_COMMAND')
  })
  it('bounds receipt lookup requests', () => {
    expect(parseSyncRequest({ type: 'room.sync', protocolVersion: 2, afterSeq: 12, pendingRequestIds: ['a'] }).afterSeq).toBe(12)
    expect(() => parseSyncRequest({ type: 'room.sync', protocolVersion: 2, afterSeq: -1, pendingRequestIds: [] })).toThrow('INVALID_COMMAND')
  })
})
