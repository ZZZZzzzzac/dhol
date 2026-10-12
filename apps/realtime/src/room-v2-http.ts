import { validateCharacterDelivery, type CharacterResources, type CharacterSheetJson, type DiceRollRecord, type RoomV2Model } from '@dhgc/shared/desktop'
import { roomV2RateLimited } from './character-ingest'
import { signRoomV2Session } from './room-v2-session'
import type { RoomV2Env } from './room-v2'
import type { StoredMeta } from './room-v2-storage'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
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

function cors(request: Request, env: RoomV2Env, result: Response): Response {
  const origin = request.headers.get('origin')
  if (!origin || (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN)) return result
  const headers = new Headers(result.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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
  if (roomV2RateLimited(request)) return response({ code: 'RATE_LIMITED' }, 429)
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
  if (roomV2RateLimited(request)) return response({ code: 'RATE_LIMITED' }, 429)
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

function restoreState(value: unknown): { name: string; fear: number; xCard: RoomV2Model['xCard']; dice: DiceRollRecord[]; characters: Array<{ sheet: CharacterSheetJson; resources: CharacterResources; position: number }> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_BACKUP')
  const backup = value as { schemaVersion?: unknown; room?: unknown; characters?: unknown }
  if (backup.schemaVersion !== 2 || !backup.room || typeof backup.room !== 'object' || !Array.isArray(backup.characters)) throw new Error('INVALID_BACKUP')
  const room = backup.room as Partial<RoomV2Model>
  if (!Array.isArray(room.characters) || !Array.isArray(room.dice) || !room.fear || typeof room.fear.value !== 'number' || !room.xCard || typeof room.xCard.active !== 'boolean' || backup.characters.length > 100) throw new Error('INVALID_BACKUP')
  const summaries = new Map(room.characters.map(summary => [summary.name, summary]))
  const characters = backup.characters.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('INVALID_BACKUP')
    const item = entry as { name?: unknown; sheet?: unknown }
    const delivery = validateCharacterDelivery({ schemaVersion: 1, sheet: item.sheet })
    const summary = summaries.get(delivery.sheet.name.trim())
    if (!summary || !summary.resources || !Array.isArray(summary.resources.hp) || !Array.isArray(summary.resources.stress) || !Array.isArray(summary.resources.armor)) throw new Error('INVALID_BACKUP')
    const resources = summary.resources
    if (resources.hp.some(mark => typeof mark !== 'boolean') || resources.stress.some(mark => typeof mark !== 'boolean') || resources.armor.some(mark => typeof mark !== 'boolean') || !Number.isInteger(resources.hope) || !Number.isInteger(resources.hopeMax) || resources.hope < 0 || resources.hope > resources.hopeMax) throw new Error('INVALID_BACKUP')
    if (resources.hp.length !== (delivery.sheet.hp as boolean[]).length || resources.stress.length !== (delivery.sheet.stress as boolean[]).length || resources.armor.length !== (delivery.sheet.armorBoxes as boolean[]).length) throw new Error('INVALID_BACKUP')
    return { sheet: delivery.sheet, resources, position: Number.isSafeInteger(summary.position) ? summary.position : index }
  })
  if (room.dice.some(roll => !roll || typeof roll !== 'object' || typeof roll.id !== 'string' || typeof roll.actor_name !== 'string' || typeof roll.normalized_formula !== 'string' || !Array.isArray(roll.results))) throw new Error('INVALID_BACKUP')
  return { name: text(room.name, 60) || 'Restored Room', fear: Math.max(0, Math.min(12, Math.floor(room.fear.value))), xCard: { active: room.xCard.active, updatedAt: typeof room.xCard.updatedAt === 'string' ? room.xCard.updatedAt : null }, dice: room.dice.slice(-50), characters }
}

async function restore(request: Request, env: RoomV2Env): Promise<Response> {
  if (roomV2RateLimited(request)) return response({ code: 'RATE_LIMITED' }, 429)
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024) return response({ code: 'INVALID_BACKUP' }, 413)
  let input: { nickname?: unknown; backup?: unknown }; let state: ReturnType<typeof restoreState>
  try { input = JSON.parse(body) as typeof input; state = restoreState(input.backup) } catch { return response({ code: 'INVALID_BACKUP' }, 400) }
  const nickname = text(input.nickname, 24)
  if (!nickname) return response({ code: 'VALIDATION_ERROR' }, 400)
  for (let attempt = 0; attempt < 8; attempt++) {
    const inviteCode = code(); const player = { id: crypto.randomUUID(), nickname }
    const meta: StoredMeta = { roomId: crypto.randomUUID(), name: state.name, inviteCode, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), players: [player], protocolVersion: 2 }
    const result = await stub(env, inviteCode).fetch(internal('/internal/v2/restore', { method: 'POST', body: JSON.stringify({ meta, state }) }))
    if (result.status === 409) continue
    if (!result.ok) return result
    const payload = await result.json() as { room: RoomV2Model; player: { id: string; nickname: string } }
    return sessionResponse(request, env, payload.room, payload.player)
  }
  return response({ code: 'INVITE_COLLISION' }, 503)
}

export async function routeRoomV2(request: Request, env: RoomV2Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/v2/rooms')) return null
  if (!originAllowed(request, env)) return response({ code: 'ORIGIN_NOT_ALLOWED' }, 403)
  if (request.method === 'OPTIONS') return cors(request, env, new Response(null, { status: 204 }))
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'DELETE') return cors(request, env, response({ code: 'METHOD_NOT_ALLOWED' }, 405))
  let result: Response
  if (url.pathname === '/api/v2/rooms' && request.method === 'POST') result = await create(request, env)
  else if (url.pathname === '/api/v2/rooms/join' && request.method === 'POST') result = await join(request, env)
  else if (url.pathname === '/api/v2/rooms/restore' && request.method === 'POST') result = await restore(request, env)
  else {
    const match = url.pathname.match(/^\/api\/v2\/rooms\/([A-Z0-9]{6})(\/.*)?$/i)
    if (!match) return cors(request, env, response({ code: 'NOT_FOUND' }, 404))
    const inviteCode = match[1].toUpperCase()
    const tail = match[2] ?? ''
    const token = url.searchParams.get('token')
    const headers = token ? { Authorization: `Bearer ${token}` } : { Authorization: request.headers.get('authorization') ?? '' }
    if (tail === '/ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return stub(env, inviteCode).fetch(internal(`/internal/v2/ws?${url.searchParams.toString()}`, { headers: request.headers }))
    }
    if (tail === '' && request.method === 'DELETE') result = await stub(env, inviteCode).fetch(internal('/internal/v2/delete', { method: 'DELETE', headers }))
    else if (tail === '/snapshot' && request.method === 'GET') result = await stub(env, inviteCode).fetch(internal('/internal/v2/snapshot', { headers }))
    else if (tail === '/export' && request.method === 'GET') result = await stub(env, inviteCode).fetch(internal('/internal/v2/export', { headers }))
    else if (tail.startsWith('/characters/') && request.method === 'GET') result = await stub(env, inviteCode).fetch(internal(`/internal/v2${tail}?${url.searchParams.toString()}`, { headers }))
    else result = response({ code: 'NOT_FOUND' }, 404)
  }
  return cors(request, env, result)
}
