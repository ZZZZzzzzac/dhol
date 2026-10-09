import legacyRoomWorker, { type Env as LegacyEnv } from './legacy-room'
import { routeRoomV2 } from './room-v2-http'
import type { RoomV2Env } from './room-v2'

export { RoomDurableObject } from './legacy-room'
export { RoomV2DurableObject } from './room-v2'

export type Env = LegacyEnv & RoomV2Env

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const v2 = await routeRoomV2(request, env)
    return v2 ?? legacyRoomWorker.fetch(request, env)
  },
}
