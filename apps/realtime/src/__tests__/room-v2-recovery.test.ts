import { describe, expect, it } from 'vitest'
import { createRoomV2Fixture } from '../../../../packages/shared/src/__tests__/fixtures/room-v2-fixture'

// These scenarios become executable when the SQL room and command path land in phase four.
// Do not substitute old HTML recovery as a fixture for the new JSON storage path.
describe('Room V2 recovery contract', () => {
  const initialRoom = createRoomV2Fixture()
  it('starts from an unmarked synthetic JSON room', () => {
    expect(initialRoom.characters[0].resources.hp.every(mark => !mark)).toBe(true)
    expect(initialRoom.characters[0].resources.stress.every(mark => !mark)).toBe(true)
  })
  it.todo('reads marked hp and stress from persisted resources after reconstructing a DO')
  it.todo('returns an existing receipt after persistence succeeded but its ACK was lost')
})
