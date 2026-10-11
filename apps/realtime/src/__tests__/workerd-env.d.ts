import type { RoomV2DurableObject } from '../room-v2'

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    ROOMS_V2: DurableObjectNamespace<RoomV2DurableObject>
    SESSION_SECRET: string
  }
}
