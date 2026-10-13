import { describe, expect, it } from 'vitest'
import daggerheart from '../../../../packages/shared/src/__tests__/fixtures/daggerheart-sheet.json'
import { routeCharacterIngest } from '../character-ingest'

const endpoint = 'https://rooms.example/api/v2/rooms/ABC123/characters'

function envWith(fetch: (request: Request) => Promise<Response>) {
  return {
    CHARACTER_INGEST_ORIGINS: 'https://dhsheet.top,https://daggerheart.cn',
    ROOMS_V2: { getByName: (name: string) => {
      expect(name).toBe('ABC123')
      return { fetch }
    } },
  } as never
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      Origin: 'https://dhsheet.top',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'delivery-123',
      ...headers,
    },
    body,
  })
}

describe('character ingestion endpoint', () => {
  it('validates the complete delivery before forwarding one replacement', async () => {
    const forwarded: Request[] = []
    const result = await routeCharacterIngest(
      post(JSON.stringify({ schemaVersion: 1, sheet: daggerheart })),
      envWith(async request => {
        forwarded.push(request)
        return Response.json({ ok: true, action: 'created', name: '阿岚', generation: 1, seq: 1 })
      }),
    )

    expect(result?.status).toBe(200)
    expect(result?.headers.get('Access-Control-Allow-Origin')).toBe('https://dhsheet.top')
    expect(await result?.json()).toEqual({ ok: true, action: 'created', name: '阿岚', generation: 1, seq: 1 })
    expect(forwarded).toHaveLength(1)
    expect(new URL(forwarded[0].url).pathname).toBe('/internal/v2/replace')
    expect(await forwarded[0].json()).toEqual({ requestId: 'delivery-123', sheet: daggerheart })
  })

  it('forwards the complete v2 sheet and its edited display snapshot', async () => {
    const forwarded: Request[] = []
    const sheet = { ...daggerheart, characterBackground: '刚编辑的背景', desktopView: {
      version: 1, evasion: '11', armorValue: '2', minorThreshold: '17', majorThreshold: '28',
      attributes: { agility: '+2', strength: '+1', finesse: '0', instinct: '0', presence: '0', knowledge: '0' },
      hpMax: 7, stressMax: 7, armorMax: 3, primaryWeaponAttribute: '', primaryWeaponRange: '', secondaryWeaponAttribute: '', secondaryWeaponRange: '',
    } }
    const result = await routeCharacterIngest(post(JSON.stringify({ schemaVersion: 2, sheet })), envWith(async request => {
      forwarded.push(request)
      return Response.json({ ok: true, action: 'updated', name: '阿岚', generation: 2, seq: 2 })
    }))
    expect(result?.status).toBe(200)
    expect(await forwarded[0].json()).toEqual({ requestId: 'delivery-123', sheet })
  })

  it.each([
    [JSON.stringify({ schemaVersion: 1, sheet: { ...daggerheart, name: ' ' } }), 'INVALID_CHARACTER', 400],
    [JSON.stringify({ schemaVersion: 2, sheet: daggerheart }), 'INVALID_CHARACTER', 400],
    [JSON.stringify({ schemaVersion: 3, sheet: daggerheart }), 'UNSUPPORTED_SCHEMA', 400],
    [JSON.stringify({ schemaVersion: 1, sheet: { ...daggerheart, unknown: 'x'.repeat(513 * 1024) } }), 'PAYLOAD_TOO_LARGE', 413],
  ])('rejects invalid input without touching room storage', async (body, code, status) => {
    let mutations = 0
    const result = await routeCharacterIngest(post(body), envWith(async () => {
      mutations++
      return Response.json({ ok: true })
    }))

    expect(result?.status).toBe(status)
    expect(await result?.json()).toMatchObject({ code })
    expect(mutations).toBe(0)
  })

  it('preserves room missing, expiry, and persistence failures from the room object', async () => {
    for (const [status, code] of [[404, 'ROOM_NOT_FOUND'], [410, 'ROOM_EXPIRED'], [503, 'PERSISTENCE_FAILED']] as const) {
      const result = await routeCharacterIngest(
        post(JSON.stringify({ schemaVersion: 1, sheet: daggerheart })),
        envWith(async () => Response.json({ code }, { status })),
      )
      expect(result?.status).toBe(status)
      expect(await result?.json()).toEqual({ code })
    }
  })

  it('maps a thrown room persistence failure without mislabeling valid JSON', async () => {
    const result = await routeCharacterIngest(
      post(JSON.stringify({ schemaVersion: 1, sheet: daggerheart })),
      envWith(async () => { throw new Error('durable object unavailable') }),
    )

    expect(result?.status).toBe(503)
    expect(result?.headers.get('Access-Control-Allow-Origin')).toBe('https://dhsheet.top')
    expect(await result?.json()).toEqual({ code: 'PERSISTENCE_FAILED' })
  })

  it('uses a separate browser-origin allowlist and handles preflight', async () => {
    const rejected = await routeCharacterIngest(
      post(JSON.stringify({ schemaVersion: 1, sheet: daggerheart }), { Origin: 'https://evil.example' }),
      envWith(async () => Response.json({ ok: true })),
    )
    expect(rejected?.status).toBe(403)

    const preflight = await routeCharacterIngest(new Request(endpoint, {
      method: 'OPTIONS',
      headers: { Origin: 'https://dhsheet.top' },
    }), envWith(async () => Response.json({ ok: true })))
    expect(preflight?.status).toBe(204)
    expect(preflight?.headers.get('Access-Control-Allow-Headers')).toContain('Idempotency-Key')

    const pbdhPreflight = await routeCharacterIngest(new Request(endpoint, {
      method: 'OPTIONS',
      headers: { Origin: 'https://daggerheart.cn' },
    }), envWith(async () => Response.json({ ok: true })))
    expect(pbdhPreflight?.status).toBe(204)
    expect(pbdhPreflight?.headers.get('Access-Control-Allow-Origin')).toBe('https://daggerheart.cn')
  })

  it('requires a six-character room code and a valid idempotency key', async () => {
    const wrongRoom = await routeCharacterIngest(new Request('https://rooms.example/api/v2/rooms/ABCDEFGH/characters', { method: 'POST' }), envWith(async () => Response.json({ ok: true })))
    expect(wrongRoom).toBeNull()

    const result = await routeCharacterIngest(
      post(JSON.stringify({ schemaVersion: 1, sheet: daggerheart }), { 'Idempotency-Key': 'bad key' }),
      envWith(async () => Response.json({ ok: true })),
    )
    expect(result?.status).toBe(400)
    expect(await result?.json()).toMatchObject({ code: 'INVALID_CHARACTER' })
  })

  it('applies the join-equivalent per-IP rate limit', async () => {
    const env = envWith(async () => Response.json({ ok: true, action: 'created', name: '阿岚', generation: 1, seq: 1 }))
    let last: Response | null = null
    for (let index = 0; index < 21; index++) {
      last = await routeCharacterIngest(post(JSON.stringify({ schemaVersion: 1, sheet: daggerheart }), {
        'CF-Connecting-IP': '203.0.113.45',
        'Idempotency-Key': `delivery-${index}`,
      }), env)
    }
    expect(last?.status).toBe(429)
    expect(await last?.json()).toEqual({ code: 'RATE_LIMITED' })
  })
})
