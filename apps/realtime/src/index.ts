import { routeCharacterIngest } from './character-ingest'
import { routeRoomV2 } from './room-v2-http'
import type { RoomV2Env } from './room-v2'

export { RoomV2DurableObject } from './room-v2'

export type Env = RoomV2Env

function legacyRoomsRetired(): Response {
  return Response.json({
    code: 'LEGACY_ROOMS_RETIRED',
    message: '旧版房间已下线，请创建新房间',
    action: 'CREATE_NEW_ROOM',
  }, { status: 410 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ingestion = await routeCharacterIngest(request, env)
    if (ingestion) return ingestion
    const v2 = await routeRoomV2(request, env)
    if (v2) return v2
    const pathname = new URL(request.url).pathname
    if (pathname === '/api/rooms' || pathname.startsWith('/api/rooms/')) return legacyRoomsRetired()
    return Response.json({ code: 'NOT_FOUND' }, { status: 404 })
  },
}
