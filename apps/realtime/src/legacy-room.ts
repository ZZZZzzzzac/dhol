import {
  assertDhRoomBackup,
  decodeMobilePanelCharacterCode,
  safeJsonParse,
  // utils re-exports
  applyHtmlResourceTracksToSheet,
  clamp,
  cleanText,
  cloneMobilePanelResourceValue,
  cloneTrackerResourceValue,
  compileGmSheetHtml,
  createEmptyGmPanelState,
  createEmptyMobilePanelState,
  createGmSheetEntry,
  createMobilePanelCharacterEntry,
  finiteNumber,
  formatMobilePanelResourceValue,
  formatTrackerResourceValue,
  generateInviteCode,
  getMobilePanelCharacterLabel,
  getMobilePanelResourceLabel,
  getMobilePanelResourceValue,
  getTrackerResourceLabel,
  getTrackerResourceValue,
  id,
  isMobilePanelResourceValueEqual,
  isTrackerResourceValueEqual,
  makePlayer,
  messageFrom,
  normaliseInvite,
  normalizeBooleanTrack,
  normalizeDrawingBoard,
  normalizeGmPanelState,
  normalizeGmPanelStateWithHtml,
  normalizeMobilePanelCustom,
  normalizeMobilePanelResourceValue,
  normalizeMobilePanelState,
  normalizeMobilePanelTracker,
  normalizeResourceTrackerSheet,
  normalizeRoomType,
  repairKnownGmLogMessage,
  rollDicePool,
  setMobilePanelResourceValue,
  setTrackerResourceValue,
  normalizeTrackerResourceValue,
  type ClientMessage,
  type DhRoomBackup,
  type DrawingBoardSubmitRequest,
  type DiceRollRecord,
  type DiceRollRequest,
  type GmPanelActivityLogItem,
  type GmPanelCharacterSheetEntry,
  type GmPanelResourceKey,
  type GmPanelState,
  type MobilePanelActivityLogItem,
  type MobilePanelCharacterEntry,
  type MobilePanelExperience,
  type MobilePanelResourceKey,
  type MobilePanelState,
  type Player,
  type ResourceTrackerCountdown,
  type ResourceTrackerResourceKey,
  type ResourceTrackerSheet,
  type RoomState,
  type RoomType,
  type ServerMessage,
} from '../../../packages/shared/src/index'
import {
  SOCKET_SESSION_ATTACHMENT_ERROR_CODE,
  SOCKET_SESSION_ATTACHMENT_ERROR_MESSAGE,
  SocketSessionAttachmentError,
  getPlayerTag,
  prepareSocketSession,
  readSocketSessionAttachment,
  type SocketSession,
} from './socket-session'

export interface Env {
  ROOMS: DurableObjectNamespace
  DHGC_DB?: D1Database
  SESSION_SECRET: string
  ADMIN_SECRET?: string
  PUBLIC_API_BASE?: string
  /** 生产环境应设置为前端域名，如 https://dhol.pages.dev。不设置则允许所有来源（仅开发环境可接受）。 */
  ALLOWED_ORIGIN?: string
}

interface SessionPayload {
  room_id: string
  invite_code: string
  player_id: string
  nickname: string
  exp: number
}

type HtmlPersistence =
  | { mode: 'upsert'; sheetIds: string[] }
  | { mode: 'delete'; sheetIds: string[] }
  | { mode: 'sync-all' }

interface PersistedSheetHtml {
  id: string
  sourceHtml?: string
  compiledHtml?: string
}

interface RoomPersistenceJob {
  generation: number
  snapshot: RoomState
  html?:
    | { mode: 'upsert'; sheets: PersistedSheetHtml[] }
    | { mode: 'delete'; sheetIds: string[] }
    | { mode: 'sync-all'; sheets: PersistedSheetHtml[] }
}

let _corsAllowedOrigin = '*'

const PLAYER_COLORS = ['#f43f5e', '#2563eb', '#f59e0b', '#10b981', '#a855f7', '#06b6d4']
const ROOM_TTL_MS = 3 * 24 * 60 * 60 * 1000
const MIN_ROOM_DURATION_DAYS = 1
const MAX_ROOM_DURATION_DAYS = 365
const GM_SHEET_HTML_STORAGE_KEY_PREFIX = 'gm_sheet_html:'
const GM_SHEET_COMPILED_HTML_STORAGE_KEY_PREFIX = 'gm_sheet_compiled_html:'

interface AdminRoomSummary {
  room_id: string
  room_name: string
  room_type: RoomType
  invite_code: string
  created_at: string
  expires_at: string
  updated_at: string
  player_count: number
  online_player_count: number
}

// ── 结构化错误码 ──────────────────────────────────────────────────────────────
const ERR = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_INVITE: 'INVALID_INVITE',
  ROOM_FULL: 'ROOM_FULL',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const

// ── HTTP 速率限制（IP 维度，每分钟最多 10 次） ─────────────────────────────────
const _ipRateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkHttpRateLimit(ip: string): boolean {
  const now = Date.now()
  // 清理过期条目，防止内存泄漏（顺带在每次调用时清理）
  for (const [key, entry] of _ipRateLimitMap) {
    if (now >= entry.resetAt) _ipRateLimitMap.delete(key)
  }
  const entry = _ipRateLimitMap.get(ip)
  if (!entry || now >= entry.resetAt) {
    _ipRateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 10) return false
  entry.count++
  return true
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    _corsAllowedOrigin = env.ALLOWED_ORIGIN ?? '*'
    if (request.method === 'OPTIONS') return emptyCors()

    const url = new URL(request.url)
    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, service: 'dhgc-realtime', time: new Date().toISOString() })
      }

      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        return createRoom(request, env)
      }

      if (url.pathname === '/api/rooms/join' && request.method === 'POST') {
        return joinRoom(request, env)
      }

      const adminRoomMatch = url.pathname.match(/^\/api\/admin\/rooms\/([A-Z0-9]{6})$/i)
      if (adminRoomMatch && (request.method === 'GET' || request.method === 'PATCH')) {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
        if (!checkHttpRateLimit(ip)) {
          return json({ error: 'rate_limited', code: ERR.RATE_LIMITED }, { status: 429 })
        }

        const authError = await authorizeAdmin(request, env)
        if (authError) return withAdminHeaders(authError)

        const inviteCode = normaliseInvite(adminRoomMatch[1])
        const stub = roomStub(env, inviteCode)

        if (request.method === 'GET') {
          return withAdminHeaders(await stub.fetch(internalRequest('/internal/admin/summary')))
        }

        const body = await request.json() as { duration_days?: number }
        const durationDays = body.duration_days
        if (
          typeof durationDays !== 'number'
          || !Number.isInteger(durationDays)
          || durationDays < MIN_ROOM_DURATION_DAYS
          || durationDays > MAX_ROOM_DURATION_DAYS
        ) {
          return json({
            error: 'invalid_duration_days',
            code: ERR.VALIDATION_ERROR,
            message: `duration_days must be an integer from ${MIN_ROOM_DURATION_DAYS} to ${MAX_ROOM_DURATION_DAYS}`,
          }, { status: 400 })
        }

        return withAdminHeaders(await stub.fetch(internalRequest('/internal/admin/expiry', {
          method: 'PATCH',
          body: JSON.stringify({ durationDays }),
        })))
      }

      const exportMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/export\/dhroom$/i)
      if (exportMatch && request.method === 'GET') {
        const inviteCode = normaliseInvite(exportMatch[1])
        const stub = roomStub(env, inviteCode)
        const response = await stub.fetch(internalRequest('/internal/export/dhroom'))
        return withCors(response)
      }

      const sheetHtmlMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/sheets\/([^/]+)\/html$/i)
      if (sheetHtmlMatch && request.method === 'GET') {
        const inviteCode = normaliseInvite(sheetHtmlMatch[1])
        const sheetId = decodeURIComponent(sheetHtmlMatch[2])
        const stub = roomStub(env, inviteCode)
        const response = await stub.fetch(internalRequest(`/internal/sheets/${encodeURIComponent(sheetId)}/html`))
        return withCors(response)
      }

      const wsMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/ws$/i)
      if (wsMatch && request.headers.get('Upgrade') === 'websocket') {
        const inviteCode = normaliseInvite(wsMatch[1])
        const stub = roomStub(env, inviteCode)
        return stub.fetch(request)
      }

      return json({ error: 'not_found', code: ERR.ROOM_NOT_FOUND }, { status: 404 })
    } catch (error) {
      return json({ error: 'internal_error', code: ERR.INTERNAL_ERROR, message: messageFrom(error) }, { status: 500 })
    }
  },
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!checkHttpRateLimit(ip)) {
    return json({ error: '请求过于频繁，请稍后再试', code: ERR.RATE_LIMITED }, { status: 429 })
  }

  const body = await request.json() as {
    room_name?: string
    nickname?: string
    room_type?: RoomType
  }
  const roomName = cleanText(body.room_name, 'Untitled Room', 60)
  const nickname = cleanText(body.nickname, '', 24)
  const roomType = normalizeRoomType(body.room_type)
  if (!nickname) return json({ error: 'nickname_required', code: ERR.VALIDATION_ERROR }, { status: 400 })

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inviteCode = generateInviteCode()
    const playerId = id('player')
    const stub = roomStub(env, inviteCode)
    const createResponse = await stub.fetch(internalRequest('/internal/create', {
      method: 'POST',
      body: JSON.stringify({
        roomName,
        inviteCode,
        playerId,
        nickname,
        roomType,
      }),
    }))

    if (createResponse.status === 409) continue
    if (!createResponse.ok) return withCors(createResponse)

    const payload = await createResponse.json() as { state: RoomState; player: Player }
    return roomSessionResponse(request, env, payload.state, payload.player)
  }

  return json({ error: 'invite_collision', code: ERR.INTERNAL_ERROR }, { status: 500 })
}

async function joinRoom(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!checkHttpRateLimit(ip)) {
    return json({ error: '请求过于频繁，请稍后再试', code: ERR.RATE_LIMITED }, { status: 429 })
  }

  const body = await request.json() as { invite_code?: string; nickname?: string }
  const inviteCode = normaliseInvite(body.invite_code ?? '')
  const nickname = cleanText(body.nickname, '', 24)
  if (!inviteCode) return json({ error: 'invite_code_required', code: ERR.VALIDATION_ERROR }, { status: 400 })
  if (!nickname) return json({ error: 'nickname_required', code: ERR.VALIDATION_ERROR }, { status: 400 })

  const stub = roomStub(env, inviteCode)
  const joinResponse = await stub.fetch(internalRequest('/internal/join', {
    method: 'POST',
    body: JSON.stringify({ nickname, playerId: id('player') }),
  }))
  if (!joinResponse.ok) return withCors(joinResponse)

  const payload = await joinResponse.json() as { state: RoomState; player: Player }
  return roomSessionResponse(request, env, payload.state, payload.player)
}

async function roomSessionResponse(request: Request, env: Env, state: RoomState, player: Player): Promise<Response> {
  const token = await signSession(getSessionSecret(env), {
    room_id: state.room_id,
    invite_code: state.invite_code,
    player_id: player.id,
    nickname: player.nickname,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
  })

  return json({
    session: {
      room_id: state.room_id,
      invite_code: state.invite_code,
      player_id: player.id,
      nickname: player.nickname,
      token,
      websocket_url: buildWebSocketUrl(request, env, state.invite_code, token),
    },
    state,
  })
}

export class RoomDurableObject {

  private room: RoomState | null = null
  private isClosingRoom = false
  private roomGeneration = 0
  private persistQueue: Promise<void> = Promise.resolve()
  // WebSocket 速率限制：每个连接每秒最多 30 条消息
  private wsRateLimitMap = new Map<WebSocket, { count: number; resetAt: number }>()

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {
    _corsAllowedOrigin = env.ALLOWED_ORIGIN ?? '*'
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (url.pathname === '/internal/create' && request.method === 'POST') return this.create(request)
      if (url.pathname === '/internal/join' && request.method === 'POST') return this.join(request)
      if (url.pathname === '/internal/export/dhroom' && request.method === 'GET') return this.exportDhRoom()
      if (url.pathname === '/internal/admin/summary' && request.method === 'GET') return this.adminSummary()
      if (url.pathname === '/internal/admin/expiry' && request.method === 'PATCH') return this.updateExpiry(request)
      if (url.pathname.match(/^\/internal\/sheets\/[^/]+\/html$/) && request.method === 'GET') return this.exportSheetHtml(url)

      if (request.headers.get('Upgrade') === 'websocket') return this.connectWebSocket(request)

      return json({ error: 'not_found' }, { status: 404 })
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, { status: error.status })
      }

      return json({ error: 'internal_error', message: messageFrom(error) }, { status: 500 })
    }
  }

  async alarm(): Promise<void> {
    const room = await this.load()
    if (!room) {
      await this.ctx.storage.deleteAlarm()
      return
    }

    if (this.isExpired(room)) {
      await this.purgeRoom('expired')
      return
    }

    await this.scheduleExpiryAlarm(room)
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      await this.handleMessage(socket, message)
    } catch (error) {
      this.sendError(socket, undefined, 'handler_error', messageFrom(error))
    }
  }

  async webSocketClose(socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.disconnect(socket)
  }

  async webSocketError(socket: WebSocket, _error: unknown): Promise<void> {
    await this.disconnect(socket)
  }

  private async create(request: Request): Promise<Response> {
    await this.load()
    if (this.room) {
      if (this.isExpired(this.room)) {
        await this.purgeRoom('expired')
      } else {
        return json({ error: 'room_exists' }, { status: 409 })
      }
    }
    this.isClosingRoom = false

    const body = await request.json() as {
      roomName: string
      inviteCode: string
      playerId: string
      nickname: string
      roomType?: RoomType
    }

    const now = new Date()
    const host = makePlayer(body.playerId, body.nickname, PLAYER_COLORS[0], true, now)
    const roomType = normalizeRoomType(body.roomType)

    this.roomGeneration += 1
    this.room = {
      room_type: roomType,
      room_id: body.inviteCode,
      room_name: body.roomName,
      invite_code: body.inviteCode,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ROOM_TTL_MS).toISOString(),
      host_player_id: host.id,
      players: [host],
      settings: {
        imports_enabled: true,
        resource_change_requires_approval: false,
        battle_panel_visibility: 'shared',
        gm_panel_theme: 'gold-abyss',
      },
      gm_panel: roomType === 'gm-panel' ? createEmptyGmPanelState() : undefined,
      mobile_panel: roomType === 'mobile-panel' ? createEmptyMobilePanelState() : undefined,
      drawing_board: normalizeDrawingBoard(undefined),
      dice_rolls: [],
      x_card: null,
      snapshot_version: 0,
      updated_at: now.toISOString(),
    }

    await this.enqueueSave()
    await this.scheduleExpiryAlarm(this.requireRoom())
    return json({ state: this.publicState(), player: host })
  }

  private async join(request: Request): Promise<Response> {
    const room = await this.mustLoad()
    if (Date.parse(room.expires_at) <= Date.now()) {
      return json({ error: 'room_expired' }, { status: 410 })
    }

    const body = await request.json() as { nickname: string; playerId: string }
    const now = new Date()
    const nickname = cleanText(body.nickname, 'Player', 24)
    const existingPlayer = room.players
      .filter((player) => player.nickname === nickname)
      .sort((left, right) => {
        const leftSeen = Date.parse(left.last_seen_at || left.joined_at)
        const rightSeen = Date.parse(right.last_seen_at || right.joined_at)
        return rightSeen - leftSeen
      })[0]

    if (existingPlayer) {
      existingPlayer.is_online = true
      existingPlayer.last_seen_at = now.toISOString()
      await this.commit('player.rejoined')
      return json({ state: this.publicState(), player: existingPlayer })
    }

    const color = PLAYER_COLORS[room.players.length % PLAYER_COLORS.length]
    const player = makePlayer(body.playerId, nickname, color, false, now)

    room.players.push(player)
    await this.commit('player.joined')

    return json({ state: this.publicState(), player })
  }

  private async adminSummary(): Promise<Response> {
    await this.mustLoad()
    return json(this.getAdminSummary())
  }

  private async updateExpiry(request: Request): Promise<Response> {
    const room = await this.mustLoad()
    const body = await request.json() as { durationDays?: number }
    const durationDays = body.durationDays

    if (
      typeof durationDays !== 'number'
      || !Number.isInteger(durationDays)
      || durationDays < MIN_ROOM_DURATION_DAYS
      || durationDays > MAX_ROOM_DURATION_DAYS
    ) {
      return json({ error: 'invalid_duration_days' }, { status: 400 })
    }

    const now = new Date()
    room.expires_at = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString()
    room.updated_at = now.toISOString()
    room.snapshot_version += 1

    await this.enqueueSave()
    await this.scheduleExpiryAlarm(room)
    this.broadcast({ type: 'room.updated', payload: { state: this.publicState(), reason: 'admin.expiryUpdated' } })

    return json(this.getAdminSummary())
  }

  private async connectWebSocket(request: Request): Promise<Response> {
    const room = await this.mustLoad()
    const url = new URL(request.url)
    const token = url.searchParams.get('token') ?? ''
    const session = await verifySession(getSessionSecret(this.env), token)
    if (!session || session.invite_code !== room.invite_code) {
      return new Response('Invalid session token', { status: 401 })
    }

    const player = room.players.find(item => item.id === session.player_id)
    if (!player) return new Response('Unknown player', { status: 403 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server, [getPlayerTag(player.id)])
    prepareSocketSession(server, player.id, player.nickname)

    player.is_online = true
    player.last_seen_at = new Date().toISOString()
    room.updated_at = new Date().toISOString()
    room.snapshot_version += 1
    await this.enqueueSave()

    server.send(JSON.stringify({
      type: 'room.snapshot',
      payload: { state: this.publicState(), you: { player_id: player.id } },
    }))
    this.broadcast({ type: 'room.updated', payload: { state: this.publicState(), reason: 'player.online' } })

    return new Response(null, { status: 101, webSocket: client })
  }

  private checkWsRateLimit(socket: WebSocket): boolean {
    const now = Date.now()
    const entry = this.wsRateLimitMap.get(socket)
    if (!entry || now >= entry.resetAt) {
      this.wsRateLimitMap.set(socket, { count: 1, resetAt: now + 1_000 })
      return true
    }
    if (entry.count >= 30) return false
    entry.count++
    return true
  }

  private async handleMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    let session: SocketSession
    try {
      session = readSocketSessionAttachment(socket)
    } catch (error) {
      if (error instanceof SocketSessionAttachmentError) {
        this.sendError(
          socket,
          undefined,
          SOCKET_SESSION_ATTACHMENT_ERROR_CODE,
          SOCKET_SESSION_ATTACHMENT_ERROR_MESSAGE,
        )
        try { socket.close(1008, SOCKET_SESSION_ATTACHMENT_ERROR_MESSAGE) } catch { /* ignore */ }
      }
      return
    }

    if (!this.checkWsRateLimit(socket)) {
      this.sendError(socket, undefined, ERR.RATE_LIMITED, '消息发送过于频繁，连接已断开')
      try { socket.close(1008, 'Rate limit exceeded') } catch { /* ignore */ }
      this.wsRateLimitMap.delete(socket)
      return
    }

    const message = typeof data === 'string' ? safeJsonParse(data) as ClientMessage : null
    if (!message || typeof message.type !== 'string') {
      this.sendError(socket, undefined, ERR.VALIDATION_ERROR, 'Message must be JSON with a type')
      return
    }

    let roomBeforeMutation: RoomState | null = null
    try {
      await this.mustLoad()
      if (message.type !== 'ping') roomBeforeMutation = structuredClone(this.room)
      await this.applyMessage(session, message, socket)
    } catch (error) {
      if (roomBeforeMutation) this.room = roomBeforeMutation
      this.sendError(socket, message.requestId, ERR.INTERNAL_ERROR, messageFrom(error))
      return
    }
    if (message.requestId) this.send(socket, { type: 'ack', requestId: message.requestId, payload: { ok: true } })
  }

  private async applyMessage(session: SocketSession, message: ClientMessage, socket: WebSocket): Promise<void> {
    await this.mustLoad()
    const player = this.requirePlayer(session.playerId)

    switch (message.type) {
      case 'ping':
        this.send(socket, { type: 'pong', requestId: message.requestId, payload: { server_time: new Date().toISOString() } })
        return

      case 'room.updateSettings':
        this.updateSettings(message.payload)
        await this.commit('room.updateSettings')
        return

      case 'gm.importHtmlCharacter':
        this.requireGmPanelRoom()
        await this.commit('gm.importHtmlCharacter', {
          htmlPersistence: {
            mode: 'upsert',
            sheetIds: [this.importGmCharacter(player, message.payload.fileName, message.payload.html)],
          },
        })
        return

      case 'gm.replaceHtmlCharacter':
        this.requireGmPanelRoom()
        this.replaceGmCharacter(player, message.payload.sheetId, message.payload.fileName, message.payload.html)
        await this.commit('gm.replaceHtmlCharacter', {
          htmlPersistence: { mode: 'upsert', sheetIds: [message.payload.sheetId] },
        })
        return

      case 'gm.deleteSheet':
        this.requireGmPanelRoom()
        this.deleteGmSheet(player, message.payload.sheetId)
        await this.commit('gm.deleteSheet', {
          htmlPersistence: { mode: 'delete', sheetIds: [message.payload.sheetId] },
        })
        return

      case 'gm.updateSheet':
        this.requireGmPanelRoom()
        this.updateGmSheet(player, message.payload.sheetId, message.payload.sheet)
        await this.commit('gm.updateSheet')
        return

      case 'gm.updateResource':
        this.requireGmPanelRoom()
        this.updateGmResource(player, message.payload.sheetId, message.payload.resourceKey, message.payload.nextValue)
        await this.commit('gm.updateResource')
        return

      case 'gm.updateFear':
        this.requireGmPanelRoom()
        this.updateGmFear(player, message.payload.value)
        await this.commit('gm.updateFear')
        return

      case 'gm.createCountdown':
        this.requireGmPanelRoom()
        this.createGmCountdown(player, message.payload.name, message.payload.max)
        await this.commit('gm.createCountdown')
        return

      case 'gm.updateCountdown':
        this.requireGmPanelRoom()
        this.updateGmCountdown(player, message.payload.countdownId, message.payload.value)
        await this.commit('gm.updateCountdown')
        return

      case 'gm.deleteCountdown':
        this.requireGmPanelRoom()
        this.deleteGmCountdown(player, message.payload.countdownId)
        await this.commit('gm.deleteCountdown')
        return

      case 'gm.moveSheet':
        this.requireGmPanelRoom()
        this.moveGmSheet(player, message.payload.sheetId, message.payload.direction)
        await this.commit('gm.moveSheet')
        return

      case 'gm.updateCardsPerPage':
        this.requireGmPanelRoom()
        this.updateGmCardsPerPage(player, message.payload.cardsPerPage)
        await this.commit('gm.updateCardsPerPage')
        return

      case 'mobile.importCharacterCode':
        this.requireMobilePanelRoom()
        this.importMobileCharacter(player, message.payload.code, message.payload.displayName, message.payload.experiences)
        await this.commit('mobile.importCharacterCode')
        return

      case 'mobile.replaceCharacterCode':
        this.requireMobilePanelRoom()
        this.replaceMobileCharacter(player, message.payload.characterId, message.payload.code)
        await this.commit('mobile.replaceCharacterCode')
        return

      case 'mobile.deleteCharacter':
        this.requireMobilePanelRoom()
        this.deleteMobileCharacter(player, message.payload.characterId)
        await this.commit('mobile.deleteCharacter')
        return

      case 'mobile.updateCharacterCustom':
        this.requireMobilePanelRoom()
        this.updateMobileCharacterCustom(player, message.payload.characterId, message.payload.displayName, message.payload.experiences)
        await this.commit('mobile.updateCharacterCustom')
        return

      case 'mobile.updateResource':
        this.requireMobilePanelRoom()
        this.updateMobileResource(player, message.payload.characterId, message.payload.resourceKey, message.payload.nextValue)
        await this.commit('mobile.updateResource')
        return

      case 'mobile.updateFear':
        this.requireMobilePanelRoom()
        this.updateMobileFear(player, message.payload.value)
        await this.commit('mobile.updateFear')
        return

      case 'mobile.createCountdown':
        this.requireMobilePanelRoom()
        this.createMobileCountdown(player, message.payload.name, message.payload.max)
        await this.commit('mobile.createCountdown')
        return

      case 'mobile.updateCountdown':
        this.requireMobilePanelRoom()
        this.updateMobileCountdown(player, message.payload.countdownId, message.payload.value)
        await this.commit('mobile.updateCountdown')
        return

      case 'mobile.deleteCountdown':
        this.requireMobilePanelRoom()
        this.deleteMobileCountdown(player, message.payload.countdownId)
        await this.commit('mobile.deleteCountdown')
        return

      case 'dice.roll':
        {
          const roll = this.rollDice(player, message.payload)
          await this.commit('dice.roll', {
            waitForPersistence: false,
            message: snapshotVersion => ({
              type: 'dice.rolled',
              payload: { roll, snapshot_version: snapshotVersion },
            }),
          })
        }
        return

      case 'dice.clearHistory':
        this.clearDiceHistory()
        await this.commit('dice.clearHistory', {
          waitForPersistence: false,
          message: snapshotVersion => ({
            type: 'dice.historyCleared',
            payload: { snapshot_version: snapshotVersion },
          }),
        })
        return

      case 'drawing.submit':
        this.requireGmPanelRoom()
        this.submitDrawingBoard(player, message.payload)
        await this.commit('drawing.submit')
        return

      case 'xcard.raise':
        this.raiseXCard(player)
        await this.commit('xcard.raise')
        return

      case 'xcard.acknowledge':
        this.acknowledgeXCard(player)
        await this.commit('xcard.acknowledge')
        return

      case 'room.importRoomBackup': {
        this.requireImportsEnabled()
        const backup = assertDhRoomBackup(message.payload.backup)
        this.importRoomBackup(backup)
        await this.commit('room.importRoomBackup', { htmlPersistence: { mode: 'sync-all' } })
        return
      }
    }
  }

  private importRoomBackup(backup: DhRoomBackup): void {
    const room = this.requireRoom()
    const activePlayers = room.players
    const hostPlayerId = room.host_player_id
    const nicknameToPlayer = new Map(activePlayers.map((player) => [player.nickname, player]))
    const oldPlayerIdToCurrentId = new Map(
      backup.players
        .map((player) => [player.id, nicknameToPlayer.get(player.nickname)?.id] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    )
    const remapPlayerId = (playerId?: string): string | undefined => (
      playerId ? oldPlayerIdToCurrentId.get(playerId) : undefined
    )
    const importedRoomType = normalizeRoomType(backup.room.room_type)

    room.room_type = importedRoomType
    room.room_name = backup.room.name || room.room_name
    room.settings = {
      ...room.settings,
      imports_enabled: backup.settings?.imports_enabled ?? true,
      resource_change_requires_approval: backup.settings?.resource_change_requires_approval ?? room.settings.resource_change_requires_approval,
      battle_panel_visibility: backup.settings?.battle_panel_visibility ?? room.settings.battle_panel_visibility,
      gm_panel_theme: backup.settings?.gm_panel_theme ?? room.settings.gm_panel_theme,
    }

    if (importedRoomType === 'gm-panel') {
      const panel = normalizeGmPanelStateWithHtml(structuredClone(backup.gm_panel))
      room.gm_panel = {
        ...panel,
        activity_log: panel.activity_log.map((item) => ({
          ...item,
          actor_player_id: remapPlayerId(item.actor_player_id),
        })),
      }
      room.mobile_panel = undefined
    } else if (importedRoomType === 'mobile-panel') {
      const panel = normalizeMobilePanelState(structuredClone(backup.mobile_panel))
      room.gm_panel = undefined
      room.mobile_panel = {
        ...panel,
        activity_log: panel.activity_log.map((item) => ({
          ...item,
          actor_player_id: remapPlayerId(item.actor_player_id),
        })),
      }
    } else {
      room.gm_panel = undefined
      room.mobile_panel = undefined
    }
    room.dice_rolls = Array.isArray(backup.dice_rolls)
      ? backup.dice_rolls.slice(-50).map((roll) => ({
        ...roll,
        actor_player_id: remapPlayerId(roll.actor_player_id) ?? roll.actor_player_id,
      }))
      : []
    room.drawing_board = normalizeDrawingBoard(backup.drawing_board)
    room.host_player_id = hostPlayerId
    room.x_card = null
    room.players = activePlayers.map((player) => ({
      ...player,
      is_host: player.id === hostPlayerId,
    }))
  }

  private updateSettings(updates: {
    importsEnabled?: boolean
    resourceChangeRequiresApproval?: boolean
    gmPanelTheme?: 'gold-abyss' | 'jade-hex' | 'amethyst-ember'
  }): void {
    const room = this.requireRoom()
    room.settings = {
      ...room.settings,
      ...(updates.importsEnabled !== undefined ? { imports_enabled: updates.importsEnabled } : {}),
      ...(updates.resourceChangeRequiresApproval !== undefined
        ? { resource_change_requires_approval: updates.resourceChangeRequiresApproval }
        : {}),
      ...(updates.gmPanelTheme !== undefined ? { gm_panel_theme: updates.gmPanelTheme } : {}),
    }
  }

  private rollDice(player: Player, request: DiceRollRequest): DiceRollRecord {
    const room = this.requireRoom()
    const rolled = rollDicePool(request, secureDiceRandom)
    const record: DiceRollRecord = {
      id: id('dice_roll'),
      created_at: new Date().toISOString(),
      actor_player_id: player.id,
      actor_name: player.nickname,
      normalized_formula: rolled.normalizedFormula,
      request: rolled.request,
      mode: rolled.request.mode,
      modifier_mode: rolled.request.modifier_mode,
      results: rolled.results,
    }

    room.dice_rolls = [...(Array.isArray(room.dice_rolls) ? room.dice_rolls : []), record].slice(-50)
    return record
  }

  private clearDiceHistory(): void {
    const room = this.requireRoom()
    room.dice_rolls = []
  }

  private submitDrawingBoard(player: Player, request: DrawingBoardSubmitRequest): void {
    const room = this.requireRoom()
    room.drawing_board = normalizeDrawingBoard({
      shapes: request.shapes,
      updated_at: new Date().toISOString(),
      updated_by_player_id: player.id,
      updated_by_name: player.nickname,
    })
  }

  private raiseXCard(player: Player): void {
    const room = this.requireRoom()
    // 匿名：不记录是谁打出的 X 卡。打出者自动计入已读，避免要求自己确认。
    room.x_card = {
      id: id('xcard'),
      created_at: new Date().toISOString(),
      acknowledged_player_ids: [player.id],
    }
    this.clearXCardIfAllAcknowledged()
  }

  private acknowledgeXCard(player: Player): void {
    const room = this.requireRoom()
    if (!room.x_card) return
    if (!room.x_card.acknowledged_player_ids.includes(player.id)) {
      room.x_card.acknowledged_player_ids.push(player.id)
    }
    this.clearXCardIfAllAcknowledged()
  }

  /** 当所有在线玩家都已点击「已读」后，关闭 X 卡提示。 */
  private clearXCardIfAllAcknowledged(): void {
    const room = this.requireRoom()
    if (!room.x_card) return
    const acknowledged = new Set(room.x_card.acknowledged_player_ids)
    const onlinePlayers = room.players.filter((item) => item.is_online)
    const allAcknowledged = onlinePlayers.length > 0
      && onlinePlayers.every((item) => acknowledged.has(item.id))
    if (allAcknowledged) {
      room.x_card = null
    }
  }

  private importGmCharacter(player: Player, fileName: string, html: string): string {
    const panel = this.requireGmPanelState()
    const entry = createGmSheetEntry(fileName, html)
    panel.sheets.push(entry)
    panel.sheet_order.push(entry.id)
    this.appendGmLog('sheet-import', `${player.nickname} 导入了角色卡 ${entry.parsed_sheet.character_name || entry.source_file_name}`, player)
    return entry.id
  }

  private replaceGmCharacter(player: Player, sheetId: string, fileName: string, html: string): void {
    const entry = this.requireGmSheet(sheetId)
    const nextEntry = createGmSheetEntry(fileName, html, entry.id, entry.imported_at)
    entry.updated_at = nextEntry.updated_at
    entry.html_updated_at = nextEntry.html_updated_at
    entry.source_file_name = nextEntry.source_file_name
    entry.source_format = nextEntry.source_format
    entry.source_html = nextEntry.source_html
    entry.compiled_html = nextEntry.compiled_html
    entry.raw_character_data = nextEntry.raw_character_data
    entry.parsed_sheet = nextEntry.parsed_sheet
    this.appendGmLog('sheet-replace', `${player.nickname} 替换了角色卡 ${entry.parsed_sheet.character_name || entry.source_file_name}`, player)
  }

  private deleteGmSheet(player: Player, sheetId: string): void {
    const panel = this.requireGmPanelState()
    const sheetIndex = panel.sheets.findIndex((item) => item.id === sheetId)
    if (sheetIndex < 0) throw new Error('Unknown character sheet')

    const [entry] = panel.sheets.splice(sheetIndex, 1)
    panel.sheet_order = panel.sheet_order.filter((id) => id !== sheetId)
    this.appendGmLog('sheet-delete', `${player.nickname} 删除了角色卡 ${entry.parsed_sheet.character_name || entry.source_file_name}`, player)
  }

  private updateGmSheet(player: Player, sheetId: string, sheet: ResourceTrackerSheet): void {
    const entry = this.requireGmSheet(sheetId)
    entry.parsed_sheet = normalizeResourceTrackerSheet(sheet, sheet.file_name)
    entry.updated_at = new Date().toISOString()
    this.appendGmLog('sheet-change', `${player.nickname} 更新了 ${entry.parsed_sheet.character_name} 的详细信息`, player)
  }

  private updateGmResource(
    player: Player,
    sheetId: string,
    resourceKey: GmPanelResourceKey,
    nextValue: number | boolean[],
  ): void {
    const entry = this.requireGmSheet(sheetId)
    const currentValue = cloneTrackerResourceValue(getTrackerResourceValue(entry.parsed_sheet, resourceKey))
    const normalizedValue = normalizeTrackerResourceValue(entry.parsed_sheet, resourceKey, nextValue)
    const displayCurrentValue =
      resourceKey === 'armor_slots' && Array.isArray(currentValue) && Array.isArray(normalizedValue)
        ? normalizeBooleanTrack(currentValue, normalizedValue.length)
        : currentValue

    if (isTrackerResourceValueEqual(currentValue, normalizedValue)) {
      return
    }

    setTrackerResourceValue(entry.parsed_sheet, resourceKey, normalizedValue)
    entry.updated_at = new Date().toISOString()
    this.appendGmLog(
      'resource-change',
      `${player.nickname} 将 ${entry.parsed_sheet.character_name} 的 ${getTrackerResourceLabel(resourceKey)}从 ${formatTrackerResourceValue(displayCurrentValue)} 调整为 ${formatTrackerResourceValue(normalizedValue)}`,
      player,
    )
  }

  private updateGmFear(player: Player, value: number): void {
    const panel = this.requireGmPanelState()
    const previous = panel.fear.value
    panel.fear.value = clamp(Math.round(finiteNumber(value, previous)), 0, panel.fear.max)
    if (previous !== panel.fear.value) {
      this.appendGmLog('fear-change', `${player.nickname} 将恐惧点从 ${previous} 调整为 ${panel.fear.value}`, player)
    }
  }

  private createGmCountdown(player: Player, name: string, max: number): void {
    const panel = this.requireGmPanelState()
    const normalizedMax = clamp(Math.round(finiteNumber(max, 4)), 2, 12)
    const normalizedName = cleanText(name, `进度钟 ${panel.countdowns.length + 1}`, 40)
    const now = new Date().toISOString()

    panel.countdowns.push({
      id: id('gm_clock'),
      name: normalizedName,
      value: 0,
      max: normalizedMax,
      created_at: now,
      updated_at: now,
    })

    this.appendGmLog('countdown-create', `${player.nickname} 新增了进度钟“${normalizedName}” (0/${normalizedMax})`, player)
  }

  private updateGmCountdown(player: Player, countdownId: string, value: number): void {
    const countdown = this.requireGmCountdown(countdownId)
    const previous = countdown.value
    countdown.value = clamp(Math.round(finiteNumber(value, previous)), 0, countdown.max)

    if (previous === countdown.value) {
      return
    }

    countdown.updated_at = new Date().toISOString()
    this.appendGmLog(
      'countdown-update',
      `${player.nickname} 将进度钟“${countdown.name}”从 ${previous}/${countdown.max} 调整为 ${countdown.value}/${countdown.max}`,
      player,
    )
  }

  private deleteGmCountdown(player: Player, countdownId: string): void {
    const panel = this.requireGmPanelState()
    const countdownIndex = panel.countdowns.findIndex((item) => item.id === countdownId)
    if (countdownIndex < 0) throw new Error('Unknown countdown')

    const [countdown] = panel.countdowns.splice(countdownIndex, 1)
    this.appendGmLog('countdown-delete', `${player.nickname} 删除了进度钟“${countdown.name}”`, player)
  }

  private moveGmSheet(player: Player, sheetId: string, direction: 'left' | 'right'): void {
    const panel = this.requireGmPanelState()
    const currentIndex = panel.sheet_order.indexOf(sheetId)
    if (currentIndex < 0) throw new Error('Unknown character sheet')

    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= panel.sheet_order.length) return

    const [movedId] = panel.sheet_order.splice(currentIndex, 1)
    panel.sheet_order.splice(targetIndex, 0, movedId)

    const sheet = this.requireGmSheet(sheetId)
    this.appendGmLog('sheet-reorder', `${player.nickname} 调整了 ${sheet.parsed_sheet.character_name} 的顺序`, player)
  }

  private updateGmCardsPerPage(player: Player, cardsPerPage: number): void {
    const panel = this.requireGmPanelState()
    const nextValue = clamp(Math.round(finiteNumber(cardsPerPage, panel.cards_per_page)), 2, 4)
    if (panel.cards_per_page === nextValue) return
    panel.cards_per_page = nextValue
    this.appendGmLog('system', `${player.nickname} 将每页角色卡数量调整为 ${nextValue}`, player)
  }

  private appendGmLog(
    kind: GmPanelActivityLogItem['kind'],
    message: string,
    actor?: Player,
  ): void {
    const panel = this.requireGmPanelState()
    panel.activity_log.push({
      id: id('gm_log'),
      created_at: new Date().toISOString(),
      actor_player_id: actor?.id,
      actor_name: actor?.nickname ?? '系统',
      kind,
      message: repairKnownGmLogMessage(message),
    })

    if (panel.activity_log.length > 200) {
      panel.activity_log = panel.activity_log.slice(-200)
    }
  }

  private importMobileCharacter(
    player: Player,
    code: string,
    displayName: string,
    experiences: MobilePanelExperience[],
  ): void {
    const panel = this.requireMobilePanelState()
    const now = new Date().toISOString()
    const entry = createMobilePanelCharacterEntry(code, displayName, experiences, now)
    panel.characters.push(entry)
    panel.character_order.push(entry.id)
    this.appendMobileLog('character-import', `${player.nickname} 导入了角色 ${getMobilePanelCharacterLabel(entry)}`, player)
  }

  private replaceMobileCharacter(player: Player, characterId: string, code: string): void {
    const entry = this.requireMobileCharacter(characterId)
    const nextDecoded = decodeMobilePanelCharacterCode(cleanText(code, '', 20_000))
    const previousLabel = getMobilePanelCharacterLabel(entry)
    entry.source.code = cleanText(code, '', 20_000)
    entry.source.updated_at = new Date().toISOString()
    entry.decoded = nextDecoded
    entry.tracker = normalizeMobilePanelTracker(entry.tracker, nextDecoded)
    this.appendMobileLog('character-replace', `${player.nickname} 替换了角色码 ${previousLabel}`, player)
  }

  private deleteMobileCharacter(player: Player, characterId: string): void {
    const panel = this.requireMobilePanelState()
    const characterIndex = panel.characters.findIndex((item) => item.id === characterId)
    if (characterIndex < 0) throw new Error('Unknown mobile character')

    const [entry] = panel.characters.splice(characterIndex, 1)
    panel.character_order = panel.character_order.filter((idValue) => idValue !== characterId)
    this.appendMobileLog('character-delete', `${player.nickname} 删除了角色 ${getMobilePanelCharacterLabel(entry)}`, player)
  }

  private updateMobileCharacterCustom(
    player: Player,
    characterId: string,
    displayName: string,
    experiences: MobilePanelExperience[],
  ): void {
    const entry = this.requireMobileCharacter(characterId)
    entry.custom = normalizeMobilePanelCustom(displayName, experiences)
    this.appendMobileLog('character-update', `${player.nickname} 更新了角色 ${getMobilePanelCharacterLabel(entry)} 的自定义信息`, player)
  }

  private updateMobileResource(
    player: Player,
    characterId: string,
    resourceKey: MobilePanelResourceKey,
    nextValue: number | boolean[],
  ): void {
    const entry = this.requireMobileCharacter(characterId)
    const currentValue = cloneMobilePanelResourceValue(getMobilePanelResourceValue(entry, resourceKey))
    const normalizedValue = normalizeMobilePanelResourceValue(entry, resourceKey, nextValue)

    if (isMobilePanelResourceValueEqual(currentValue, normalizedValue)) {
      return
    }

    setMobilePanelResourceValue(entry, resourceKey, normalizedValue)
    this.appendMobileLog(
      'resource-change',
      `${player.nickname} 将 ${getMobilePanelCharacterLabel(entry)} 的${getMobilePanelResourceLabel(resourceKey)}从 ${formatMobilePanelResourceValue(currentValue)} 调整为 ${formatMobilePanelResourceValue(normalizedValue)}`,
      player,
    )
  }

  private updateMobileFear(player: Player, value: number): void {
    const panel = this.requireMobilePanelState()
    const previous = panel.fear.value
    panel.fear.value = clamp(Math.round(finiteNumber(value, previous)), 0, panel.fear.max)
    if (previous !== panel.fear.value) {
      this.appendMobileLog('fear-change', `${player.nickname} 将恐惧点从 ${previous} 调整为 ${panel.fear.value}`, player)
    }
  }

  private createMobileCountdown(player: Player, name: string, max: number): void {
    const panel = this.requireMobilePanelState()
    const normalizedMax = clamp(Math.round(finiteNumber(max, 4)), 2, 12)
    const normalizedName = cleanText(name, `进度钟 ${panel.countdowns.length + 1}`, 40)
    const now = new Date().toISOString()

    panel.countdowns.push({
      id: id('mobile_clock'),
      name: normalizedName,
      value: 0,
      max: normalizedMax,
      created_at: now,
      updated_at: now,
    })

    this.appendMobileLog('countdown-create', `${player.nickname} 新增了进度钟“${normalizedName}” (0/${normalizedMax})`, player)
  }

  private updateMobileCountdown(player: Player, countdownId: string, value: number): void {
    const countdown = this.requireMobileCountdown(countdownId)
    const previous = countdown.value
    countdown.value = clamp(Math.round(finiteNumber(value, previous)), 0, countdown.max)
    if (previous === countdown.value) {
      return
    }

    countdown.updated_at = new Date().toISOString()
    this.appendMobileLog(
      'countdown-update',
      `${player.nickname} 将进度钟“${countdown.name}”从 ${previous}/${countdown.max} 调整为 ${countdown.value}/${countdown.max}`,
      player,
    )
  }

  private deleteMobileCountdown(player: Player, countdownId: string): void {
    const panel = this.requireMobilePanelState()
    const countdownIndex = panel.countdowns.findIndex((item) => item.id === countdownId)
    if (countdownIndex < 0) throw new Error('Unknown countdown')

    const [countdown] = panel.countdowns.splice(countdownIndex, 1)
    this.appendMobileLog('countdown-delete', `${player.nickname} 删除了进度钟“${countdown.name}”`, player)
  }

  private appendMobileLog(
    kind: MobilePanelActivityLogItem['kind'],
    message: string,
    actor?: Player,
  ): void {
    const panel = this.requireMobilePanelState()
    panel.activity_log.push({
      id: id('mobile_log'),
      created_at: new Date().toISOString(),
      actor_player_id: actor?.id,
      actor_name: actor?.nickname ?? '系统',
      kind,
      message,
    })

    if (panel.activity_log.length > 200) {
      panel.activity_log = panel.activity_log.slice(-200)
    }
  }

  private async disconnect(socket: WebSocket): Promise<void> {
    if (this.isClosingRoom) return

    let session: SocketSession
    try {
      session = readSocketSessionAttachment(socket)
    } catch (error) {
      if (!(error instanceof SocketSessionAttachmentError)) throw error
      return
    }

    if (this.hasOtherPlayerSocket(session.playerId, socket)) {
      return
    }

    const room = await this.load()
    if (this.hasOtherPlayerSocket(session.playerId, socket)) {
      return
    }

    const player = room?.players.find(item => item.id === session.playerId)
    if (!room || !player) return
    if (!player.is_online) return

    player.is_online = false
    player.last_seen_at = new Date().toISOString()
    this.transferHostIfNeeded()
    // 离线玩家不应再阻塞 X 卡：若剩余在线玩家均已确认则关闭提示。
    this.clearXCardIfAllAcknowledged()
    await this.commit('player.offline')
  }

  private hasOtherPlayerSocket(playerId: string, excludedSocket: WebSocket): boolean {
    return this.ctx.getWebSockets(getPlayerTag(playerId)).some(socket => socket !== excludedSocket)
  }

  private transferHostIfNeeded(): void {
    const room = this.requireRoom()
    const host = room.players.find(player => player.id === room.host_player_id)
    if (host?.is_online) return

    const nextHost = room.players.find(player => player.is_online)
    if (!nextHost) return

    room.host_player_id = nextHost.id
    room.players = room.players.map(player => ({ ...player, is_host: player.id === nextHost.id }))
  }

  private async exportDhRoom(): Promise<Response> {
    const room = await this.mustLoad()
    const backup: DhRoomBackup = {
      format: 'dhroom',
      version: 1,
      room: {
        id: room.room_id,
        name: room.room_name,
        room_type: room.room_type,
        invite_code: room.invite_code,
        created_at: room.created_at,
        expires_at: room.expires_at,
      },
      settings: room.settings,
      gm_panel: room.gm_panel,
      mobile_panel: room.mobile_panel,
      drawing_board: room.drawing_board,
      dice_rolls: room.dice_rolls,
      players: room.players.map(player => ({
        id: player.id,
        nickname: player.nickname,
        color: player.color,
        is_host: player.id === room.host_player_id,
        is_online: player.is_online,
      })),
      exported_at: new Date().toISOString(),
    }

    return json(backup)
  }

  private async exportSheetHtml(url: URL): Promise<Response> {
    const room = await this.mustLoad()
    const sheetId = decodeURIComponent(url.pathname.split('/')[3] ?? '')
    const entry = room.gm_panel?.sheets.find((sheet) => sheet.id === sheetId)

    if (!entry) {
      return new Response('Sheet not found', { status: 404 })
    }

    const html = entry.compiled_html || entry.source_html

    if (!html) {
      return new Response('Sheet HTML unavailable', { status: 404 })
    }

    return withCors(new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    }))
  }

  private async commit(reason: string, options: {
    waitForPersistence?: boolean
    message?: (snapshotVersion: number) => ServerMessage
    htmlPersistence?: HtmlPersistence
  } = {}): Promise<void> {
    const room = this.requireRoom()
    room.updated_at = new Date().toISOString()
    room.snapshot_version += 1
    const persistPromise = this.enqueueSave(options.htmlPersistence)
    const updateMessage: ServerMessage = options.message?.(room.snapshot_version)
      ?? { type: 'room.updated', payload: { state: this.publicState(), reason } }

    if (options.waitForPersistence === false) {
      this.broadcast(updateMessage)
      this.ctx.waitUntil(persistPromise.catch(() => undefined))
      return
    }

    await persistPromise
    this.broadcast(updateMessage)
  }

  private enqueueSave(htmlPersistence?: HtmlPersistence): Promise<void> {
    const job = this.capturePersistenceJob(htmlPersistence)
    const persistPromise = this.persistQueue.then(
      () => this.saveRoomSnapshot(job),
      () => this.saveRoomSnapshot(job),
    )
    this.persistQueue = persistPromise.catch((error) => {
      console.error('Room persistence failed', error)
    })
    return persistPromise
  }

  private capturePersistenceJob(htmlPersistence?: HtmlPersistence): RoomPersistenceJob {
    const room = this.requireRoom()
    const snapshot = structuredClone(room)
    const generation = this.roomGeneration
    if (snapshot.gm_panel) {
      snapshot.gm_panel.sheets = snapshot.gm_panel.sheets.map((sheet) => {
        const { source_html: _sourceHtml, compiled_html: _compiledHtml, ...rest } = sheet
        return rest
      })
    }

    if (!htmlPersistence) return { generation, snapshot }
    if (htmlPersistence.mode === 'delete') {
      return {
        generation,
        snapshot,
        html: { mode: 'delete', sheetIds: [...new Set(htmlPersistence.sheetIds)] },
      }
    }

    const sheetIds = htmlPersistence.mode === 'upsert'
      ? new Set(htmlPersistence.sheetIds)
      : null
    const sheets = (room.gm_panel?.sheets ?? [])
      .filter((sheet) => !sheetIds || sheetIds.has(sheet.id))
      .map((sheet) => ({
        id: sheet.id,
        sourceHtml: sheet.source_html,
        compiledHtml: sheet.compiled_html,
      }))

    return {
      generation,
      snapshot,
      html: htmlPersistence.mode === 'sync-all'
        ? { mode: 'sync-all', sheets }
        : { mode: 'upsert', sheets },
    }
  }

  private async load(): Promise<RoomState | null> {
    if (this.room) return this.room
    const storedRoom = await this.ctx.storage.get<RoomState>('room') ?? null
    this.room = storedRoom ? this.migrateRoomState(storedRoom) : null
    if (this.room) {
      await this.hydrateStoredGmSheetHtml(this.room)
    }
    if (this.room && !this.isExpired(this.room)) {
      await this.scheduleExpiryAlarm(this.room)
    }
    return this.room
  }

  private async mustLoad(): Promise<RoomState> {
    const room = await this.load()
    if (!room) throw new HttpError(404, 'room_not_found')
    if (this.isExpired(room)) {
      await this.purgeRoom('expired')
      throw new HttpError(410, 'room_expired')
    }
    return room
  }

  private async saveRoomSnapshot(job: RoomPersistenceJob): Promise<void> {
    if (job.generation !== this.roomGeneration) return
    await this.ctx.storage.transaction(async (txn) => {
      await txn.put('room', job.snapshot)
      if (job.html) await this.syncGmSheetHtml(txn, job.html)
    })
  }

  private async syncGmSheetHtml(
    txn: DurableObjectTransaction,
    html: NonNullable<RoomPersistenceJob['html']>,
  ): Promise<void> {
    if (html.mode === 'delete') {
      for (const sheetId of html.sheetIds) {
        await txn.delete(getGmSheetHtmlStorageKey(sheetId))
        await txn.delete(getGmSheetCompiledHtmlStorageKey(sheetId))
      }
      return
    }

    for (const sheet of html.sheets) {
      await this.persistGmSheetHtml(txn, sheet)
    }
    if (html.mode !== 'sync-all') return

    const activeSourceKeys = new Set(
      html.sheets.filter((sheet) => sheet.sourceHtml).map((sheet) => getGmSheetHtmlStorageKey(sheet.id)),
    )
    const activeCompiledKeys = new Set(
      html.sheets.filter((sheet) => sheet.compiledHtml).map((sheet) => getGmSheetCompiledHtmlStorageKey(sheet.id)),
    )
    const storedSource = await txn.list<string>({ prefix: GM_SHEET_HTML_STORAGE_KEY_PREFIX })
    for (const key of storedSource.keys()) {
      if (!activeSourceKeys.has(key)) await txn.delete(key)
    }
    const storedCompiled = await txn.list<string>({ prefix: GM_SHEET_COMPILED_HTML_STORAGE_KEY_PREFIX })
    for (const key of storedCompiled.keys()) {
      if (!activeCompiledKeys.has(key)) await txn.delete(key)
    }
  }

  private async persistGmSheetHtml(txn: DurableObjectTransaction, sheet: PersistedSheetHtml): Promise<void> {
    const sourceKey = getGmSheetHtmlStorageKey(sheet.id)
    if (sheet.sourceHtml) await txn.put(sourceKey, sheet.sourceHtml)
    else await txn.delete(sourceKey)

    const compiledKey = getGmSheetCompiledHtmlStorageKey(sheet.id)
    if (sheet.compiledHtml) await txn.put(compiledKey, sheet.compiledHtml)
    else await txn.delete(compiledKey)
  }

  private async hydrateStoredGmSheetHtml(room: RoomState): Promise<void> {
    const sheets = room.gm_panel?.sheets ?? []
    const pendingSheets = sheets.filter((sheet) => !sheet.source_html || !sheet.compiled_html)

    if (!pendingSheets.length) {
      return
    }

    await Promise.all(pendingSheets.map(async (sheet) => {
      const [html, compiledHtml] = await Promise.all([
        this.ctx.storage.get<string>(getGmSheetHtmlStorageKey(sheet.id)),
        this.ctx.storage.get<string>(getGmSheetCompiledHtmlStorageKey(sheet.id)),
      ])
      if (!sheet.source_html && typeof html === 'string' && html) {
        sheet.source_html = html
      }
      if (!sheet.compiled_html && typeof compiledHtml === 'string' && compiledHtml) {
        sheet.compiled_html = compiledHtml
      }

      if (sheet.source_html) {
        applyHtmlResourceTracksToSheet(sheet.source_html, sheet.parsed_sheet)
        sheet.compiled_html = compileGmSheetHtml(sheet.source_html, sheet.parsed_sheet)
      }
    }))
  }

  private publicState(): RoomState {
    const snapshot = structuredClone(this.requireRoom())
    if (snapshot.gm_panel) {
      snapshot.gm_panel.sheets = snapshot.gm_panel.sheets.map((sheet) => {
        const { source_html: _sourceHtml, compiled_html: _compiledHtml, ...rest } = sheet
        return rest
      })
    }
    return snapshot
  }

  private getAdminSummary(): AdminRoomSummary {
    const room = this.requireRoom()
    return {
      room_id: room.room_id,
      room_name: room.room_name,
      room_type: room.room_type,
      invite_code: room.invite_code,
      created_at: room.created_at,
      expires_at: room.expires_at,
      updated_at: room.updated_at,
      player_count: room.players.length,
      online_player_count: room.players.filter((player) => player.is_online).length,
    }
  }

  private isExpired(room: Pick<RoomState, 'expires_at'>): boolean {
    return Date.parse(room.expires_at) <= Date.now()
  }

  private async scheduleExpiryAlarm(room: Pick<RoomState, 'expires_at'>): Promise<void> {
    const expiresAt = Date.parse(room.expires_at)
    if (!Number.isFinite(expiresAt)) return

    const currentAlarm = await this.ctx.storage.getAlarm()
    if (currentAlarm !== expiresAt) {
      await this.ctx.storage.setAlarm(expiresAt)
    }
  }

  private async purgeRoom(reason: 'expired'): Promise<void> {
    this.roomGeneration += 1
    this.isClosingRoom = true
    const sockets = this.ctx.getWebSockets()

    for (const socket of sockets) {
      try {
        socket.close(1001, reason === 'expired' ? 'Room expired' : 'Room closed')
      } catch {
        // Ignore close errors while tearing down the room.
      }
    }

    this.room = null
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  private requireRoom(): RoomState {
    if (!this.room) throw new Error('Room is not loaded')
    return this.room
  }

  private migrateRoomState(room: RoomState): RoomState {
    const migrated = room as RoomState & {
      room_type?: RoomType
      gm_panel?: GmPanelState
      mobile_panel?: MobilePanelState
      settings?: {
        imports_enabled?: boolean
        resource_change_requires_approval?: boolean
        gm_panel_theme?: 'gold-abyss' | 'jade-hex' | 'amethyst-ember'
      }
      drawing_board?: RoomState['drawing_board']
      dice_rolls?: DiceRollRecord[]
      x_card?: RoomState['x_card']
    }

    return {
      ...migrated,
      x_card: migrated.x_card ?? null,
      settings: {
        imports_enabled: migrated.settings?.imports_enabled ?? true,
        resource_change_requires_approval: migrated.settings?.resource_change_requires_approval ?? false,
        battle_panel_visibility: 'shared',
        gm_panel_theme: migrated.settings?.gm_panel_theme ?? 'gold-abyss',
      },
      room_type: normalizeRoomType(migrated.room_type),
      gm_panel: normalizeRoomType(migrated.room_type) === 'gm-panel'
        ? normalizeGmPanelState(migrated.gm_panel)
        : undefined,
      mobile_panel: normalizeRoomType(migrated.room_type) === 'mobile-panel'
        ? normalizeMobilePanelState(migrated.mobile_panel)
        : undefined,
      drawing_board: normalizeDrawingBoard(migrated.drawing_board),
      dice_rolls: Array.isArray(migrated.dice_rolls) ? migrated.dice_rolls.slice(-50) : [],
    }
  }

  private requirePlayer(playerId: string): Player {
    const player = this.requireRoom().players.find(item => item.id === playerId)
    if (!player) throw new Error('Unknown player')
    return player
  }

  private requireGmPanelRoom(): void {
    if (this.requireRoom().room_type !== 'gm-panel') {
      throw new Error('GM panel room required')
    }
  }

  private requireGmPanelState(): GmPanelState {
    const room = this.requireRoom()
    if (room.room_type !== 'gm-panel') {
      throw new Error('GM panel room required')
    }
    room.gm_panel ??= createEmptyGmPanelState()
    return room.gm_panel
  }

  private requireMobilePanelRoom(): void {
    if (this.requireRoom().room_type !== 'mobile-panel') {
      throw new Error('Mobile panel room required')
    }
  }

  private requireMobilePanelState(): MobilePanelState {
    const room = this.requireRoom()
    if (room.room_type !== 'mobile-panel') {
      throw new Error('Mobile panel room required')
    }
    room.mobile_panel ??= createEmptyMobilePanelState()
    return room.mobile_panel
  }

  private requireGmSheet(sheetId: string): GmPanelCharacterSheetEntry {
    const panel = this.requireGmPanelState()
    const entry = panel.sheets.find((item) => item.id === sheetId)
    if (!entry) throw new Error('Unknown character sheet')
    return entry
  }

  private requireMobileCharacter(characterId: string): MobilePanelCharacterEntry {
    const panel = this.requireMobilePanelState()
    const entry = panel.characters.find((item) => item.id === characterId)
    if (!entry) throw new Error('Unknown mobile character')
    return entry
  }

  private requireGmCountdown(countdownId: string): ResourceTrackerCountdown {
    const panel = this.requireGmPanelState()
    const countdown = panel.countdowns.find((item) => item.id === countdownId)
    if (!countdown) throw new Error('Unknown countdown')
    return countdown
  }

  private requireMobileCountdown(countdownId: string): ResourceTrackerCountdown {
    const panel = this.requireMobilePanelState()
    const countdown = panel.countdowns.find((item) => item.id === countdownId)
    if (!countdown) throw new Error('Unknown countdown')
    return countdown
  }

  private requireImportsEnabled(): void {
    if (!this.requireRoom().settings.imports_enabled) {
      throw new Error('Import feature is disabled in room settings')
    }
  }

  private send(socket: WebSocket, message: unknown): void {
    socket.send(JSON.stringify(message))
  }

  private sendError(socket: WebSocket, requestId: string | undefined, code: string, message: string): void {
    this.send(socket, { type: 'error', requestId, payload: { code, message } })
  }

  private broadcast(message: unknown): void {
    const encoded = JSON.stringify(message)
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(encoded)
      } catch {
        try {
          socket.close(1011, 'Broadcast failed')
        } catch {
          // The runtime will remove an already-closed socket from getWebSockets().
        }
      }
    }
  }

}

// _repairKnownGmLogMessage_STUB (('鍒犻櫎浜嗚鑹插崱', '删除了角色卡')
function getGmSheetHtmlStorageKey(sheetId: string): string {
  return `${GM_SHEET_HTML_STORAGE_KEY_PREFIX}${sheetId}`
}

function getGmSheetCompiledHtmlStorageKey(sheetId: string): string {
  return `${GM_SHEET_COMPILED_HTML_STORAGE_KEY_PREFIX}${sheetId}`
}

function roomStub(env: Env, inviteCode: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(inviteCode))
}

function internalRequest(pathname: string, init?: RequestInit): Request {
  return new Request(`https://room.local${pathname}`, init)
}

function buildWebSocketUrl(request: Request, env: Env, inviteCode: string, token: string): string {
  const forwardedHost = request.headers.get('X-Forwarded-Host')
  const base = env.PUBLIC_API_BASE ?? (forwardedHost ? `https://${forwardedHost}` : request.url)
  const url = new URL(base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/rooms/${inviteCode}/ws`
  url.search = new URLSearchParams({ token }).toString()
  return url.toString()
}

const secureDiceRandom = {
  nextInt: secureRandomInt,
}

function secureRandomInt(exclusiveMax: number): number {
  if (!Number.isInteger(exclusiveMax) || exclusiveMax <= 0 || exclusiveMax > 0x1_0000_0000) {
    throw new Error('随机上限必须是正整数')
  }

  const value = new Uint32Array(1)
  const limit = Math.floor(0x1_0000_0000 / exclusiveMax) * exclusiveMax
  do {
    crypto.getRandomValues(value)
  } while (value[0] >= limit)

  return value[0] % exclusiveMax
}

function getSessionSecret(env: Env): string {
  return env.SESSION_SECRET?.trim() || 'dhgc-local-dev-session-secret'
}

async function authorizeAdmin(request: Request, env: Env): Promise<Response | null> {
  const expectedSecret = env.ADMIN_SECRET?.trim()
  if (!expectedSecret) {
    return json({
      error: 'admin_not_configured',
      code: ERR.INTERNAL_ERROR,
      message: 'ADMIN_SECRET is not configured',
    }, { status: 503 })
  }

  const authorization = request.headers.get('authorization') ?? ''
  const providedSecret = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''

  if (!providedSecret || !(await secretsMatch(expectedSecret, providedSecret))) {
    return json({ error: 'unauthorized', code: ERR.UNAUTHORIZED }, {
      status: 401,
      headers: { 'www-authenticate': 'Bearer' },
    })
  }

  return null
}

async function secretsMatch(expected: string, actual: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [expectedDigest, actualDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
  ])
  return crypto.subtle.timingSafeEqual(expectedDigest, actualDigest)
}

async function signSession(secret: string, payload: SessionPayload): Promise<string> {
  const body = base64UrlEncode(JSON.stringify(payload))
  const signature = await hmac(secret, body)
  return `${body}.${signature}`
}

async function verifySession(secret: string, token: string): Promise<SessionPayload | null> {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  const expected = await hmac(secret, body)
  if (signature !== expected) return null
  const payload = JSON.parse(base64UrlDecode(body)) as SessionPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return base64UrlEncodeBytes(new Uint8Array(signature))
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value))
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlDecode(value: string): string {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return withCors(new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  }))
}

function emptyCors(): Response {
  return withCors(new Response(null, { status: 204 }))
}

function withCors(response: Response): Response {
  const next = new Response(response.body, response)
  next.headers.set('access-control-allow-origin', _corsAllowedOrigin)
  next.headers.set('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS')
  next.headers.set('access-control-allow-headers', 'content-type,authorization')
  return next
}

function withAdminHeaders(response: Response): Response {
  const next = withCors(response)
  next.headers.set('cache-control', 'no-store')
  return next
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
