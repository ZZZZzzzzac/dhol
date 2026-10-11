import { describe, expect, it } from 'vitest'
import worker from '../index'
import stageEightWorker from '../room-v2-stage8-worker'
import type { Env } from '../index'

function retirementEnv(): Env {
  return new Proxy({
    ROOMS_V2: { getByName: () => { throw new Error('ROOMS_V2 must not be consulted for a legacy route') } },
    SESSION_SECRET: 'test-secret',
  } as unknown as Env, {
    get(target, property, receiver) {
      if (property === 'ROOMS') throw new Error('retired ROOMS binding was consulted')
      return Reflect.get(target, property, receiver)
    },
  })
}

describe('legacy room retirement', () => {
  for (const [method, pathname, headers] of [
    ['GET', '/api/rooms', {}],
    ['POST', '/api/rooms/join', {}],
    ['GET', '/api/rooms/ABC123/ws', { Upgrade: 'websocket' }],
    ['DELETE', '/api/rooms/anything/deeper', {}],
  ] as const) {
    it(`returns a stateless 410 for ${method} ${pathname}`, async () => {
      const response = await worker.fetch(new Request(`https://room.test${pathname}`, { method, headers }), retirementEnv())

      expect(response.status).toBe(410)
      await expect(response.json()).resolves.toMatchObject({
        code: 'LEGACY_ROOMS_RETIRED',
        action: 'CREATE_NEW_ROOM',
      })
    })
  }

  it('keeps unrelated unknown API routes as not found', async () => {
    const response = await worker.fetch(new Request('https://room.test/api/room'), retirementEnv())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ code: 'NOT_FOUND' })
  })

  it('keeps the isolated worker entry on the same retirement boundary', async () => {
    const response = await stageEightWorker.fetch(new Request('https://room.test/api/rooms/ABC123/ws', {
      headers: { Upgrade: 'websocket' },
    }), retirementEnv())
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({ code: 'LEGACY_ROOMS_RETIRED' })
  })

  it('returns a Room V2 miss without falling back to legacy storage', async () => {
    let v2Lookups = 0
    const env = new Proxy({
      ROOMS_V2: { getByName: () => {
        v2Lookups++
        return { fetch: () => Response.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 }) }
      } },
      SESSION_SECRET: 'test-secret',
    } as unknown as Env, {
      get(target, property, receiver) {
        if (property === 'ROOMS') throw new Error('retired ROOMS binding was consulted')
        return Reflect.get(target, property, receiver)
      },
    })
    const response = await worker.fetch(new Request('https://room.test/api/v2/rooms/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode: 'ABC123', nickname: 'Alice' }),
    }), env)

    expect(response.status).toBe(404)
    expect(v2Lookups).toBe(1)
    await expect(response.json()).resolves.toEqual({ code: 'ROOM_NOT_FOUND' })
  })
})
