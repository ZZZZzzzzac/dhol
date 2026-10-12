import { describe, expect, it } from 'vitest'
import { routeRoomV2 } from '../room-v2-http'
import type { RoomV2Env } from '../room-v2'

describe('Room V2 delete route', () => {
  it('forwards authenticated DELETE and advertises it through CORS', async () => {
    const forwarded: Request[] = []
    const env = {
      ALLOWED_ORIGIN: 'https://screenol.pages.dev',
      ROOMS_V2: { getByName: () => ({ fetch: async (request: Request) => {
        forwarded.push(request)
        return Response.json({ ok: true })
      } }) },
    } as unknown as RoomV2Env
    const result = await routeRoomV2(new Request('https://screenol.pages.dev/api/v2/rooms/ABC123', {
      method: 'DELETE',
      headers: { Origin: 'https://screenol.pages.dev', Authorization: 'Bearer token' },
    }), env)

    expect(result?.status).toBe(200)
    expect(result?.headers.get('Access-Control-Allow-Methods')).toContain('DELETE')
    expect(forwarded[0]?.method).toBe('DELETE')
    expect(forwarded[0]?.headers.get('Authorization')).toBe('Bearer token')
  })
})
