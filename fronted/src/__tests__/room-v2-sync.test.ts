import { describe, expect, it } from 'vitest'
import { createRoomV2Fixture } from '../../../packages/shared/src/__tests__/fixtures/room-v2-fixture'

// Phase five provides the independent room sync and outbox constructors.
describe('Room V2 client recovery contract', () => {
  const initialRoom = createRoomV2Fixture()
  it('provides separate room identities for version ordering cases', () => {
    expect(createRoomV2Fixture('room-other', 11).roomId).not.toBe(initialRoom.roomId)
  })
  it.todo('keeps a pending resource mark while paging away and back')
  it.todo('ignores snapshot seq 11 after event seq 12 for the same room')
  it.todo('resets the seq comparison when entering a different roomId')
  it.todo('recovers the same requestId after refresh and lost ACK without applying twice')
  it.todo('allows retry after a detail fetch is canceled by paging away')
  it.todo('discards an old generation detail response after a same-name replacement')
})
