import daggerheart from './daggerheart-sheet.json'
import { resourcesFromSheet, summaryFromSheet, type CharacterSheetJson } from '../../character-panel'
import type { RoomV2Model } from '../../room-v2-model'

const sheet = { ...daggerheart, hp: daggerheart.hp.map(() => false), stress: daggerheart.stress.map(() => false) } as CharacterSheetJson

export function createRoomV2Fixture(roomId = 'room-fixture', seq = 0): RoomV2Model {
  return {
    protocolVersion: 2,
    roomId,
    name: '合成测试房间',
    inviteCode: 'ABC123',
    expiresAt: '2030-01-01T00:00:00.000Z',
    seq,
    members: [{ id: 'player-a', nickname: '测试甲', online: true }, { id: 'player-b', nickname: '测试乙', online: true }],
    characters: [summaryFromSheet(sheet, resourcesFromSheet(sheet), 1, 0)],
    fear: { value: 0, max: 12 },
    dice: [],
    xCard: { active: false, updatedAt: null },
  }
}
