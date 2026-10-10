import {
  CharacterValidationError,
  MAX_CHARACTER_REQUEST_BYTES,
  parseCharacterDelivery,
} from '@dhgc/shared/desktop'
import type { RoomV2Env } from './room-v2'

const limits = new Map<string, { count: number; until: number }>()

export function roomV2RateLimited(request: Request): boolean {
  const key = request.headers.get('CF-Connecting-IP') ?? 'local'
  const now = Date.now()
  const current = limits.get(key)
  if (!current || current.until < now) {
    limits.set(key, { count: 1, until: now + 60_000 })
    return false
  }
  current.count++
  return current.count > 20
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function configuredOrigins(env: RoomV2Env): string[] {
  return (env.CHARACTER_INGEST_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
}

function originAllowed(request: Request, env: RoomV2Env): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const allowed = configuredOrigins(env)
  return allowed.length === 0 || allowed.includes('*') || allowed.includes(origin)
}

function withCors(request: Request, env: RoomV2Env, response: Response): Response {
  const origin = request.headers.get('origin')
  if (!origin || !originAllowed(request, env)) return response
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key')
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  return new Response(response.body, { status: response.status, headers })
}

async function boundedText(request: Request): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_CHARACTER_REQUEST_BYTES) {
      await reader.cancel()
      throw new CharacterValidationError('PAYLOAD_TOO_LARGE', '请求超过 544 KiB')
    }
    chunks.push(value)
  }
  const combined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

export async function routeCharacterIngest(request: Request, env: RoomV2Env): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/v2\/rooms\/([A-Z0-9]{6})\/characters$/i)
  if (!match) return null
  if (!originAllowed(request, env)) return json({ code: 'ORIGIN_NOT_ALLOWED' }, 403)
  if (request.method === 'OPTIONS') return withCors(request, env, new Response(null, { status: 204 }))
  if (request.method !== 'POST') return withCors(request, env, json({ code: 'INVALID_CHARACTER' }, 405))
  if (roomV2RateLimited(request)) return withCors(request, env, json({ code: 'RATE_LIMITED' }, 429))

  const requestId = request.headers.get('Idempotency-Key') ?? ''
  if (!/^[\w-]{1,128}$/.test(requestId)) {
    return withCors(request, env, json({ code: 'INVALID_CHARACTER', message: 'Idempotency-Key 无效' }, 400))
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_CHARACTER_REQUEST_BYTES) {
    return withCors(request, env, json({ code: 'PAYLOAD_TOO_LARGE' }, 413))
  }

  let delivery: ReturnType<typeof parseCharacterDelivery>
  try {
    delivery = parseCharacterDelivery(await boundedText(request))
  } catch (error) {
    const code = error instanceof CharacterValidationError ? error.code : 'INVALID_CHARACTER'
    const status = code === 'PAYLOAD_TOO_LARGE' ? 413 : 400
    return withCors(request, env, json({ code, message: error instanceof Error ? error.message : '无效角色' }, status))
  }

  try {
    const inviteCode = match[1].toUpperCase()
    const result = await env.ROOMS_V2.getByName(inviteCode).fetch(new Request('https://room-v2.internal/internal/v2/replace', {
      method: 'POST',
      body: JSON.stringify({ requestId, sheet: delivery.sheet }),
    }))
    return withCors(request, env, result)
  } catch {
    return withCors(request, env, json({ code: 'PERSISTENCE_FAILED' }, 503))
  }
}
