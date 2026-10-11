import { routeCharacterIngest } from './character-ingest'
import { routeRoomV2 } from './room-v2-http'
import type { RoomV2Env } from './room-v2'

export { RoomV2DurableObject } from './room-v2'

export default {
  async fetch(request: Request, env: RoomV2Env): Promise<Response> {
    const ingestion = await routeCharacterIngest(request, env)
    if (ingestion) return ingestion
    const room = await routeRoomV2(request, env)
    return room ?? Response.json({ code: 'NOT_FOUND' }, { status: 404 })
  },
}
