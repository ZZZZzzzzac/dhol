import { describe, expect, it } from 'vitest'
import { signRoomV2Session, verifyRoomV2Session } from '../room-v2-session'

describe('Room V2 sessions', () => {
  it('accepts the V2 audience and rejects modified or legacy tokens', async () => {
    const payload = { roomId: 'new-room', inviteCode: 'ABC123', playerId: 'player-a', nickname: '甲' }
    const token = await signRoomV2Session('secret', payload)
    expect(await verifyRoomV2Session('secret', token)).toMatchObject({ ...payload, aud: 'dhol-room-v2' })
    expect(await verifyRoomV2Session('other-secret', token)).toBeNull()
    expect(await verifyRoomV2Session('secret', `${token}extra`)).toBeNull()
    expect(await verifyRoomV2Session('secret', 'legacy-room-token')).toBeNull()
  })
})
