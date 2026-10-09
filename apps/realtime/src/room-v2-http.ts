import { parseCharacterDelivery, CharacterValidationError, MAX_CHARACTER_REQUEST_BYTES, type RoomV2Model } from '@dhgc/shared/desktop'
import { signRoomV2Session } from './room-v2-session'
import type { RoomV2Env } from './room-v2'
import type { StoredMeta } from './room-v2-storage'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const limits = new Map<string, { count: number; until: number }>()

function limited(request: Request): boolean {
  const key = request.headers.get('CF-Connecting-IP') ?? 'local'
  const now = Date.now()
  const current = limits.get(key)
  if (!current || current.until < now) { limits.set(key, { count: 1, until: now + 60_000 }); return false }
  current.count++
  return current.count > 20
}

function code(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

function response(body: unknown, status = 200): Response { return Response.json(body, { status }) }
function stub(env: RoomV2Env, inviteCode: string): DurableObjectStub { return env.ROOMS_V2.getByName(inviteCode) }
function internal(path: string, init?: RequestInit): Request { return new Request(`https://room-v2.internal${path}`, init) }
function text(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function originAllowed(request: Request, env: RoomV2Env): boolean {
  const origin = request.headers.get('origin')
  return !origin || !env.ALLOWED_ORIGIN || origin === env.ALLOWED_ORIGIN
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
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(combined)
}

function cors(request: Request, env: RoomV2Env, result: Response): Response {
  const origin = request.headers.get('origin')
  if (!origin || (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN)) return result
  const headers = new Headers(result.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  return new Response(result.body, { status: result.status, headers })
}

async function sessionResponse(request: Request, env: RoomV2Env, room: RoomV2Model, player: { id: string; nickname: string }): Promise<Response> {
  const token = await signRoomV2Session(env.SESSION_SECRET, {
    roomId: room.roomId, inviteCode: room.inviteCode, playerId: player.id, nickname: player.nickname,
  })
  const url = new URL(request.url)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/v2/rooms/${room.inviteCode}/ws`
  url.search = new URLSearchParams({ token }).toString()
  return response({ session: { roomId: room.roomId, inviteCode: room.inviteCode, playerId: player.id, nickname: player.nickname, token, websocketUrl: url.toString() }, room })
}

async function create(request: Request, env: RoomV2Env): Promise<Response> {
  if (limited(request)) return response({ code: 'RATE_LIMITED' }, 429)
  let input: Record<string, unknown>
  try { input = await request.json() as Record<string, unknown> } catch { return response({ code: 'VALIDATION_ERROR' }, 400) }
  const name = text(input.room_name ?? input.name, 60) || 'Untitled Room'
  const nickname = text(input.nickname, 24)
  if (!nickname || input.room_type !== undefined) return response({ code: 'VALIDATION_ERROR' }, 400)
  const days = input.duration_days === undefined ? 3 : input.duration_days
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) return response({ code: 'VALIDATION_ERROR' }, 400)
  for (let attempt = 0; attempt < 8; attempt++) {
    const inviteCode = code()
    const player = { id: crypto.randomUUID(), nickname }
    const meta: StoredMeta = {
      roomId: crypto.randomUUID(), name, inviteCode, createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(), players: [player], protocolVersion: 2,
    }
    const result = await stub(env, inviteCode).fetch(internal('/internal/v2/create', { method: 'POST', body: JSON.stringify(meta) }))
    if (result.status === 409) continue
    if (!result.ok) return result
    const payload = await result.json() as { room: RoomV2Model; player: { id: string; nickname: string } }
    return sessionResponse(request, env, payload.room, payload.player)
  }
  return response({ code: 'INVITE_COLLISION' }, 503)
}

async function join(request: Request, env: RoomV2Env): Promise<Response> {
  if (limited(request)) return response({ code: 'RATE_LIMITED' }, 429)
  let input: Record<string, unknown>
  try { input = await request.json() as Record<string, unknown> } catch { return response({ code: 'VALIDATION_ERROR' }, 400) }
  const inviteCode = text(input.invite_code ?? input.inviteCode, 6).toUpperCase()
  const nickname = text(input.nickname, 24)
  if (!/^[A-Z0-9]{6}$/.test(inviteCode) || !nickname) return response({ code: 'VALIDATION_ERROR' }, 400)
  const result = await stub(env, inviteCode).fetch(internal('/internal/v2/join', { method: 'POST', body: JSON.stringify({ playerId: crypto.randomUUID(), nickname }) }))
  if (!result.ok) return result
  const payload = await result.json() as { room: RoomV2Model; player: { id: string; nickname: string } }
  return sessionResponse(request, env, payload.room, payload.player)
}

export async function routeRoomV2(request: Request, env: RoomV2Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/v2/rooms')) return null
  if (!originAllowed(request, env)) return response({ code: 'ORIGIN_NOT_ALLOWED' }, 403)
  if (request.method === 'OPTIONS') return cors(request, env, new Response(null, { status: 204 }))
  if (request.method !== 'GET' && request.method !== 'POST') return cors(request, env, response({ code: 'METHOD_NOT_ALLOWED' }, 405))
  let result: Response
  if (url.pathname === '/api/v2/rooms' && request.method === 'POST') result = await create(request, env)
  else if (url.pathname === '/api/v2/rooms/join' && request.method === 'POST') result = await join(request, env)
  else {
    const match = url.pathname.match(/^\/api\/v2\/rooms\/([A-Z0-9]{6})(\/.*)?$/i)
    if (!match) return cors(request, env, response({ code: 'NOT_FOUND' }, 404))
    const inviteCode = match[1].toUpperCase()
    const tail = match[2] ?? ''
    if (tail === '/characters' && request.method === 'POST') {
      if (limited(request)) result = response({ code: 'RATE_LIMITED' }, 429)
      else if (!/^[\w-]{1,128}$/.test(request.headers.get('Idempotency-Key') ?? '')) result = response({ code: 'INVALID_COMMAND' }, 400)
      else {
        const length = Number(request.headers.get('content-length') ?? 0)
        if (length > MAX_CHARACTER_REQUEST_BYTES) result = response({ code: 'PAYLOAD_TOO_LARGE' }, 413)
        else {
          try {
            const delivery = parseCharacterDelivery(await boundedText(request))
            result = await stub(env, inviteCode).fetch(internal('/internal/v2/replace', { method: 'POST', body: JSON.stringify({ requestId: request.headers.get('Idempotency-Key'), sheet: delivery.sheet }) }))
          } catch (error) {
            result = response({ code: error instanceof CharacterValidationError ? error.code : 'INVALID_CHARACTER', message: error instanceof Error ? error.message : '无效角色' }, error instanceof CharacterValidationError && error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400)
          }
        }
      }
    } else {
      const token = url.searchParams.get('token')
      const headers = token ? { Authorization: `Bearer ${token}` } : { Authorization: request.headers.get('authorization') ?? '' }
      if (tail === '/ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        return stub(env, inviteCode).fetch(internal(`/internal/v2/ws?${url.searchParams.toString()}`, { headers: request.headers }))
      }
      if (tail === '/snapshot' && request.method === 'GET') result = await stub(env, inviteCode).fetch(internal('/internal/v2/snapshot', { headers }))
      else if (tail === '/export' && request.method === 'GET') result = await stub(env, inviteCode).fetch(internal('/internal/v2/export', { headers }))
      else if (tail.startsWith('/characters/') && request.method === 'GET') result = await stub(env, inviteCode).fetch(internal(`/internal/v2${tail}?${url.searchParams.toString()}`, { headers }))
      else result = response({ code: 'NOT_FOUND' }, 404)
    }
  }
  return cors(request, env, result)
}
